import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeConfig, nowIso } from '../src/db.js';
import { BUSINESS_DATA_TABLES } from '../src/store.js';

const PATCH_ID='2026-09-21-v572-dual-drive-storage-housekeeping-v1';
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
function businessDataEmpty(db){
  for(const table of BUSINESS_DATA_TABLES){
    if(!tableExists(db,table))continue;
    if(db.prepare(`SELECT 1 present FROM ${table} LIMIT 1`).get()?.present)return false;
  }
  return true;
}
function compactIfPurged(dbFile){
  const beforeBytes=fs.existsSync(dbFile)?Number(fs.statSync(dbFile).size||0):0;
  const db=new DatabaseSync(dbFile);
  try{
    db.exec('PRAGMA busy_timeout=120000');
    if(tableExists(db,'backup_records')){
      db.prepare("UPDATE backup_records SET status='DELETED',deletedAt=COALESCE(deletedAt,?),deletedBy=COALESCE(NULLIF(deletedBy,''),'NO_BACKUP_POLICY') WHERE COALESCE(status,'ACTIVE')<>'DELETED'").run(nowIso());
    }
    if(!businessDataEmpty(db)){
      try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}catch{}
      return {skipped:true,reason:'BUSINESS_DATA_PRESENT',beforeBytes,afterBytes:beforeBytes,reclaimedBytes:0};
    }
    const pageCount=Number(db.prepare('PRAGMA page_count').get()?.page_count||0);
    const freePages=Number(db.prepare('PRAGMA freelist_count').get()?.freelist_count||0);
    if(beforeBytes<256*1024*1024 || freePages<1000){
      try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}catch{}
      return {skipped:true,reason:'ALREADY_COMPACT',beforeBytes,afterBytes:beforeBytes,reclaimedBytes:0,pageCount,freePages};
    }
    console.log(`[CE-QC][V572] Business tables are empty; compacting SQLite. before=${beforeBytes} freePages=${freePages}/${pageCount}`);
    try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}catch{}
    db.exec('VACUUM');
    try{db.exec('PRAGMA optimize');}catch{}
    const afterBytes=fs.existsSync(dbFile)?Number(fs.statSync(dbFile).size||0):0;
    return {skipped:false,beforeBytes,afterBytes,reclaimedBytes:Math.max(0,beforeBytes-afterBytes),pageCount,freePages};
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
  {kind:'LAUNCHER_TEMP',...removeChildren(launcherTempRoot)}
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

const compact=compactIfPurged(cfg.dbFile);
const drivesAfter={C:driveSnapshot(cRoot),D:driveSnapshot(dRoot)};
const deletedBytes=[...removed,...retained,...tempCleanup].reduce((sum,item)=>sum+Number(item.deletedBytes||0),0);

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
  compact,
  deletedBytes,
  drivesBefore,
  drivesAfter,
  dbFile:cfg.dbFile,
  databasePolicy:'LIVE_BUSINESS_DATA_IS_NEVER_SILENTLY_DELETED; after explicit monthly/bi-monthly clear, startup VACUUM reclaims SQLite space'
}));
