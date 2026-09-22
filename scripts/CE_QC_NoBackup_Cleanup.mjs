import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeConfig, nowIso } from '../src/db.js';
import { compactSqliteStorage, STORAGE_COMPACTION_PATCH } from '../src/storageCompaction.js';

const PATCH_ID='2026-09-22-v577-fast-storage-startup-v1';
const DAY_MS=24*60*60*1000;
const EVIDENCE_RETENTION_MS=60*DAY_MS;
const LOG_RETENTION_MS=45*DAY_MS;
const TEMP_STALE_MS=0;

function samePath(a,b){
  const aa=path.resolve(String(a||''));
  const bb=path.resolve(String(b||''));
  return process.platform==='win32'?aa.toLowerCase()===bb.toLowerCase():aa===bb;
}
function safeInside(parent,target){
  const root=path.resolve(parent);
  const child=path.resolve(target);
  const a=process.platform==='win32'?root.toLowerCase():root;
  const b=process.platform==='win32'?child.toLowerCase():child;
  return b===a || b.startsWith(a+path.sep);
}
function treeBytes(target){
  let total=0;
  const stack=[target];
  while(stack.length){
    const current=stack.pop();
    let stat;
    try{stat=fs.lstatSync(current);}catch{continue;}
    if(stat.isSymbolicLink()){continue;}
    if(stat.isFile()){total+=Number(stat.size||0);continue;}
    if(!stat.isDirectory())continue;
    let entries=[];
    try{entries=fs.readdirSync(current,{withFileTypes:true});}catch{continue;}
    for(const entry of entries)stack.push(path.join(current,entry.name));
  }
  return total;
}
function deleteTarget(root,target,result){
  if(!safeInside(root,target))return;
  try{
    const bytes=treeBytes(target);
    fs.rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:160});
    result.deletedEntries+=1;
    result.deletedBytes+=bytes;
  }catch(error){result.failed.push({target,error:String(error?.message||error)});}
}
function removeChildren(root,{olderThanMs=0,keepNames=[]}={}){
  const result={root:path.resolve(root),deletedEntries:0,deletedBytes:0,failed:[]};
  if(!fs.existsSync(root))return result;
  const keep=new Set(keepNames.map(v=>String(v).toLowerCase()));
  for(const entry of fs.readdirSync(root,{withFileTypes:true})){
    if(keep.has(String(entry.name).toLowerCase()))continue;
    const target=path.join(root,entry.name);
    if(!safeInside(root,target))continue;
    if(olderThanMs>0){
      try{
        const age=Date.now()-Number(fs.statSync(target).mtimeMs||0);
        if(age<olderThanMs)continue;
      }catch{continue;}
    }
    deleteTarget(root,target,result);
  }
  return result;
}
function cleanupNamedTempRoots(root){
  const result={root:path.resolve(root),deletedEntries:0,deletedBytes:0,failed:[]};
  if(!fs.existsSync(root))return result;
  const owned=/^(?:CE_QC_UPDATE_VERIFY_|CE_QC_candidate_|CE_QC_installed_gate_|ce-qc-)/i;
  for(const entry of fs.readdirSync(root,{withFileTypes:true})){
    if(!entry.isDirectory()||!owned.test(entry.name))continue;
    const target=path.join(root,entry.name);
    try{
      const age=Date.now()-Number(fs.statSync(target).mtimeMs||0);
      if(age<TEMP_STALE_MS)continue;
    }catch{continue;}
    deleteTarget(root,target,result);
  }
  return result;
}
function driveSnapshot(root){
  try{
    const stat=fs.statfsSync(root);
    const block=Number(stat.bsize||stat.frsize||0);
    const totalBytes=block*Number(stat.blocks||0);
    const freeBytes=block*Number(stat.bavail??stat.bfree??0);
    return {root,totalBytes,freeBytes,usedBytes:Math.max(0,totalBytes-freeBytes)};
  }catch(error){return {root,error:String(error?.message||error)};}
}
function tableExists(db,name){
  return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name)?.ok);
}
function retireBackupRecords(dbFile){
  if(!fs.existsSync(dbFile))return {updated:0};
  const db=new DatabaseSync(dbFile);
  try{
    db.exec('PRAGMA busy_timeout=120000');
    if(!tableExists(db,'backup_records'))return {updated:0};
    const info=db.prepare("UPDATE backup_records SET status='DELETED',deletedAt=COALESCE(deletedAt,?),deletedBy=COALESCE(NULLIF(deletedBy,''),'NO_BACKUP_POLICY') WHERE COALESCE(status,'ACTIVE')<>'DELETED'").run(nowIso());
    return {updated:Number(info?.changes||0)};
  }catch(error){
    return {updated:0,error:String(error?.message||error)};
  }finally{
    try{db.close();}catch{}
  }
}

