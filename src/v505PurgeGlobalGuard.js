import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getDb, getRuntimeConfig, nowIso } from './db.js';

export const V505_PURGE_GLOBAL_GUARD_ID='2026-09-11-v505-global-single-owner-v2';
const ACTIVE=new Set(['QUEUED','RUNNING']);
const PREPARE_DIR='.purge_prepare_jobs';
const EXECUTE_DIR='.purge_execute_jobs';
const PURGE_BLOCK_KEY='data_purge_block_until';
const SUBMISSION_MUTEX_KEY='data_purge_submission_mutex';
const PROCESS_INSTANCE_TOKEN=crypto.randomBytes(16).toString('hex');

function identityKey(user={}){
  const identity=String(user.id||user.email||user.username||'').trim().toLowerCase();
  if(!identity)return '';
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0,24);
}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function safeJson(value){try{return JSON.parse(String(value||''));}catch{return null;}}
function pidAlive(pid){
  const value=Number(pid||0);
  if(!Number.isInteger(value)||value<=0)return null;
  try{process.kill(value,0);return true;}catch(error){return error?.code==='EPERM'?true:false;}
}
function blockUntil(db=getDb()){
  try{return Number(db.prepare('SELECT value FROM app_meta WHERE key=?').get(PURGE_BLOCK_KEY)?.value||0);}catch{return 0;}
}
function listJobs(directory){
  let names=[];
  try{names=fs.readdirSync(directory).filter(name=>name.endsWith('.job.json'));}catch{return [];}
  return names.map(name=>({name,file:path.join(directory,name),job:readJson(path.join(directory,name))})).filter(row=>row.job);
}
function protectedJob(group,row,lockedUntil,now){
  const status=String(row.job.status||'').toUpperCase();
  if(ACTIVE.has(status)){
    const alive=pidAlive(row.job.workerPid);
    if(alive!==false||lockedUntil>now){
      return {kind:group.kind,status,workerState:alive===true?'ALIVE':alive===false?'DEAD_LOCKED':'UNKNOWN',jobId:String(row.job.jobId||''),lockedUntil};
    }
    return null;
  }
  if(group.kind==='PREPARE'&&status==='SUCCEEDED'){
    const expiresAt=Date.parse(String(row.job.payload?.expiresAt||''));
    if(Number.isFinite(expiresAt)&&expiresAt>now){
      return {kind:group.kind,status,workerState:'COMPLETED_WAITING_OWNER',jobId:String(row.job.jobId||''),lockedUntil:Math.max(lockedUntil,expiresAt)};
    }
  }
  return null;
}

export function inspectGlobalPurgeOwnership(user={}){
  const ownName=`${identityKey(user)}.job.json`;
  const cfg=getRuntimeConfig();
  const now=Date.now();
  const lockedUntil=blockUntil();
  const groups=[
    {kind:'EXECUTE',dir:path.join(cfg.backupsDir,EXECUTE_DIR)},
    {kind:'PREPARE',dir:path.join(cfg.backupsDir,PREPARE_DIR)}
  ];
  const own=[];
  let foreign=null;
  for(const group of groups){
    for(const row of listJobs(group.dir)){
      const protectedState=protectedJob(group,row,lockedUntil,now);
      if(!protectedState)continue;
      if(row.name===ownName)own.push(protectedState);
      else if(!foreign)foreign=protectedState;
    }
  }
  const ownProtected=own.length>0;
  const orphanedLock=lockedUntil>now&&!ownProtected&&!foreign;
  return {foreign,own,ownProtected,orphanedLock,lockedUntil};
}

function existingMutexBlocks(record={}){
  if(!record||typeof record!=='object')return true;
  const pid=Number(record.pid||0);
  if(pid===process.pid&&String(record.processInstanceToken||'')!==PROCESS_INSTANCE_TOKEN)return false;
  const alive=pidAlive(pid);
  if(alive===false)return false;
  return true;
}

