import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { getDb, getRuntimeConfig, nowIso } from './db.js';
import { BUSINESS_DATA_TABLES } from './store.js';
import { recordBackup } from './backup.js';
import { schedulerStateForTests } from './carryoverRefreshScheduler.js';

export const PURGE_PHRASE='永久清除全部业务数据';
export const V503_PRE_CLEAR_VERIFY_ID='2026-09-10-v503-isolated-pre-clear-backup-quick-check-v1';
export const V504_PRE_CLEAR_BACKUP_ID='2026-09-10-v504-isolated-full-pre-clear-backup-v1';
const PURGE_BLOCK_KEY='data_purge_block_until';
const CACHE_WORKER_ACTIVE_KEY='dashboard_cache_worker_active';
const CACHE_WORKER_ACTIVE_UNTIL_KEY='dashboard_cache_worker_active_until';
const PURGE_PREPARE_COUNT_MODE='DEFERRED_TO_TRANSACTIONAL_DELETE';
const PURGE_EXECUTE_COUNT_MODE='DELETE_CHANGESET_EXACT';
const PRE_CLEAR_BACKUP_WORKER=fileURLToPath(new URL('../scripts/CE_QC_PreClearBackupWorker.mjs',import.meta.url));
const PRE_CLEAR_BACKUP_TIMEOUT_MS=Math.max(5*60_000,Math.min(60*60_000,Number(process.env.PURGE_PRE_CLEAR_BACKUP_TIMEOUT_MS||30*60_000)));
const challenges=new Map();

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

export async function createPurgeChallenge(user={},options={}){
  const db=getDb();
  setPurgeBlock(db,Date.now()+60*60_000);
  try{
    await waitForBackgroundMaintenanceIdle(db);
    reconcileRunLocks(db,options.activeRunIds);
    const verifiedBackup=await createVerifiedPreClearBackup(user.email||'');
    const createdAt=Date.now();
    const expiresAt=createdAt+10*60_000;
    setPurgeBlock(db,expiresAt);
    const sourceFingerprint=databaseFingerprint(getRuntimeConfig().dbFile);
    const challengeId=crypto.randomUUID();
    challenges.set(challengeId,{email:user.email||'',backup:verifiedBackup,createdAt,expiresAt,sourceFingerprint,countMode:PURGE_PREPARE_COUNT_MODE});
    return {challengeId,notBefore:new Date(createdAt+5000).toISOString(),expiresAt:new Date(expiresAt).toISOString(),databasePath:getRuntimeConfig().dbFile,counts:null,countMode:PURGE_PREPARE_COUNT_MODE,administrator:user.email||'',backup:{path:verifiedBackup.filePath,sha256:verifiedBackup.sha256,size:verifiedBackup.size,integrity:verifiedBackup.integrity,method:verifiedBackup.method},deleteScope:['日报及解析行','运单、扫描和轨迹','run/checkpoint/snapshot','carry和POD锁','趋势、缓存、通知及导出文件','遗留动态刷新运行时间戳'],retainedScope:['数据库结构和迁移','用户、角色与系统设置','最新门店白名单','审计日志','清除前备份']};
  }catch(error){clearPurgeBlock(db);throw error;}
}

export function resealPurgeChallenge(challengeId,user={}){
  const challenge=challenges.get(String(challengeId||''));
  if(!challenge||challenge.expiresAt<Date.now()||challenge.email!==(user.email||''))throw new Error('清除验证已失效，无法完成安全封存。');
  challenge.sourceFingerprint=databaseFingerprint(getRuntimeConfig().dbFile);
  challenge.resealedAt=Date.now();
  challenge.sourceSeal='POST_PREPARE_AUDIT';
  return {challengeId:String(challengeId||''),sourceSeal:challenge.sourceSeal};
}