const cfg=getRuntimeConfig();
const launcherRoot=process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA,'CE_QC_LAUNCHER')
  : path.join(cfg.projectRoot||process.cwd(),'.ce-qc-launcher');
const launcherBackupRoot=path.join(launcherRoot,'backups');
const launcherTempRoot=path.join(launcherRoot,'temp');
const launcherLogsRoot=path.join(launcherRoot,'app','logs');
const fallbackDataRoot=path.join(cfg.projectRoot||process.cwd(),'data');
const dataTempRoot=path.join(cfg.dataDir,'temp');
const dCandidateTempRoot=process.platform==='win32'?'D:\\CE_QC_TEST_TEMP':path.join(cfg.dataDir,'temp','candidate_tests');
const dRuntimeTempRoot=process.platform==='win32'?'D:\\CE_QC_RUNTIME_TEMP':path.join(cfg.dataDir,'temp','runtime');

const cRoot=process.platform==='win32'?'C:\\':path.parse(cfg.projectRoot).root;
const dRoot=process.platform==='win32'&&fs.existsSync('D:\\')?'D:\\':path.parse(cfg.dataDir).root;
const drivesBefore={C:driveSnapshot(cRoot),D:driveSnapshot(dRoot)};

const removed=[
  {kind:'DATA_BACKUPS',...removeChildren(cfg.backupsDir)},
  {kind:'LAUNCHER_BACKUPS',...removeChildren(launcherBackupRoot)},
  {kind:'IMPORTS',...removeChildren(cfg.importsDir)},
  {kind:'EXPORTS',...removeChildren(cfg.exportsDir)},
  {kind:'DATA_RUNTIME_TEMP',...removeChildren(dataTempRoot)},
  {kind:'D_CANDIDATE_TEST_TEMP',...removeChildren(dCandidateTempRoot)},
  {kind:'D_RUNTIME_TEMP',...removeChildren(dRuntimeTempRoot)},
  {kind:'LAUNCHER_TEMP',...removeChildren(launcherTempRoot)},
  {kind:'PROJECT_CACHE',...removeChildren(path.join(cfg.projectRoot||process.cwd(),'.cache'))},
  {kind:'PROJECT_TMP',...removeChildren(path.join(cfg.projectRoot||process.cwd(),'tmp'))},
  {kind:'NODE_MODULE_CACHE',...removeChildren(path.join(cfg.projectRoot||process.cwd(),'node_modules','.cache'))}
];

if(!samePath(cfg.dataDir,fallbackDataRoot)){
  removed.push({kind:'UNUSED_C_FALLBACK_DATA',...removeChildren(fallbackDataRoot)});
}

const retained=[
  {kind:'EVIDENCE_ARCHIVE_60D',...removeChildren(cfg.evidenceArchiveDir,{olderThanMs:EVIDENCE_RETENTION_MS})},
  {kind:'D_LOGS_45D',...removeChildren(cfg.logsDir,{olderThanMs:LOG_RETENTION_MS})},
  {kind:'C_CRASH_LOGS_45D',...removeChildren(path.join(launcherLogsRoot,'crashes'),{olderThanMs:LOG_RETENTION_MS})},
  {kind:'C_APP_LOGS_45D',...removeChildren(launcherLogsRoot,{
    olderThanMs:LOG_RETENTION_MS,
    keepNames:['startup_latest.log','startup_error.log','managed_launcher_latest.log','runtime_supervisor.pid','crashes']
  })}
];

const tempCleanup=[
  cleanupNamedTempRoots(os.tmpdir()),
  ...(process.env.LOCALAPPDATA?[cleanupNamedTempRoots(path.join(process.env.LOCALAPPDATA,'Temp'))]:[])
];

const backupRecordCleanup=retireBackupRecords(cfg.dbFile);
const compact=compactSqliteStorage(cfg.dbFile,{
  minReclaimBytes:256*1024*1024,
  minReclaimRatio:0.08,
  reserveBytes:1024*1024*1024,
  startupSafe:true,
  maxStartupVacuumBytes:4*1024*1024*1024
});
const drivesAfter={C:driveSnapshot(cRoot),D:driveSnapshot(dRoot)};
const allCleanup=[...removed,...retained,...tempCleanup];
const deletedBytes=allCleanup.reduce((sum,item)=>sum+Number(item.deletedBytes||0),0);
const deletedEntries=allCleanup.reduce((sum,item)=>sum+Number(item.deletedEntries||0),0);

