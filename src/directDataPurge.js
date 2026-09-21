import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

import { getRuntimeConfig, nowIso } from './db.js';
import { BUSINESS_DATA_TABLES } from './store.js';
import { deleteAllBackups } from './backup.js';
import { inspectV541PurgeJobWorker } from './v541PurgePidOwnership.js';

export const DIRECT_PURGE_ID='2026-09-21-v568-direct-no-backup-space-reclaim-v1';
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
  for(const dir of [cfg.exportsDir,cfg.importsDir,cfg.longJsonExportsDir,cfg.evidenceArchiveDir]){
    if(!fs.existsSync(dir))continue;
    for(const entry of fs.readdirSync(dir)){
      try{await fs.promises.rm(path.join(dir,entry),{recursive:true,force:true});}
      catch(error){warnings.push(`${entry}: ${error?.message||String(error)}`);}
    }
  }
  return warnings;
}
function directResetTransaction(db,onProgress=()=>{}){
  const now=nowIso();
  const existing=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>String(row.name||'')));
  const clearTargets=BUSINESS_DATA_TABLES.filter(name=>existing.has(name));
  const before={};const after={};
  const foreignKeysBefore=Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys||0);
  let transactionStarted=false;
  try{
    if(foreignKeysBefore)db.exec('PRAGMA foreign_keys=OFF');
    onProgress({status:'RUNNING',stage:'WAITING_DB_LOCK',message:'正在取得数据库写锁。'});
    db.exec('BEGIN IMMEDIATE');
    transactionStarted=true;
    onProgress({status:'RUNNING',stage:'DELETE_TABLES',message:'已取得数据库写锁，开始清空业务表。',completedTables:0,totalTables:clearTargets.length});
    for(let index=0;index<clearTargets.length;index+=1){
      const table=clearTargets[index];
      const deleted=db.prepare(`DELETE FROM ${table}`).run();
      before[table]=Number(deleted?.changes||0);
      onProgress({status:'RUNNING',stage:'DELETE_TABLES',message:`正在清空业务表 ${index+1}/${clearTargets.length}`,table,completedTables:index+1,totalTables:clearTargets.length,deletedRows:Object.values(before).reduce((sum,value)=>sum+Number(value||0),0)});
    }
    onProgress({status:'RUNNING',stage:'VERIFYING',message:'业务表删除完成，正在校验清空结果。',completedTables:clearTargets.length,totalTables:clearTargets.length,deletedRows:Object.values(before).reduce((sum,value)=>sum+Number(value||0),0)});
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
    onProgress({status:'RUNNING',stage:'COMMITTING',message:'校验完成，正在提交清空事务。',deletedRows:Object.values(before).reduce((sum,value)=>sum+Number(value||0),0)});
    db.exec('COMMIT');
    transactionStarted=false;
    onProgress({status:'RUNNING',stage:'COMMITTED',message:'清空事务已提交，正在清理可再生成文件。',deletedRows:Object.values(before).reduce((sum,value)=>sum+Number(value||0),0)});
    return {before,after,completedAt:now};
  }catch(error){
    if(transactionStarted){try{db.exec('ROLLBACK');}catch{}}
    throw error;
  }finally{
    if(foreignKeysBefore)try{db.exec('PRAGMA foreign_keys=ON');}catch{}
  }
}


function compactPurgedDatabase(dbFile,onProgress=()=>{}){
  const beforeBytes=fs.existsSync(dbFile)?Number(fs.statSync(dbFile).size||0):0;
  const db=new DatabaseSync(dbFile);
  try{
    db.exec('PRAGMA busy_timeout=120000');
    const existing=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>String(row.name||'')));
    let remainingBusinessRows=0;
    for(const table of BUSINESS_DATA_TABLES){
      if(!existing.has(table))continue;
      remainingBusinessRows+=Number(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get()?.count||0);
      if(remainingBusinessRows>0)break;
    }
    if(remainingBusinessRows!==0)return {skipped:true,reason:'BUSINESS_ROWS_REMAIN',remainingBusinessRows,beforeBytes,afterBytes:beforeBytes,reclaimedBytes:0};
    onProgress({status:'RUNNING',stage:'RECLAIMING_SPACE',message:'业务数据已归零，正在释放 SQLite 占用的磁盘空间。'});
    try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}catch{}
    db.exec('VACUUM');
    try{db.exec('PRAGMA optimize');}catch{}
  }finally{
    try{db.close();}catch{}
  }
  const afterBytes=fs.existsSync(dbFile)?Number(fs.statSync(dbFile).size||0):0;
  return {skipped:false,beforeBytes,afterBytes,reclaimedBytes:Math.max(0,beforeBytes-afterBytes)};
}

