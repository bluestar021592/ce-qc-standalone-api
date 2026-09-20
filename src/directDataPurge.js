import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import { getRuntimeConfig, nowIso } from './db.js';
import { BUSINESS_DATA_TABLES } from './store.js';
import { inspectV541PurgeJobWorker } from './v541PurgePidOwnership.js';

export const DIRECT_PURGE_ID='2026-09-20-v560-direct-no-backup-purge-v1';
export const DIRECT_PURGE_PHRASE='永久清除全部业务数据';

const ACTIVE_JOB_STATUS=new Set(['QUEUED','RUNNING']);
const COMMITTED_JOB_STATUS=new Set(['COMMITTED']);
const PURGE_BLOCK_KEY='data_purge_block_until';
const PURGE_COMMIT_RECEIPT_KEY='data_purge_last_commit_receipt';
const CACHE_WORKER_ACTIVE_KEY='dashboard_cache_worker_active';
const CACHE_WORKER_ACTIVE_UNTIL_KEY='dashboard_cache_worker_active_until';

const FAST_INDEXES=[
  ['unified_import_batches',`CREATE INDEX IF NOT EXISTS idx_v108_unified_batches_valid_date ON unified_import_batches(status,reportDate DESC,createdAt DESC,snapshotId)`],
  ['unified_import_rows',`CREATE INDEX IF NOT EXISTS idx_v108_unified_rows_snapshot_business ON unified_import_rows(snapshotId,businessType,shipmentCode,reportDate)`],
  ['final_rows',`CREATE INDEX IF NOT EXISTS idx_v108_final_report_bill ON final_rows(reportDate,shipmentCode,isPod,primaryCategory)`],
  ['business_final_rows',`CREATE INDEX IF NOT EXISTS idx_v108_business_final_report_type ON business_final_rows(reportDate,businessType,shipmentCode,isPod,primaryCategory)`],
  ['business_scan_results',`CREATE INDEX IF NOT EXISTS idx_v108_business_scan_report_type ON business_scan_results(reportDate,businessType,shipmentCode,isPod,orderStatus)`],
  ['business_daily_parse_rows',`CREATE INDEX IF NOT EXISTS idx_v108_business_daily_report_type ON business_daily_parse_rows(reportDate,businessType,shipmentCode)`],
  ['metric_detail_members',`CREATE INDEX IF NOT EXISTS idx_v108_metric_detail_lookup ON metric_detail_members(snapshotId,businessType,metricKey,shipmentCode)`],
  ['shipment_current_state',`CREATE INDEX IF NOT EXISTS idx_v108_current_business_date ON shipment_current_state(businessType,reportDate,shipmentCode)`]
];

