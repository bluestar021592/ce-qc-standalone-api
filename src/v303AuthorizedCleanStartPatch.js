import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getDb, getRuntimeConfig, nowIso } from './db.js';
import { BUSINESS_DATA_TABLES } from './store.js';

export const V303_AUTHORIZED_CLEAN_START_ID='2026-08-25-v303-authorized-clean-start-v1';
export const V303_AUTHORIZATION='V303_USER_AUTHORIZED_FULL_CLEAN_20260825';
const DONE_KEY='v303_authorized_clean_start_done';
const originalPost=express.application.post;
const installedApps=new WeakSet();
let inFlight=null;

function tableExists(db,name){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}
function setMeta(db,key,value){db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(key,String(value??''),nowIso());}
function getMeta(db,key){return String(db.prepare('SELECT value FROM app_meta WHERE key=?').get(key)?.value||'');}
function samePath(a,b){try{return path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();}catch{return false;}}
async function rmDir(target,warnings){if(!target||!fs.existsSync(target))return;try{await fsp.rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:250});}catch(error){warnings.push(`${target}: ${error?.message||error}`);}}
async function ensureDir(target){await fsp.mkdir(target,{recursive:true});}

async function cleanRuntimeFiles(cfg){
  const warnings=[];
  const legacy={
    evidence:path.join(cfg.dataDir,'evidence_archive'),
    imports:path.join(cfg.dataDir,'imports'),
    exports:path.join(cfg.dataDir,'exports'),
    backups:path.join(cfg.dataDir,'backups')
  };
  const current=[cfg.importsDir,cfg.exportsDir,cfg.evidenceArchiveDir].filter(Boolean);
  for(const dir of current)await rmDir(dir,warnings);
  for(const dir of Object.values(legacy)){
    if(current.some(currentDir=>samePath(currentDir,dir))||samePath(cfg.backupsDir,dir))continue;
    await rmDir(dir,warnings);
  }
  await Promise.all([ensureDir(cfg.importsDir),ensureDir(cfg.exportsDir),ensureDir(cfg.evidenceArchiveDir),ensureDir(cfg.backupsDir),ensureDir(cfg.logsDir)]);

  // V266 was written before the C/D split and keeps a stable D:\...\evidence_archive
  // path in memory. A Windows junction preserves that old pathname while placing
  // the actual archive bytes on C. This also makes already-running V266 safe after
  // the one-shot cleanup without a process restart.
  if(!samePath(legacy.evidence,cfg.evidenceArchiveDir)){
    try{
      await rmDir(legacy.evidence,warnings);
      await ensureDir(path.dirname(legacy.evidence));
      fs.symlinkSync(cfg.evidenceArchiveDir,legacy.evidence,process.platform==='win32'?'junction':'dir');
    }catch(error){warnings.push(`evidence junction: ${error?.message||error}`);}
  }
  return {warnings,legacy};
}

