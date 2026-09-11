import fs from 'node:fs';
import path from 'node:path';

import { getDb, getRuntimeConfig } from './db.js';

export const V505_PURGE_WRITE_FREEZE_ID='2026-09-11-v505-external-worker-write-freeze-v2';
const PURGE_BLOCK_KEY='data_purge_block_until';
const ACTIVE=new Set(['QUEUED','RUNNING']);
const PREPARE_DIR='.purge_prepare_jobs';
const EXECUTE_DIR='.purge_execute_jobs';
const SUBMISSION_MUTEX_FILE='.purge_global_submission.lock.json';
const PURGE_CONTROL=/^\/api\/admin\/data-purge\/(?:prepare|execute)$/;
const PURGE_STATUS=/^\/purge-status\/[a-f0-9]{48}\.json$/i;
const SAFE_READ_APIS=new Set(['/api/health','/api/session','/api/bootstrap','/api/backups']);
let queryOnlyState=null;

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
function submissionMutexState(){
  const cfg=getRuntimeConfig();
  const file=path.join(cfg.backupsDir,SUBMISSION_MUTEX_FILE);
  if(!fs.existsSync(file))return null;
  const record=readJson(file);
  if(!record)return {active:true,kind:'SUBMISSION',status:'UNKNOWN',workerState:'UNKNOWN',jobId:''};
  const alive=pidAlive(record.pid);
  if(alive===false)return null;
  return {active:true,kind:'SUBMISSION',status:'LOCKED',workerState:alive===true?'ALIVE':'UNKNOWN',jobId:String(record.requestToken||'')};
}

export function inspectExternalPurgeWriteFreeze(){
  const submission=submissionMutexState();
  if(submission)return submission;
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

export function inspectPurgeWriteFreezeState(){
  const until=sqliteBlockUntil();
  const external=inspectExternalPurgeWriteFreeze();
  const sqliteActive=Number.isFinite(until)&&until>Date.now();
  return {
    active:Boolean(sqliteActive||external.active),
    sqliteActive,
    until:sqliteActive?until:0,
    external
  };
}

export function syncPurgeQueryOnly(active){
  const wanted=Boolean(active);
  try{
    const db=getDb();
    const current=Number(db.prepare('PRAGMA query_only').get()?.query_only||0)===1;
    if(current!==wanted)db.exec(`PRAGMA query_only=${wanted?'ON':'OFF'}`);
    queryOnlyState=wanted;
    return {ok:true,active:wanted};
  }catch(error){
    if(wanted)console.error('[CE-QC][V505_PURGE_QUERY_ONLY_FAILED]',error?.message||error);
    queryOnlyState=null;
    return {ok:false,active:wanted,error:String(error?.message||error)};
  }
}

function allowedDuringFreeze(method,pathname){
  if(PURGE_STATUS.test(pathname)&&['GET','HEAD'].includes(method))return true;
  if(PURGE_CONTROL.test(pathname)&&method==='POST')return true;
  if(SAFE_READ_APIS.has(pathname)&&['GET','HEAD'].includes(method))return true;
  if(!pathname.startsWith('/api/')&&['GET','HEAD','OPTIONS'].includes(method))return true;
  if(method==='OPTIONS')return true;
  return false;
}

export function v505PurgeWriteFreezeGuard(req,res,next){
  const method=String(req.method||'GET').toUpperCase();
  const pathname=String(req.originalUrl||req.url||req.path||'').split('?')[0];
  const state=inspectPurgeWriteFreezeState();
  syncPurgeQueryOnly(state.active);
  if(!state.active)return next();

  req.v505PurgeReadOnlyAuth=true;
  req.v505PurgeWriteFreezeState=state;
  if(allowedDuringFreeze(method,pathname))return next();

  return res.status(423).json({
    ok:false,
    code:'DATA_PURGE_IN_PROGRESS',
    error:'系统正在执行安全备份或清空业务数据。为防止备份后的数据库继续变化，除清空控制和必要只读状态外，其余接口已临时冻结。',
    until:state.until?new Date(state.until).toISOString():'',
    protectedBy:state.external?.active?`${state.external.kind}:${state.external.status}`:'SQLITE_PURGE_BLOCK',
    mainProcessQueryOnly:queryOnlyState===true,
    guardPatch:V505_PURGE_WRITE_FREEZE_ID
  });
}