export function acquireGlobalPurgeSubmissionMutex(user={}){
  const db=getDb();
  const ownerKey=identityKey(user);
  if(!ownerKey)throw new Error('缺少管理员身份，无法申请全局清空提交锁。');
  const requestToken=crypto.randomUUID();
  const record={
    ownerKey,
    pid:process.pid,
    processInstanceToken:PROCESS_INSTANCE_TOKEN,
    requestToken,
    acquiredAt:Date.now()
  };
  db.exec('BEGIN IMMEDIATE');
  try{
    const currentRaw=String(db.prepare('SELECT value FROM app_meta WHERE key=?').get(SUBMISSION_MUTEX_KEY)?.value||'');
    const current=currentRaw?safeJson(currentRaw):null;
    if(currentRaw&&existingMutexBlocks(current)){
      db.exec('ROLLBACK');
      return {acquired:false,current};
    }
    db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`)
      .run(SUBMISSION_MUTEX_KEY,JSON.stringify(record),nowIso());
    db.exec('COMMIT');
    return {acquired:true,record};
  }catch(error){
    try{db.exec('ROLLBACK');}catch{}
    throw error;
  }
}

export function releaseGlobalPurgeSubmissionMutex(record={}){
  if(!record?.requestToken)return false;
  const db=getDb();
  const currentRaw=String(db.prepare('SELECT value FROM app_meta WHERE key=?').get(SUBMISSION_MUTEX_KEY)?.value||'');
  const current=safeJson(currentRaw);
  if(!current||String(current.requestToken||'')!==String(record.requestToken)||String(current.processInstanceToken||'')!==PROCESS_INSTANCE_TOKEN)return false;
  db.prepare('DELETE FROM app_meta WHERE key=?').run(SUBMISSION_MUTEX_KEY);
  return true;
}

function blocked(res,code,error,detail={}){
  return res.status(423).json({ok:false,code,error,...detail,guardPatch:V505_PURGE_GLOBAL_GUARD_ID});
}

export function v505PurgeGlobalOwnerGuard(req,res,next){
  try{
    const ownership=inspectGlobalPurgeOwnership(req.user||{});
    if(ownership.foreign){
      const phase=ownership.foreign.kind==='EXECUTE'?'清空':'安全备份';
      return blocked(res,'DATA_PURGE_OWNED_BY_ANOTHER_ADMIN',`另一名管理员已有${phase}任务处于受保护状态。系统不会启动第二个任务，请等待当前任务完成或安全锁到期后再试。`,{
        phase:ownership.foreign.kind,
        status:ownership.foreign.status,
        workerState:ownership.foreign.workerState,
        lockedUntil:ownership.foreign.lockedUntil>0?new Date(ownership.foreign.lockedUntil).toISOString():''
      });
    }
    if(ownership.orphanedLock){
      return blocked(res,'DATA_PURGE_GLOBAL_LOCK_ORPHANED','检测到仍有效的全局清空安全锁，但无法确认其任务所有者。为避免并发清空，系统已安全阻止本次操作。',{
        lockedUntil:new Date(ownership.lockedUntil).toISOString()
      });
    }

    const pathname=String(req.originalUrl||req.url||req.path||'').split('?')[0];
    const isPrepare=pathname==='/api/admin/data-purge/prepare';
    if(isPrepare&&ownership.ownProtected)return next();

    const mutex=acquireGlobalPurgeSubmissionMutex(req.user||{});
    if(!mutex.acquired){
      return blocked(res,'DATA_PURGE_SUBMISSION_BUSY','另一项清空提交正在进入受保护任务队列。系统不会并发创建第二个备份或删除任务，请稍后重试。');
    }
    let released=false;
    const release=()=>{
      if(released)return;
      released=true;
      try{releaseGlobalPurgeSubmissionMutex(mutex.record);}catch{}
    };
    res.once?.('finish',release);
    res.once?.('close',release);
    try{return next();}
    catch(error){release();throw error;}
  }catch(error){
    return blocked(res,'DATA_PURGE_GLOBAL_GUARD_UNAVAILABLE',`无法确认全局清空任务所有权，已安全阻止本次操作：${error?.message||String(error)}`);
  }
}
