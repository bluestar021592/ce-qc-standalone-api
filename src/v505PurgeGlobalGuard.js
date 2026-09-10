import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getDb, getRuntimeConfig } from './db.js';

export const V505_PURGE_GLOBAL_GUARD_ID='2026-09-10-v505-global-single-owner-v1';
const ACTIVE=new Set(['QUEUED','RUNNING']);
const PREPARE_DIR='.purge_prepare_jobs';
const EXECUTE_DIR='.purge_execute_jobs';
const PURGE_BLOCK_KEY='data_purge_block_until';

function identityKey(user={}){
  const identity=String(user.id||user.email||user.username||'').trim().toLowerCase();
  if(!identity)return '';
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0,24);
}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function pidAlive(pid){
  const value=Number(pid||0);
  if(!Number.isInteger(value)||value<=0)return null;
  try{process.kill(value,0);return true;}catch(error){return error?.code==='EPERM'?true:false;}
}
function blockUntil(){
  try{return Number(getDb().prepare('SELECT value FROM app_meta WHERE key=?').get(PURGE_BLOCK_KEY)?.value||0);}catch{return 0;}
}
function listJobs(directory){
  let names=[];
  try{names=fs.readdirSync(directory).filter(name=>name.endsWith('.job.json'));}catch{return [];}
  return names.map(name=>({name,file:path.join(directory,name),job:readJson(path.join(directory,name))})).filter(row=>row.job);
}
function foreignOwnerBlock(user={}){
  const own=`${identityKey(user)}.job.json`;
  const cfg=getRuntimeConfig();
  const now=Date.now();
  const lockedUntil=blockUntil();
  const groups=[
    {kind:'EXECUTE',dir:path.join(cfg.backupsDir,EXECUTE_DIR)},
    {kind:'PREPARE',dir:path.join(cfg.backupsDir,PREPARE_DIR)}
  ];
  for(const group of groups){
    for(const row of listJobs(group.dir)){
      if(row.name===own)continue;
      const status=String(row.job.status||'').toUpperCase();
      if(ACTIVE.has(status)){
        const alive=pidAlive(row.job.workerPid);
        if(alive!==false||lockedUntil>now){
          return {kind:group.kind,status,workerState:alive===true?'ALIVE':alive===false?'DEAD':'UNKNOWN',jobId:String(row.job.jobId||''),lockedUntil};
        }
        continue;
      }
      if(group.kind==='PREPARE'&&status==='SUCCEEDED'){
        const expiresAt=Date.parse(String(row.job.payload?.expiresAt||''));
        if(Number.isFinite(expiresAt)&&expiresAt>now){
          return {kind:group.kind,status,workerState:'COMPLETED_WAITING_OWNER',jobId:String(row.job.jobId||''),lockedUntil:Math.max(lockedUntil,expiresAt)};
        }
      }
    }
  }
  return null;
}

export function v505PurgeGlobalOwnerGuard(req,res,next){
  try{
    const foreign=foreignOwnerBlock(req.user||{});
    if(!foreign)return next();
    const phase=foreign.kind==='EXECUTE'?'清空':'安全备份';
    return res.status(423).json({
      ok:false,
      code:'DATA_PURGE_OWNED_BY_ANOTHER_ADMIN',
      error:`另一名管理员已有${phase}任务处于受保护状态。系统不会启动第二个任务，请等待当前任务完成或安全锁到期后再试。`,
      phase:foreign.kind,
      status:foreign.status,
      workerState:foreign.workerState,
      lockedUntil:foreign.lockedUntil>0?new Date(foreign.lockedUntil).toISOString():'',
      guardPatch:V505_PURGE_GLOBAL_GUARD_ID
    });
  }catch(error){
    return res.status(423).json({ok:false,code:'DATA_PURGE_GLOBAL_GUARD_UNAVAILABLE',error:`无法确认全局清空任务所有权，已安全阻止本次操作：${error?.message||String(error)}`,guardPatch:V505_PURGE_GLOBAL_GUARD_ID});
  }
}
