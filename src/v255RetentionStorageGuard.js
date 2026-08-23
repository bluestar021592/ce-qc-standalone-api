import fs from 'fs';
import path from 'path';
import { getDb, getRuntimeConfig } from './db.js';

export const V255_RETENTION_STORAGE_ID='2026-08-23-v255-one-year-retention-storage-guard-v1';
const DAY=24*60*60*1000;
const BUSINESS_RETENTION_DAYS=400; // one year + safety buffer
const BACKUP_MIN_AGE_DAYS=14;
const BACKUP_KEEP_NEWEST=2;
const WAL_CHECK_BYTES=512*1024*1024;

function stat(file){try{return fs.statSync(file);}catch{return null;}}
function isFullBackupFile(name){return /\.(?:db|sqlite|sqlite3|bak|backup|zip)$/i.test(String(name||''));}
function listFiles(dir){try{return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const file=path.join(dir,e.name),s=stat(file);return s?{file,name:e.name,bytes:Number(s.size||0),mtimeMs:Number(s.mtimeMs||0)}:null;}).filter(Boolean):[];}catch{return[];}}

export function pruneRedundantFullBackups({dryRun=false}={}){
  const cfg=getRuntimeConfig();
  const files=listFiles(cfg.backupsDir).filter(f=>isFullBackupFile(f.name)).sort((a,b)=>b.mtimeMs-a.mtimeMs);
  const cutoff=Date.now()-BACKUP_MIN_AGE_DAYS*DAY;
  const removable=files.slice(BACKUP_KEEP_NEWEST).filter(f=>f.mtimeMs<cutoff);
  const removed=[];let reclaimed=0;
  for(const item of removable){
    try{if(!dryRun)fs.unlinkSync(item.file);removed.push(item.file);reclaimed+=item.bytes;}catch(error){console.warn('[CE-QC][V255_STORAGE] backup prune skipped:',item.name,error?.message||error);}
  }
  return{files:files.length,keptAtLeast:Math.min(files.length,BACKUP_KEEP_NEWEST),removed:removed.length,reclaimedBytes:reclaimed,dryRun};
}

export function safeWalCheckpoint(){
  const cfg=getRuntimeConfig();const wal=`${cfg.dbFile}-wal`;const s=stat(wal);if(!s||Number(s.size||0)<WAL_CHECK_BYTES)return{attempted:false,walBytes:Number(s?.size||0)};
  try{
    const db=getDb();
    const passive=db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get()||{};
    const busy=Number(passive.busy??passive[0]??0);
    if(busy!==0)return{attempted:true,truncated:false,busy,walBytes:Number(s.size||0)};
    const truncate=db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()||{};
    return{attempted:true,truncated:Number(truncate.busy??truncate[0]??0)===0,busy:Number(truncate.busy??truncate[0]??0),walBytes:Number(s.size||0),afterBytes:Number(stat(wal)?.size||0)};
  }catch(error){return{attempted:true,truncated:false,error:String(error?.message||error),walBytes:Number(s.size||0)};}
}

export function retentionPolicyStatus(){
  const db=getDb();
  let archiveRows=[];
  try{archiveRows=db.prepare("SELECT value FROM app_meta WHERE key LIKE 'v255_archive_verified_%' ORDER BY key").all();}catch{}
  const verifiedYears=archiveRows.map(r=>String(r.value||'')).filter(Boolean);
  return{policyId:V255_RETENTION_STORAGE_ID,businessRetentionDays:BUSINESS_RETENTION_DAYS,archiveRequiredBeforeBusinessDelete:true,verifiedYears,note:'NO BUSINESS ROW IS AUTO-DELETED WITHOUT VERIFIED CLOUD ARCHIVE'};
}

function schedule(){
  const first=setTimeout(()=>{
    try{console.log('[CE-QC][V255_STORAGE] backup guard',JSON.stringify(pruneRedundantFullBackups()));}catch(error){console.warn('[CE-QC][V255_STORAGE] backup guard failed:',error?.message||error);}
    try{console.log('[CE-QC][V255_STORAGE] wal guard',JSON.stringify(safeWalCheckpoint()));}catch(error){console.warn('[CE-QC][V255_STORAGE] wal guard failed:',error?.message||error);}
    try{console.log('[CE-QC][V255_RETENTION]',JSON.stringify(retentionPolicyStatus()));}catch{}
  },90_000);first.unref?.();
  const walTimer=setInterval(()=>{try{const result=safeWalCheckpoint();if(result.attempted)console.log('[CE-QC][V255_STORAGE] periodic wal checkpoint',JSON.stringify(result));}catch{}},30*60_000);walTimer.unref?.();
}
schedule();
