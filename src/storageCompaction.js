import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const STORAGE_COMPACTION_PATCH='2026-09-21-v576-live-sqlite-space-reclaim-v1';

function numberPragma(db,name){
  const row=db.prepare('PRAGMA '+name).get()||{};
  const value=row[name] ?? Object.values(row)[0] ?? 0;
  return Number(value||0);
}
function quickCheck(db){
  try{
    const rows=db.prepare('PRAGMA quick_check').all();
    if(!Array.isArray(rows)||!rows.length)return {ok:false,detail:'EMPTY_QUICK_CHECK'};
    const values=rows.map(row=>String(Object.values(row||{})[0]||'').trim()).filter(Boolean);
    return {ok:values.length===1&&values[0].toLowerCase()==='ok',detail:values.slice(0,8).join(' | ')};
  }catch(error){
    return {ok:false,detail:String(error?.message||error)};
  }
}
function driveFreeBytes(file){
  try{
    const root=path.parse(path.resolve(file)).root;
    const stat=fs.statfsSync(root);
    const block=Number(stat.bsize||stat.frsize||0);
    return block*Number(stat.bavail??stat.bfree??0);
  }catch{return 0;}
}
function fileBytes(file){
  try{return Number(fs.statSync(file).size||0);}catch{return 0;}
}
function siblingBytes(file,suffix){
  return fileBytes(file+suffix);
}

export function analyzeSqliteStorage(dbFile){
  const beforeBytes=fileBytes(dbFile);
  const walBytes=siblingBytes(dbFile,'-wal');
  const shmBytes=siblingBytes(dbFile,'-shm');
  if(!beforeBytes)return {ok:false,reason:'DB_MISSING',dbFile,beforeBytes,walBytes,shmBytes};
  const db=new DatabaseSync(dbFile);
  try{
    db.exec('PRAGMA busy_timeout=120000');
    try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}catch{}
    const pageCount=numberPragma(db,'page_count');
    const freePages=numberPragma(db,'freelist_count');
    const pageSize=numberPragma(db,'page_size')||4096;
    const autoVacuum=numberPragma(db,'auto_vacuum');
    const reclaimableBytes=Math.max(0,freePages*pageSize);
    const allocatedBytes=Math.max(beforeBytes,pageCount*pageSize);
    const liveEstimatedBytes=Math.max(0,allocatedBytes-reclaimableBytes);
    const reclaimRatio=allocatedBytes>0?reclaimableBytes/allocatedBytes:0;
    const check=quickCheck(db);
    return {
      ok:check.ok,
      reason:check.ok?'ANALYZED':'QUICK_CHECK_FAILED',
      detail:check.detail,
      dbFile,
      beforeBytes:fileBytes(dbFile),
      walBytes:siblingBytes(dbFile,'-wal'),
      shmBytes:siblingBytes(dbFile,'-shm'),
      pageCount,freePages,pageSize,autoVacuum,
      allocatedBytes,reclaimableBytes,liveEstimatedBytes,reclaimRatio,
      driveFreeBytes:driveFreeBytes(dbFile)
    };
  }finally{
    try{db.close();}catch{}
  }
}

export function compactSqliteStorage(dbFile,options={}){
  const minReclaimBytes=Math.max(1,Number(options.minReclaimBytes ?? 256*1024*1024));
  const minReclaimRatio=Math.max(0,Math.min(1,Number(options.minReclaimRatio ?? 0.08)));
  const reserveBytes=Math.max(0,Number(options.reserveBytes ?? 1024*1024*1024));
  const force=options.force===true;
  const before=analyzeSqliteStorage(dbFile);
  if(!before.ok)return {...before,compacted:false,reclaimedBytes:0};
  if(!force && before.reclaimableBytes<minReclaimBytes){
    return {...before,compacted:false,reason:'RECLAIM_BELOW_MINIMUM',reclaimedBytes:0,minReclaimBytes,minReclaimRatio};
  }
  if(!force && before.reclaimRatio<minReclaimRatio){
    return {...before,compacted:false,reason:'RECLAIM_RATIO_BELOW_MINIMUM',reclaimedBytes:0,minReclaimBytes,minReclaimRatio};
  }
  const requiredFreeBytes=Math.max(reserveBytes,before.liveEstimatedBytes+reserveBytes);
  if(before.driveFreeBytes>0 && before.driveFreeBytes<requiredFreeBytes){
    return {...before,compacted:false,reason:'INSUFFICIENT_FREE_SPACE_FOR_SAFE_VACUUM',reclaimedBytes:0,requiredFreeBytes};
  }

  const db=new DatabaseSync(dbFile);
  let afterCheck={ok:false,detail:'NOT_RUN'};
  try{
    db.exec('PRAGMA busy_timeout=120000');
    const pre=quickCheck(db);
    if(!pre.ok)return {...before,compacted:false,reason:'QUICK_CHECK_FAILED_BEFORE_VACUUM',detail:pre.detail,reclaimedBytes:0};
    try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}catch{}
    db.exec('VACUUM');
    try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}catch{}
    afterCheck=quickCheck(db);
    if(!afterCheck.ok){
      return {...before,compacted:false,reason:'QUICK_CHECK_FAILED_AFTER_VACUUM',detail:afterCheck.detail,reclaimedBytes:0};
    }
  }catch(error){
    return {...before,compacted:false,reason:'VACUUM_FAILED',detail:String(error?.message||error),reclaimedBytes:0};
  }finally{
    try{db.close();}catch{}
  }

  const after=analyzeSqliteStorage(dbFile);
  const afterBytes=fileBytes(dbFile);
  return {
    ...after,
    compacted:true,
    reason:'VACUUM_COMPLETED',
    beforeBytes:before.beforeBytes,
    afterBytes,
    beforeWalBytes:before.walBytes,
    afterWalBytes:siblingBytes(dbFile,'-wal'),
    reclaimableBeforeBytes:before.reclaimableBytes,
    reclaimRatioBefore:before.reclaimRatio,
    reclaimedBytes:Math.max(0,before.beforeBytes-afterBytes),
    requiredFreeBytes,
    quickCheckBefore:before.detail,
    quickCheckAfter:afterCheck.detail
  };
}