export async function executePurge({challengeId,phrase,backupConfirmed,user={},activeRunIds=null}){
  const challenge=challenges.get(String(challengeId||''));
  if(!challenge||challenge.expiresAt<Date.now()||challenge.email!==(user.email||''))throw new Error('清除验证已失效，请重新开始。');
  if(Date.now()-challenge.createdAt<5000)throw new Error('请等待5秒倒计时完成。');
  if(!backupConfirmed)throw new Error('请勾选“我已确认自动备份成功”。');
  if(String(phrase||'')!==PURGE_PHRASE)throw new Error(`请输入完整确认短语：${PURGE_PHRASE}`);

  const db=getDb();
  await waitForBackgroundMaintenanceIdle(db);
  reconcileRunLocks(db,activeRunIds);
  verifyPreparedBackupStillPresent(challenge.backup);
  const currentFingerprint=databaseFingerprint(getRuntimeConfig().dbFile);
  if(!sameFingerprint(challenge.sourceFingerprint,currentFingerprint)){
    challenges.delete(String(challengeId||''));
    clearPurgeBlock(db);
    throw new Error('数据库在安全备份后发生变化，已停止清除。请重新开始，系统会先创建包含最新数据的新备份。');
  }

  const reset=fastResetBusinessState(db,{logs:[]});
  clearBusinessRuntimeMeta(db);
  const fileCleanupWarnings=await clearRegenerableFiles();
  assertPurgeStructure(db);
  if(String(process.env.VACUUM_AFTER_PURGE||'').toLowerCase()==='true')db.exec('VACUUM');
  clearPurgeBlock(db);
  challenges.delete(String(challengeId||''));
  return {backup:challenge.backup,before:reset.before,after:reset.after,completedAt:nowIso(),event:'DATA_RESET',integrity:'ok',integrityCheck:'TRANSACTION_AND_SCHEMA',walCheckpoint:'AUTO',fileCleanupWarnings,deleteMode:'FAST_TABLE_DELETE_FK_GUARDED',performanceIndexes:'V108',countSource:PURGE_EXECUTE_COUNT_MODE,backupSourceFingerprint:'MATCHED'};
}

export function getPurgeCounts(){return tableCounts(getDb());}

async function createVerifiedPreClearBackup(adminEmail){
  const cfg=getRuntimeConfig();
  const db=getDb();
  const stamp=`${localStamp()}-${crypto.randomUUID().slice(0,8)}`;
  const dir=path.join(cfg.backupsDir,'pre_clear',stamp);
  fs.mkdirSync(dir,{recursive:true});
  const filePath=path.join(dir,'ce_qc_monitor.db');
  const sourceSize=fs.statSync(cfg.dbFile).size;
  assertFreeSpace(dir,sourceSize);

  let isolated;
  try{
    isolated=await createVerifiedBackupIsolated(cfg.dbFile,filePath);
  }catch(error){
    try{fs.rmSync(dir,{recursive:true,force:true});}catch{}
    throw error;
  }
  const currentSourceFingerprint=databaseFingerprint(cfg.dbFile);
  if(!sameFingerprint(isolated.sourceFingerprintAfter,currentSourceFingerprint)){
    try{fs.rmSync(dir,{recursive:true,force:true});}catch{}
    throw new Error('数据库在独立安全备份结束后发生变化，已停止清除。请稍后重新开始。');
  }
  const stat=fs.statSync(filePath);
  const backupSize=Number(isolated.size||stat.size||0);
  if(backupSize<=0)throw new Error('备份文件为空，已停止清除。');
  const sha256=String(isolated.sha256||'');
  if(!/^[a-f0-9]{64}$/i.test(sha256))throw new Error('备份SHA-256验证无效，已停止清除。');
  const integrity=String(isolated.integrity||'');
  if(!['ok','quick-ok'].includes(integrity))throw new Error('备份完整性验证无效，已停止清除。');

  const schemaMeta=Number(db.prepare("SELECT value FROM app_meta WHERE key='db_schema_version'").get()?.value||0);
  const pragmaSchema=Number(db.prepare('PRAGMA user_version').get()?.user_version||0);
  const manifest={createdAt:nowIso(),reason:'clear-all-business-data',databasePath:cfg.dbFile,backupPath:filePath,sha256,size:backupSize,sourceSize,sourceQuickCheck:'deferred-to-verified-copy',backupQuickCheck:'ok',integrity,verificationMode:'isolated-write-freeze+online-backup+backup-quick-check+sha256',backupMtimeMs:stat.mtimeMs,method:isolated.method||'node-sqlite-online-backup-isolated-write-freeze',verificationWorker:V504_PRE_CLEAR_BACKUP_ID,compatibilityVerification:V503_PRE_CLEAR_VERIFY_ID,systemVersion:process.env.npm_package_version||'0.1.0',migrationVersion:schemaMeta||pragmaSchema,whitelistVersion:db.prepare("SELECT version FROM shop_whitelist_versions WHERE active=1 ORDER BY createdAt DESC LIMIT 1").get()?.version||'',administrator:adminEmail,counts:null,countMode:PURGE_PREPARE_COUNT_MODE,sourceStableDuringBackup:true};
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2),'utf8');
  recordBackup({backupType:'database',fileName:path.basename(filePath),filePath,fileHash:sha256,reason:'before-full-clear'});
  return {directory:dir,filePath,sha256,size:backupSize,mtimeMs:stat.mtimeMs,integrity,method:manifest.method,manifestPath:path.join(dir,'manifest.json')};
}