export async function executeDirectDataPurge({phrase,user={},onProgress=()=>{}}={}){
  if(String(phrase||'')!==DIRECT_PURGE_PHRASE)throw new Error(`请输入完整确认短语：${DIRECT_PURGE_PHRASE}`);
  const administrator=String(user.email||user.username||'');
  onProgress({status:'RUNNING',stage:'RETIRING_LEGACY',message:'正在结束旧的备份/清空任务状态。'});
  const retiredLegacyJobs=retireLegacyPurgeArtifacts();
  await new Promise(resolve=>setTimeout(resolve,350));

  const cfg=getRuntimeConfig();
  const db=new DatabaseSync(cfg.dbFile);
  let reset;
  try{
    db.exec('PRAGMA busy_timeout=60000');
    db.exec('PRAGMA foreign_keys=ON');
    reset=directResetTransaction(db,onProgress);
  }finally{
    try{db.close();}catch{}
  }
  const compactResult=compactPurgedDatabase(cfg.dbFile,onProgress);
  onProgress({status:'RUNNING',stage:'FILE_CLEANUP',message:'数据库已清空，正在删除业务缓存、证据归档和全部 CE QC 备份。',deletedRows:Object.values(reset.before||{}).reduce((sum,value)=>sum+Number(value||0),0)});
  const fileCleanupWarnings=await clearRegenerableFiles();
  let backupCleanup={deletedCount:0,deletedBytes:0,retainedCount:0,failedCount:0};
  try{backupCleanup=deleteAllBackups(administrator,{retainSafety:false});}
  catch(error){fileCleanupWarnings.push(`备份清理失败: ${error?.message||String(error)}`);}
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
    compactResult,
    backupCleanup,
    retiredLegacyJobs,
    patchId:DIRECT_PURGE_ID
  };
}


const directJobs=new Map();
let activeDirectJobId='';

function publicDirectJob(job={}){
  return {
    ok:true,
    direct:true,
    async:true,
    jobId:String(job.jobId||''),
    status:String(job.status||'QUEUED'),
    stage:String(job.stage||'QUEUED'),
    message:String(job.message||''),
    startedAt:Number(job.startedAt||0),
    updatedAt:Number(job.updatedAt||0),
    completedTables:Number(job.completedTables||0),
    totalTables:Number(job.totalTables||0),
    deletedRows:Number(job.deletedRows||0),
    error:String(job.error||''),
    code:String(job.code||''),
    completedAt:String(job.completedAt||''),
    patchId:DIRECT_PURGE_ID
  };
}

