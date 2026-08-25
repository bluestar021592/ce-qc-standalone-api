import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import '../src/v294CleanReuploadIntegrity.js';
import { BUSINESS_DATA_TABLES } from '../src/store.js';

function statFingerprint(file){
  try{
    const stat=fs.statSync(file);
    return {exists:true,size:Number(stat.size||0),mtimeMs:Number(stat.mtimeMs||0)};
  }catch{return {exists:false,size:0,mtimeMs:0};}
}
function databaseFingerprint(dbFile){return {db:statFingerprint(dbFile),wal:statFingerprint(`${dbFile}-wal`)};}
function sameStatFingerprint(a={},b={}){
  return Boolean(a.exists)===Boolean(b.exists)&&Number(a.size||0)===Number(b.size||0)&&Math.abs(Number(a.mtimeMs||0)-Number(b.mtimeMs||0))<=1;
}
function sameFingerprint(a={},b={}){return sameStatFingerprint(a.db,b.db)&&sameStatFingerprint(a.wal,b.wal);}
function decodePayload(){
  const raw=String(process.argv[2]||'');
  if(!raw)throw new Error('PURGE_WORKER_PAYLOAD_MISSING');
  return JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
}
async function clearRegenerableFiles(payload){
  const warnings=[];
  for(const dir of [payload.exportsDir,payload.importsDir]){
    if(!dir||!fs.existsSync(dir))continue;
    const entries=fs.readdirSync(dir);
    for(let index=0;index<entries.length;index+=1){
      const entry=entries[index];
      try{await fs.promises.rm(path.join(dir,entry),{recursive:true,force:true});}
      catch(error){warnings.push(`${entry}: ${error?.message||String(error)}`);}
      if(index%20===19)await new Promise(resolve=>setImmediate(resolve));
    }
  }
  if(payload.longJsonExportsDir)fs.mkdirSync(payload.longJsonExportsDir,{recursive:true});
  return warnings;
}

let db=null;
try{
  const payload=decodePayload();
  const dbFile=String(payload.dbFile||'');
  if(!dbFile||!fs.existsSync(dbFile))throw new Error('PURGE_DATABASE_NOT_FOUND');
  const expectedFingerprint=payload.expectedFingerprint||{};
  db=new DatabaseSync(dbFile,{timeout:60000});
  db.exec('PRAGMA busy_timeout=60000; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON');
  const existing=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
  const clearTargets=BUSINESS_DATA_TABLES.filter(name=>existing.has(name));
  const before={};
  const after={};
  const foreignKeysBefore=Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys||0);
  if(foreignKeysBefore)db.exec('PRAGMA foreign_keys=OFF');
  db.exec('BEGIN IMMEDIATE');
  try{
    const lockedFingerprint=databaseFingerprint(dbFile);
    if(!sameFingerprint(expectedFingerprint,lockedFingerprint))throw new Error('DATABASE_CHANGED_BEFORE_PURGE_WORKER_LOCK');
    for(const table of clearTargets){
      const deleted=db.prepare(`DELETE FROM ${table}`).run();
      before[table]=Number(deleted?.changes||0);
      if(db.prepare(`SELECT 1 AS present FROM ${table} LIMIT 1`).get()?.present)throw new Error(`PURGE_TABLE_NOT_EMPTY:${table}`);
      after[table]=0;
    }
    const now=new Date().toISOString();
    db.prepare(`INSERT INTO app_state(key,valueJson,updatedAt) VALUES('current',?,?) ON CONFLICT(key) DO UPDATE SET valueJson=excluded.valueJson,updatedAt=excluded.updatedAt`).run(JSON.stringify(payload.nextState||{logs:[]}),now);
    const meta=db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
    meta.run('last_processed_report_date','',now);
    meta.run('last_full_clear_at',now,now);
    meta.run('current_snapshot_id','',now);
    meta.run('v108_performance_indexes_ready','1',now);
    db.prepare("DELETE FROM app_meta WHERE key LIKE 'carry_refresh_%' OR key IN ('dashboard_cache_worker_active','dashboard_cache_worker_active_until','data_purge_block_until')").run();
    db.exec('COMMIT');
  }catch(error){
    try{db.exec('ROLLBACK');}catch{}
    throw error;
  }finally{
    if(foreignKeysBefore)try{db.exec('PRAGMA foreign_keys=ON');}catch{}
  }
  const fk=Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys||0);
  if(fk!==1)throw new Error('PURGE_WORKER_FOREIGN_KEYS_NOT_RESTORED');
  for(const table of ['app_meta','app_state','users','audit_logs','backup_records']){
    if(!db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table)?.ok)throw new Error(`PURGE_REQUIRED_TABLE_MISSING:${table}`);
  }
  db.close();db=null;
  const fileCleanupWarnings=await clearRegenerableFiles(payload);
  process.stdout.write(`${JSON.stringify({ok:true,before,after,fileCleanupWarnings,deleteMode:'ISOLATED_SQLITE_WORKER'})}\n`);
  process.exit(0);
}catch(error){
  try{db?.close();}catch{}
  process.stderr.write(`[PURGE WORKER] ${error?.stack||error?.message||String(error)}\n`);
  process.stdout.write(`${JSON.stringify({ok:false,error:error?.message||String(error)})}\n`);
  process.exit(1);
}