function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function safeRemove(file){try{fs.rmSync(file,{force:true,recursive:false});}catch{}}
function terminateVerifiedWorkerTree(job={}){
  const pid=Number(job.workerPid||0);
  if(pid<=0)return false;
  let ownership=null;
  try{ownership=inspectV541PurgeJobWorker(job);}catch{}
  if(ownership?.active!==true||String(ownership?.workerState||'')!=='ALIVE')return false;
  try{
    if(process.platform==='win32'){
      const result=spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:15_000});
      return !result.error;
    }
    process.kill(pid,'SIGTERM');
    return true;
  }catch{return false;}
}
function removeStatusFile(job={}){
  const cfg=getRuntimeConfig();
  const candidate=String(job.statusFile||'');
  if(!candidate)return;
  const safeRoot=path.resolve(cfg.projectRoot,'public','purge-status')+path.sep;
  const resolved=path.resolve(candidate);
  if(resolved.startsWith(safeRoot))safeRemove(resolved);
}
function retireLegacyPurgeArtifacts(){
  const cfg=getRuntimeConfig();
  const groups=[
    {dir:path.join(cfg.backupsDir,'.purge_prepare_jobs'),prepare:true},
    {dir:path.join(cfg.backupsDir,'.purge_execute_jobs'),prepare:false}
  ];
  const retired=[];
  for(const group of groups){
    if(!fs.existsSync(group.dir))continue;
    for(const name of fs.readdirSync(group.dir)){
      const file=path.join(group.dir,name);
      if(name.endsWith('.challenge.json')){safeRemove(file);continue;}
      if(!name.endsWith('.job.json'))continue;
      const job=readJson(file)||{};
      const status=String(job.status||'').toUpperCase();
      if(!group.prepare&&COMMITTED_JOB_STATUS.has(status)){
        const error=new Error('检测到旧清空事务已经进入 COMMITTED 状态。为避免与已提交事务并发，直接清空已停止；请先重新启动一次程序后再执行。');
        error.code='DIRECT_PURGE_COMMITTED_JOB_PRESENT';
        throw error;
      }
      if(ACTIVE_JOB_STATUS.has(status))terminateVerifiedWorkerTree(job);
      removeStatusFile(job);
      safeRemove(file);
      retired.push({kind:group.prepare?'PREPARE':'EXECUTE',status,jobId:String(job.jobId||'')});
    }
  }
  safeRemove(path.join(cfg.backupsDir,'.purge_global_submission.lock.json'));
  const statusDir=path.join(cfg.projectRoot,'public','purge-status');
  if(fs.existsSync(statusDir)){
    for(const name of fs.readdirSync(statusDir)){
      if(/^[a-f0-9]{48}\.json$/i.test(name))safeRemove(path.join(statusDir,name));
    }
  }
  return retired;
}
async function clearRegenerableFiles(){
  const cfg=getRuntimeConfig();const warnings=[];
  for(const dir of [cfg.exportsDir,cfg.importsDir]){
    if(!fs.existsSync(dir))continue;
    for(const entry of fs.readdirSync(dir)){
      try{await fs.promises.rm(path.join(dir,entry),{recursive:true,force:true});}
      catch(error){warnings.push(`${entry}: ${error?.message||String(error)}`);}
    }
  }
  return warnings;
}
function directResetTransaction(db){
  const now=nowIso();
  const existing=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>String(row.name||'')));
  const clearTargets=BUSINESS_DATA_TABLES.filter(name=>existing.has(name));
  const before={};const after={};
  const foreignKeysBefore=Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys||0);
  let transactionStarted=false;
  try{
    if(foreignKeysBefore)db.exec('PRAGMA foreign_keys=OFF');
    db.exec('BEGIN IMMEDIATE');
    transactionStarted=true;
    for(const table of clearTargets){
      const deleted=db.prepare(`DELETE FROM ${table}`).run();
      before[table]=Number(deleted?.changes||0);
    }
    for(const [table,sql] of FAST_INDEXES)if(existing.has(table))db.exec(sql);
    for(const table of clearTargets){
      const remaining=Number(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get()?.count||0);
      after[table]=remaining;
      if(remaining!==0)throw new Error(`业务表清空校验失败：${table} 仍有 ${remaining} 行。`);
    }
    db.prepare(`INSERT INTO app_state(key,valueJson,updatedAt) VALUES('current',?,?) ON CONFLICT(key) DO UPDATE SET valueJson=excluded.valueJson,updatedAt=excluded.updatedAt`).run(JSON.stringify({logs:[]}),now);
    const meta=db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
    meta.run('last_processed_report_date','',now);
    meta.run('last_full_clear_at',now,now);
    meta.run('current_snapshot_id','',now);
    meta.run('v108_performance_indexes_ready','1',now);
    db.prepare(`DELETE FROM app_meta WHERE key LIKE 'carry_refresh_%' OR key LIKE 'v246_daily_0200_%' OR key IN (?,?,?,?)`).run(CACHE_WORKER_ACTIVE_KEY,CACHE_WORKER_ACTIVE_UNTIL_KEY,PURGE_BLOCK_KEY,PURGE_COMMIT_RECEIPT_KEY);
    db.exec('COMMIT');
    transactionStarted=false;
    return {before,after,completedAt:now};
  }catch(error){
    if(transactionStarted){try{db.exec('ROLLBACK');}catch{}}
    throw error;
  }finally{
    if(foreignKeysBefore)try{db.exec('PRAGMA foreign_keys=ON');}catch{}
  }
}

export async function executeDirectDataPurge({phrase,user={}}={}){
  if(String(phrase||'')!==DIRECT_PURGE_PHRASE)throw new Error(`请输入完整确认短语：${DIRECT_PURGE_PHRASE}`);
  const administrator=String(user.email||user.username||'');
  const retiredLegacyJobs=retireLegacyPurgeArtifacts();
  await new Promise(resolve=>setTimeout(resolve,350));

  const cfg=getRuntimeConfig();
  const db=new DatabaseSync(cfg.dbFile);
  let reset;
  try{
    db.exec('PRAGMA busy_timeout=60000');
    db.exec('PRAGMA foreign_keys=ON');
    reset=directResetTransaction(db);
  }finally{
    try{db.close();}catch{}
  }
  const fileCleanupWarnings=await clearRegenerableFiles();
  return {
    ok:true,
    direct:true,
    backupCreated:false,
    sealed:false,
    administrator,
    event:'DATA_RESET',
    deleteMode:'DIRECT_NO_BACKUP_TRANSACTION',
    before:reset.before,
    after:reset.after,
    completedAt:reset.completedAt,
    fileCleanupWarnings,
    retiredLegacyJobs,
    patchId:DIRECT_PURGE_ID
  };
}