export async function performV303AuthorizedCleanStart({db=getDb(),cfg=getRuntimeConfig(),actor='ADMIN'}={}){
  const existingDone=getMeta(db,DONE_KEY);
  if(existingDone===V303_AUTHORIZED_CLEAN_START_ID){
    return {ok:true,alreadyDone:true,cleared:false,id:V303_AUTHORIZED_CLEAN_START_ID,storage:{dbFile:cfg.dbFile,importsDir:cfg.importsDir,exportsDir:cfg.exportsDir,backupsDir:cfg.backupsDir,logsDir:cfg.logsDir,evidenceArchiveDir:cfg.evidenceArchiveDir}};
  }

  const existingTables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
  const targets=BUSINESS_DATA_TABLES.filter(name=>existingTables.has(name));
  const foreignKeysBefore=Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys||0);
  if(foreignKeysBefore)db.exec('PRAGMA foreign_keys=OFF');
  let deletedRows=0;
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const table of targets){const result=db.prepare(`DELETE FROM ${table}`).run();deletedRows+=Number(result?.changes||0);}
    if(existingTables.has('app_state'))db.prepare(`INSERT INTO app_state(key,valueJson,updatedAt) VALUES('current','{}',?) ON CONFLICT(key) DO UPDATE SET valueJson='{}',updatedAt=excluded.updatedAt`).run(nowIso());
    if(existingTables.has('backup_records')){
      const oldBackupPrefix=path.resolve(path.join(cfg.dataDir,'backups'))+path.sep;
      if(!samePath(cfg.backupsDir,path.join(cfg.dataDir,'backups'))){
        try{db.prepare("UPDATE backup_records SET status='DELETED',deletedAt=?,deletedBy=? WHERE filePath LIKE ? AND COALESCE(status,'ACTIVE')='ACTIVE'").run(nowIso(),actor,`${oldBackupPrefix}%`);}catch{}
      }
    }
    setMeta(db,'last_processed_report_date','');
    setMeta(db,'current_snapshot_id','');
    setMeta(db,'last_full_clear_at',nowIso());
    setMeta(db,'v303_storage_policy','SQLITE_D_RUNTIME_C');
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  finally{if(foreignKeysBefore)try{db.exec('PRAGMA foreign_keys=ON');}catch{}}

  const fileCleanup=await cleanRuntimeFiles(cfg);
  let vacuum='ok';
  try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.exec('VACUUM');db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}
  catch(error){vacuum=`warning:${error?.message||error}`;}
  const integrity=String(db.prepare('PRAGMA quick_check(1)').get()?.quick_check||'');
  if(integrity!=='ok')throw new Error(`清空后SQLite校验失败：${integrity||'unknown'}`);
  setMeta(db,DONE_KEY,V303_AUTHORIZED_CLEAN_START_ID);
  setMeta(db,'v303_authorized_clean_start_completed_at',nowIso());
  try{globalThis.__CE_QC_INVALIDATE_V295_FIRST_ATTEMPT__?.('V303_AUTHORIZED_CLEAN_START');}catch{}
  return {ok:true,alreadyDone:false,cleared:true,id:V303_AUTHORIZED_CLEAN_START_ID,deletedRows,vacuum,integrity,fileCleanupWarnings:fileCleanup.warnings,storage:{dbFile:cfg.dbFile,importsDir:cfg.importsDir,exportsDir:cfg.exportsDir,backupsDir:cfg.backupsDir,logsDir:cfg.logsDir,evidenceArchiveDir:cfg.evidenceArchiveDir}};
}

async function routeHandler(req,res){
  if(String(req.user?.role||'').toUpperCase()!=='ADMIN')return res.status(403).json({ok:false,error:'仅管理员可执行一次性授权清空。'});
  if(String(req.body?.authorization||'')!==V303_AUTHORIZATION)return res.status(400).json({ok:false,error:'缺少V303一次性清空授权标记。'});
  if(process.env.CI||process.env.NODE_ENV==='test')return res.status(409).json({ok:false,error:'测试环境禁止执行生产数据清空。'});
  if(!inFlight)inFlight=performV303AuthorizedCleanStart({actor:req.user?.username||req.user?.email||'ADMIN'}).finally(()=>{inFlight=null;});
  try{return res.json(await inFlight);}catch(error){return res.status(500).json({ok:false,error:`V303一次性清空失败：${error?.message||error}`});}
}

express.application.post=function v303AuthorizedCleanStartPost(route,...handlers){
  if(!installedApps.has(this)){
    installedApps.add(this);
    originalPost.call(this,'/api/v303/authorized-clean-start',routeHandler);
  }
  return originalPost.call(this,route,...handlers);
};

console.info('[CE-QC][V303_AUTHORIZED_CLEAN_START]',V303_AUTHORIZED_CLEAN_START_ID,'route armed; destructive work occurs only after an authenticated ADMIN browser sends the explicit user-authorized marker.');