function createVerifiedBackupIsolated(dbFile,filePath){
  return new Promise((resolve,reject)=>{
    const payload=Buffer.from(JSON.stringify({dbFile:String(dbFile||''),filePath:String(filePath||''),lockTimeoutMs:30_000,ratePages:8192}),'utf8').toString('base64url');
    let stdout='';let stderr='';let settled=false;
    const child=spawn(process.execPath,[PRE_CLEAR_BACKUP_WORKER,payload],{cwd:getRuntimeConfig().projectRoot,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>{
      try{child.kill();}catch{}
      if(!settled){settled=true;reject(new Error('清空前安全备份超过30分钟，已停止清除；没有删除业务数据。'));}
    },PRE_CLEAR_BACKUP_TIMEOUT_MS);
    timer.unref?.();
    child.stdout?.on('data',chunk=>{stdout+=chunk.toString();if(stdout.length>2*1024*1024)stdout=stdout.slice(-2*1024*1024);});
    child.stderr?.on('data',chunk=>{stderr+=chunk.toString();if(stderr.length>2*1024*1024)stderr=stderr.slice(-2*1024*1024);});
    child.once('error',error=>{clearTimeout(timer);if(!settled){settled=true;reject(error);}});
    child.once('exit',code=>{
      clearTimeout(timer);if(settled)return;settled=true;
      const lines=stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);let result=null;
      for(let i=lines.length-1;i>=0;i-=1){try{result=JSON.parse(lines[i]);break;}catch{}}
      if(code!==0||!result?.ok){reject(new Error(result?.error||stderr.trim()||`清空前备份子进程退出码 ${code}`));return;}
      resolve(result);
    });
  });
}

function verifyPreparedBackupStillPresent(backupInfo){
  if(!backupInfo?.filePath||!fs.existsSync(backupInfo.filePath))throw new Error('自动备份不存在，已停止清除。');
  const stat=fs.statSync(backupInfo.filePath);
  if(stat.size<=0||(backupInfo.size&&stat.size!==backupInfo.size))throw new Error('自动备份大小发生变化，已停止清除。');
  if(Number.isFinite(Number(backupInfo.mtimeMs))&&Math.abs(Number(stat.mtimeMs)-Number(backupInfo.mtimeMs))>1)throw new Error('自动备份在确认期间发生变化，已停止清除。');
  if(!['ok','quick-ok'].includes(String(backupInfo.integrity||''))||!/^[a-f0-9]{64}$/i.test(String(backupInfo.sha256||'')))throw new Error('自动备份验证记录无效，已停止清除。');
  return true;
}

