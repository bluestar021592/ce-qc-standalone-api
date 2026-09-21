import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeConfig, nowIso } from '../src/db.js';
import { BUSINESS_DATA_TABLES } from '../src/store.js';

const PATCH_ID='2026-09-21-v568-no-backup-space-reclaim-v1';

function safeInside(parent,target){
  const root=path.resolve(parent);
  const child=path.resolve(target);
  return child===root || child.startsWith(root+path.sep);
}
function removeChildren(root){
  const result={root:path.resolve(root),deletedEntries:0,deletedBytes:0,failed:[]};
  if(!fs.existsSync(root))return result;
  for(const entry of fs.readdirSync(root,{withFileTypes:true})){
    const target=path.join(root,entry.name);
    if(!safeInside(root,target))continue;
    try{
      let bytes=0;
      if(entry.isFile()){try{bytes=Number(fs.statSync(target).size||0);}catch{}}
      fs.rmSync(target,{recursive:true,force:true,maxRetries:3,retryDelay:120});
      result.deletedEntries+=1;
      result.deletedBytes+=bytes;
    }catch(error){result.failed.push({target,error:String(error?.message||error)});}
  }
  return result;
}
function cleanupCandidateTemps(){
  const root=os.tmpdir();
  const result={root,deletedEntries:0,failed:[]};
  if(!fs.existsSync(root))return result;
  for(const entry of fs.readdirSync(root,{withFileTypes:true})){
    if(!entry.isDirectory() || !/^CE_QC_UPDATE_VERIFY_/i.test(entry.name))continue;
    const target=path.join(root,entry.name);
    try{fs.rmSync(target,{recursive:true,force:true,maxRetries:3,retryDelay:120});result.deletedEntries+=1;}
    catch(error){result.failed.push({target,error:String(error?.message||error)});}
  }
  return result;
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
    if(!businessDataEmpty(db))return {skipped:true,reason:'BUSINESS_DATA_PRESENT',beforeBytes,afterBytes:beforeBytes,reclaimedBytes:0};
    const pageCount=Number(db.prepare('PRAGMA page_count').get()?.page_count||0);
    const freePages=Number(db.prepare('PRAGMA freelist_count').get()?.freelist_count||0);
    if(beforeBytes<256*1024*1024 || freePages<1000){
      try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}catch{}
      return {skipped:true,reason:'ALREADY_COMPACT',beforeBytes,afterBytes:beforeBytes,reclaimedBytes:0,pageCount,freePages};
    }
    console.log(`[CE-QC][V568] Business tables are empty; compacting SQLite to reclaim disk space. before=${beforeBytes} freePages=${freePages}/${pageCount}`);
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
const launcherBackupRoot=process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA,'CE_QC_LAUNCHER','backups','pre_update')
  : path.join(cfg.projectRoot||process.cwd(),'.ce-qc-launcher','backups','pre_update');

const cleanupTargets=[
  {kind:'DATA_BACKUPS',path:cfg.backupsDir},
  {kind:'LAUNCHER_PRE_UPDATE',path:launcherBackupRoot},
  {kind:'IMPORTS',path:cfg.importsDir},
  {kind:'EXPORTS',path:cfg.exportsDir},
  {kind:'LONG_JSON',path:cfg.longJsonExportsDir},
  {kind:'EVIDENCE_ARCHIVE',path:cfg.evidenceArchiveDir}
];

const removed=cleanupTargets.map(item=>({kind:item.kind,...removeChildren(item.path)}));
const tempCleanup=cleanupCandidateTemps();
const compact=compactIfPurged(cfg.dbFile);
console.log(JSON.stringify({ok:true,patchId:PATCH_ID,noBackupPolicy:true,removed,tempCleanup,compact,dbFile:cfg.dbFile}));