export function queueDirectDataPurge({phrase,user={}}={}){
  if(!isMainThread)throw new Error('只能由5177主进程提交直接清空任务。');
  if(String(phrase||'')!==DIRECT_PURGE_PHRASE){
    const error=new Error(`请输入完整确认短语：${DIRECT_PURGE_PHRASE}`);
    error.code='DIRECT_PURGE_CONFIRMATION_REQUIRED';
    throw error;
  }
  const administrator=String(user.email||user.username||'').trim();
  if(!administrator){
    const error=new Error('管理员身份无效，请重新登录。');
    error.code='DIRECT_PURGE_ADMIN_REQUIRED';
    throw error;
  }
  if(activeDirectJobId){
    const existing=directJobs.get(activeDirectJobId);
    if(existing&&['QUEUED','RUNNING'].includes(String(existing.status||'').toUpperCase())){
      return {...publicDirectJob(existing),reused:true};
    }
  }

  const jobId=crypto.randomUUID();
  const startedAt=Date.now();
  const job={
    jobId,administrator,status:'QUEUED',stage:'QUEUED',
    message:'直接清空任务已提交，正在启动独立后台线程。',
    startedAt,updatedAt:startedAt,deletedRows:0,completedTables:0,totalTables:0
  };
  directJobs.set(jobId,job);
  activeDirectJobId=jobId;

  const worker=new Worker(new URL(import.meta.url),{
    workerData:{
      ceQcDirectPurgeWorker:true,
      phrase:DIRECT_PURGE_PHRASE,
      administrator
    }
  });
  job.worker=worker;
  job.status='RUNNING';
  job.stage='STARTING_WORKER';
  job.message='独立后台清空线程已启动。';
  job.updatedAt=Date.now();

  worker.on('message',message=>{
    const current=directJobs.get(jobId);
    if(!current)return;
    Object.assign(current,message||{},{jobId,administrator,updatedAt:Date.now()});
    if(['SUCCEEDED','FAILED'].includes(String(current.status||'').toUpperCase())){
      current.worker=null;
      if(activeDirectJobId===jobId)activeDirectJobId='';
    }
  });
  worker.on('error',error=>{
    const current=directJobs.get(jobId);
    if(!current)return;
    Object.assign(current,{status:'FAILED',stage:'FAILED',error:String(error?.message||error),message:String(error?.message||error),code:'DIRECT_PURGE_WORKER_ERROR',updatedAt:Date.now(),worker:null});
    if(activeDirectJobId===jobId)activeDirectJobId='';
  });
  worker.on('exit',code=>{
    const current=directJobs.get(jobId);
    if(!current)return;
    if(!['SUCCEEDED','FAILED'].includes(String(current.status||'').toUpperCase())){
      Object.assign(current,{status:'FAILED',stage:'FAILED',error:`后台清空线程异常结束（exit=${code}）。`,message:`后台清空线程异常结束（exit=${code}）。`,code:'DIRECT_PURGE_WORKER_EXIT',updatedAt:Date.now(),worker:null});
    }
    if(activeDirectJobId===jobId)activeDirectJobId='';
  });

  return {...publicDirectJob(job),reused:false};
}

export function getDirectDataPurgeStatus({jobId,user={}}={}){
  const id=String(jobId||'').trim();
  const administrator=String(user.email||user.username||'').trim();
  const job=directJobs.get(id);
  if(!job){
    const error=new Error('没有找到该直接清空任务。');
    error.code='DIRECT_PURGE_JOB_NOT_FOUND';
    throw error;
  }
  if(administrator&&job.administrator&&administrator!==job.administrator){
    const error=new Error('该清空任务属于其他管理员。');
    error.code='DIRECT_PURGE_JOB_OWNER_MISMATCH';
    throw error;
  }
  return publicDirectJob(job);
}

if(!isMainThread&&workerData?.ceQcDirectPurgeWorker===true){
  const send=payload=>{try{parentPort?.postMessage(payload);}catch{}};
  try{
    const result=await executeDirectDataPurge({
      phrase:String(workerData.phrase||''),
      user:{email:String(workerData.administrator||''),role:'ADMIN'},
      onProgress:progress=>send({...progress,status:'RUNNING',updatedAt:Date.now()})
    });
    send({
      status:'SUCCEEDED',stage:'SUCCEEDED',message:'全部业务数据已直接清空。',
      completedAt:result.completedAt,deletedRows:Object.values(result.before||{}).reduce((sum,value)=>sum+Number(value||0),0),
      before:result.before,after:result.after,fileCleanupWarnings:result.fileCleanupWarnings||[],updatedAt:Date.now()
    });
  }catch(error){
    send({status:'FAILED',stage:'FAILED',message:String(error?.message||error),error:String(error?.message||error),code:String(error?.code||'DIRECT_PURGE_WORKER_FAILED'),updatedAt:Date.now()});
  }
}