function gib(value){return Number(value||0)/(1024**3);}
function driveLine(label,before,after){
  if(before?.error||after?.error)return `[CE-QC][V573][STORAGE] ${label}: unable to read free-space snapshot.`;
  const delta=Number(after?.freeBytes||0)-Number(before?.freeBytes||0);
  const sign=delta>=0?'+':'';
  return `[CE-QC][V573][STORAGE] ${label}: free ${gib(before?.freeBytes).toFixed(2)} GiB -> ${gib(after?.freeBytes).toFixed(2)} GiB (${sign}${gib(delta).toFixed(2)} GiB).`;
}
console.log(`[CE-QC][V573][STORAGE] cleanup complete: deleted ${deletedEntries} CE-QC-owned entries / ${gib(deletedBytes).toFixed(2)} GiB.`);
console.log(driveLine('C',drivesBefore.C,drivesAfter.C));
console.log(driveLine('D',drivesBefore.D,drivesAfter.D));
if(compact?.compacted){
  console.log(`[CE-QC][V576][STORAGE] SQLite compacted with live data preserved and quick_check=ok: ${gib(compact.beforeBytes).toFixed(2)} GiB -> ${gib(compact.afterBytes).toFixed(2)} GiB, reclaimed ${gib(compact.reclaimedBytes).toFixed(2)} GiB.`);
}else if(compact?.reason==='INSUFFICIENT_FREE_SPACE_FOR_SAFE_VACUUM'){
  console.log(`[CE-QC][V576][STORAGE] SQLite has ${gib(compact.reclaimableBytes).toFixed(2)} GiB reclaimable, but safe VACUUM needs about ${gib(compact.requiredFreeBytes).toFixed(2)} GiB free and only ${gib(compact.driveFreeBytes).toFixed(2)} GiB is free. No business data was deleted.`);
}else if(compact?.reason==='LARGE_DB_STARTUP_COMPACTION_DEFERRED'){
  console.log(`[CE-QC][V577][STORAGE] Fast census complete: SQLite allocated=${gib(compact.beforeBytes).toFixed(2)} GiB, estimated live=${gib(compact.liveEstimatedBytes).toFixed(2)} GiB, reclaimable=${gib(compact.reclaimableBytes).toFixed(2)} GiB (${(Number(compact.reclaimRatio||0)*100).toFixed(1)}%). Large live DB compaction is deferred so startup cannot hang; no business data was deleted.`);
}else if(compact?.ok){
  console.log(`[CE-QC][V577][STORAGE] SQLite allocated=${gib(compact.beforeBytes).toFixed(2)} GiB, estimated live=${gib(compact.liveEstimatedBytes).toFixed(2)} GiB, reclaimable=${gib(compact.reclaimableBytes).toFixed(2)} GiB (${(Number(compact.reclaimRatio||0)*100).toFixed(1)}%). Automatic compaction skipped: ${compact.reason}.`);
}else{
  console.log(`[CE-QC][V576][STORAGE] SQLite storage analysis could not compact: ${compact?.reason||'UNKNOWN'} ${compact?.detail||''}`);
}
console.log(`[CE-QC][V577][STORAGE] compaction engine=${STORAGE_COMPACTION_PATCH}; backup-record rows retired=${backupRecordCleanup.updated||0}.`);

console.log(JSON.stringify({
  ok:true,
  patchId:PATCH_ID,
  noBackupPolicy:true,
  retentionDays:{evidence:60,logs:45},
  rolePolicy:{
    C:'launcher/code/node_modules/current logs only; CE-QC temp/old fallback data are disposable',
    D:'live SQLite/business data + runtime scratch; generated files are cleaned/aged'
  },
  removed,
  retained,
  tempCleanup,
  backupRecordCleanup,
  compact,
  deletedEntries,
  deletedBytes,
  drivesBefore,
  drivesAfter,
  dbFile:cfg.dbFile,
  databasePolicy:'LIVE_BUSINESS_DATA_IS_NEVER_SILENTLY_DELETED; V576 may VACUUM reclaimable free pages while preserving live rows, only after quick_check and free-space safety gates'
}));