function statFingerprint(file){
  try{const stat=fs.statSync(file);return {exists:true,size:Number(stat.size||0),mtimeMs:Number(stat.mtimeMs||0)};}
  catch{return {exists:false,size:0,mtimeMs:0};}
}
function databaseFingerprint(dbFile){return {db:statFingerprint(dbFile),wal:statFingerprint(`${dbFile}-wal`)};}
function sameStatFingerprint(a={},b={}){return Boolean(a.exists)===Boolean(b.exists)&&Number(a.size||0)===Number(b.size||0)&&Math.abs(Number(a.mtimeMs||0)-Number(b.mtimeMs||0))<=1;}
function sameFingerprint(a={},b={}){return sameStatFingerprint(a.db,b.db)&&sameStatFingerprint(a.wal,b.wal);}

function fastResetBusinessState(db,nextState={}){
  const now=nowIso();
  const existing=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
  const clearTargets=BUSINESS_DATA_TABLES.filter(name=>existing.has(name));
  const before={};const after={};
  const foreignKeysBefore=Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys||0);
  if(foreignKeysBefore)db.exec('PRAGMA foreign_keys=OFF');
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const table of clearTargets){const deleted=db.prepare(`DELETE FROM ${table}`).run();before[table]=Number(deleted?.changes||0);}
    for(const [table,sql] of FAST_INDEXES)if(existing.has(table))db.exec(sql);
    for(const table of clearTargets){const remaining=Number(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get()?.count||0);after[table]=remaining;if(remaining!==0)throw new Error(`业务表清空校验失败：${table} 仍有 ${remaining} 行。`);}
    db.prepare(`INSERT INTO app_state(key,valueJson,updatedAt) VALUES('current',?,?) ON CONFLICT(key) DO UPDATE SET valueJson=excluded.valueJson,updatedAt=excluded.updatedAt`).run(JSON.stringify(nextState),now);
    const meta=db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
    meta.run('last_processed_report_date','',now);meta.run('last_full_clear_at',now,now);meta.run('current_snapshot_id','',now);meta.run('v108_performance_indexes_ready','1',now);
    db.exec('COMMIT');return {before,after};
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  finally{if(foreignKeysBefore)try{db.exec('PRAGMA foreign_keys=ON');}catch{}}
}

