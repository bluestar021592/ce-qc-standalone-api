import fs from 'node:fs';
import path from 'node:path';

import { getDb, getRuntimeConfig } from './db.js';

export const V505_PURGE_WRITE_FREEZE_ID='2026-09-11-v505-external-worker-write-freeze-v1';
const PURGE_BLOCK_KEY='data_purge_block_until';
const ACTIVE=new Set(['QUEUED','RUNNING']);
const PREPARE_DIR='.purge_prepare_jobs';
const EXECUTE_DIR='.purge_execute_jobs';

function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function pidAlive(pid){
  const value=Number(pid||0);
  if(!Number.isInteger(value)||value<=0)return null;
  try{process.kill(value,0);return true;}catch(error){return error?.code==='EPERM'?true:false;}
}
function sqliteBlockUntil(){
  try{return Number(getDb().prepare('SELECT value FROM app_meta WHERE key=?').get(PURGE_BLOCK_KEY)?.value||0);}catch{return 0;}
}
function jobFiles(dir){
  let names=[];
  try{names=fs.readdirSync(dir).filter(name=>name.endsWith('.job.json'));}catch{return [];}
  return names.map(name=>path.join(dir,name));
}

export function inspectExternalPurgeWriteFreeze(){
  const cfg=getRuntimeConfig();
  const now=Date.now();
  const groups=[
    {kind:'EXECUTE',dir:path.join(cfg.backupsDir,EXECUTE_DIR)},
    {kind:'PREPARE',dir:path.join(cfg.backupsDir,PREPARE_DIR)}
  ];
  for(const group of groups){
    for(const file of jobFiles(group.dir)){
      const job=readJson(file);if(!job)continue;
      const status=String(job.status||'').toUpperCase();
      if(ACTIVE.has(status)){
        const alive=pidAlive(job.workerPid);
        if(alive!==false){
          return {active:true,kind:group.kind,status,workerState:alive===true?'ALIVE':'UNKNOWN',jobId:String(job.jobId||'')};
        }
      }
      if(group.kind==='PREPARE'&&status==='SUCCEEDED'){
        const expiresAt=Date.parse(String(job.payload?.expiresAt||''));
        if(Number.isFinite(expiresAt)&&expiresAt>now){
          return {active:true,kind:group.kind,status,workerState:'COMPLETED_WAITING_EXECUTE',jobId:String(job.jobId||''),expiresAt};
        }
      }
    }
  }
  return {active:false};
}

export function v505PurgeWriteFreezeGuard(req,res,next){
  if(!['POST','PUT','PATCH','DELETE'].includes(String(req.method||'').toUpperCase()))return next();
  const pathname=String(req.originalUrl||req.url||req.path||'').split('?')[0];
  if(/^\/api\/admin\/data-purge\/(?:prepare|execute)$/.test(pathname))return next();
  const until=sqliteBlockUntil();
  const external=inspectExternalPurgeWriteFreeze();
  if((Number.isFinite(until)&&until>Date.now())||external.active){
    return res.status(423).json({
      ok:false,
      code:'DATA_PURGE_IN_PROGRESS',
      error:'系统正在执行安全备份或清空业务数据。为防止备份后的数据库继续变化，当前写入已临时锁定。',
      until:Number.isFinite(until)&&until>Date.now()?new Date(until).toISOString():'',
      protectedBy:external.active?`${external.kind}:${external.status}`:'SQLITE_PURGE_BLOCK',
      guardPatch:V505_PURGE_WRITE_FREEZE_ID
    });
  }
  return next();
}