function tableCounts(db){
  const existing=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
  return Object.fromEntries(BUSINESS_DATA_TABLES.filter(name=>existing.has(name)).map(name=>[name,Number(db.prepare(`SELECT COUNT(*) count FROM ${name}`).get()?.count||0)]));
}
function setPurgeBlock(db,expiresAt){db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(PURGE_BLOCK_KEY,String(expiresAt),nowIso());}
function clearPurgeBlock(db){db.prepare('DELETE FROM app_meta WHERE key=?').run(PURGE_BLOCK_KEY);}
function pidIsAlive(pid){if(!Number.isInteger(pid)||pid<=0)return true;try{process.kill(pid,0);return true;}catch(error){return error?.code==='EPERM';}}
function cacheWorkerActive(db){
  const owner=String(db.prepare('SELECT value FROM app_meta WHERE key=?').get(CACHE_WORKER_ACTIVE_KEY)?.value||'');
  const until=Number(db.prepare('SELECT value FROM app_meta WHERE key=?').get(CACHE_WORKER_ACTIVE_UNTIL_KEY)?.value||0);
  if(!owner||!Number.isFinite(until)||until<=Date.now())return false;
  const pid=Number(owner.match(/^(\d+)-/)?.[1]||0);
  if(pid>0&&!pidIsAlive(pid)){db.prepare('DELETE FROM app_meta WHERE key IN (?,?)').run(CACHE_WORKER_ACTIVE_KEY,CACHE_WORKER_ACTIVE_UNTIL_KEY);return false;}
  return true;
}
async function waitForBackgroundMaintenanceIdle(db,timeoutMs=5*60_000){
  const started=Date.now();
  while(schedulerStateForTests().inFlight||cacheWorkerActive(db)){
    if(Date.now()-started>=timeoutMs)throw new Error('后台遗留刷新或看板缓存维护超过5分钟仍未结束，系统已安全停止本次清除，没有修改业务数据。');
    await new Promise(resolve=>setTimeout(resolve,250));
  }
}
function clearBusinessRuntimeMeta(db){db.prepare(`DELETE FROM app_meta WHERE key LIKE 'carry_refresh_%' OR key LIKE 'v246_daily_0200_%' OR key IN (?,?)`).run(CACHE_WORKER_ACTIVE_KEY,CACHE_WORKER_ACTIVE_UNTIL_KEY);}
function reconcileRunLocks(db,activeRunIds){
  const active=activeRunIds instanceof Set?activeRunIds:new Set(activeRunIds||[]);
  const main=db.prepare("SELECT reportDate,runId FROM run_locks WHERE status IN ('running','paused','paused_write')").all();
  const business=db.prepare("SELECT businessType,reportDate,runId FROM business_run_locks WHERE status IN ('running','paused','paused_write')").all();
  const genuinelyActive=[...main,...business].find(row=>active.has(row.runId));
  if(genuinelyActive)throw new Error(`当前存在活动任务，不能清除。runId：${genuinelyActive.runId}`);
  if(!main.length&&!business.length)return;
  const now=nowIso();db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare("UPDATE run_locks SET status='interrupted',currentStage='服务重启后由管理员终止',errorMessage='stale process lock cleared before full data purge',updatedAt=? WHERE status IN ('running','paused','paused_write')").run(now);
    db.prepare("UPDATE business_run_locks SET status='interrupted',currentStage='服务重启后由管理员终止',errorMessage='stale process lock cleared before full data purge',updatedAt=? WHERE status IN ('running','paused','paused_write')").run(now);
    db.prepare("UPDATE run_checkpoints SET status='INTERRUPTED',updatedAt=? WHERE status IN ('RUNNING','PROCESSING')").run(now);
    db.prepare("UPDATE business_run_checkpoints SET status='interrupted',errorMessage='stale process lock cleared before full data purge',updatedAt=? WHERE status='running'").run(now);
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function assertPurgeStructure(db){
  for(const table of ['app_meta','app_state','users','audit_logs','backup_records']){const exists=db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table)?.ok;if(!exists)throw new Error(`清空后结构校验失败：缺少 ${table}`);}
  if(Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys||0)!==1)throw new Error('清空后外键保护未恢复。');
}
export function hashFileStream(file){return new Promise((resolve,reject)=>{const hash=crypto.createHash('sha256');const input=fs.createReadStream(file,{highWaterMark:8*1024*1024});input.on('error',reject);input.on('data',chunk=>hash.update(chunk));input.on('end',()=>resolve(hash.digest('hex')));});}
function assertFreeSpace(targetDir,sourceSize){const disk=fs.statfsSync(targetDir);const available=Number(disk.bavail)*Number(disk.bsize);const required=Math.ceil(sourceSize*1.1)+256*1024*1024;if(available<required)throw new Error(`备份磁盘空间不足：至少需要 ${required} 字节，当前可用 ${available} 字节。`);}
function localStamp(){const d=new Date();const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;}
async function clearRegenerableFiles(){
  const cfg=getRuntimeConfig();const warnings=[];
  for(const dir of [cfg.exportsDir,cfg.importsDir]){
    if(!fs.existsSync(dir))continue;const entries=fs.readdirSync(dir);
    for(let index=0;index<entries.length;index+=1){const entry=entries[index];try{await fs.promises.rm(path.join(dir,entry),{recursive:true,force:true});}catch(error){warnings.push(`${entry}: ${error?.message||String(error)}`);}if(index%20===19)await new Promise(resolve=>setImmediate(resolve));}
  }
  fs.mkdirSync(cfg.longJsonExportsDir,{recursive:true});return warnings;
}
