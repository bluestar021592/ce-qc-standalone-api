import fs from 'node:fs';
import path from 'node:path';

import { getDb, getRuntimeConfig } from './db.js';
import { acquireGlobalPurgeSubmissionMutex, releaseGlobalPurgeSubmissionMutex } from './v505PurgeGlobalGuard.js';
import { inspectGlobalHistoricalPurgeStartupDebris, retireGlobalHistoricalPurgeStartupDebris } from './v505PurgeStartupOrphanGuard.js';

export const V505_PURGE_WRITE_FREEZE_ID='2026-09-12-v505-external-worker-write-freeze-v20-historical-startup-reconcile';
const PURGE_BLOCK_KEY='data_purge_block_until';
const PURGE_COMMIT_RECEIPT_KEY='data_purge_last_commit_receipt';
const ACTIVE=new Set(['QUEUED','RUNNING','COMMITTED']);
const KNOWN_JOB_STATUS=new Set(['QUEUED','RUNNING','COMMITTED','SUCCEEDED','FAILED']);
const PREPARE_DIR='.purge_prepare_jobs';
const EXECUTE_DIR='.purge_execute_jobs';
const SUBMISSION_MUTEX_FILE='.purge_global_submission.lock.json';
const PURGE_CONTROL=/^\/api\/admin\/data-purge\/(?:prepare|execute)$/;
const PURGE_STATUS=/^\/purge-status\/[a-f0-9]{48}\.json$/i;
const SAFE_READ_APIS=new Set(['/api/health','/api/session','/api/bootstrap','/api/backups']);
const LONG_LIVED_AFTER_AUTH=new Set(['/api/events']);
const QUERY_ONLY_RECONCILE_MS=10_000;
const SYSTEM_RECONCILE_USER={id:'V505_SYSTEM_HISTORICAL_STARTUP_RECONCILE'};
let queryOnlyState=null;

function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function validJobSidecar(job){
  if(!job||typeof job!=='object'||Array.isArray(job))return false;
  return Boolean(String(job.jobId||'').trim()&&KNOWN_JOB_STATUS.has(String(job.status||'').toUpperCase()));
}
function readJobState(file){
  try{
    const job=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!validJobSidecar(job))return {job:null,unreadable:true,error:'JSON结构缺少有效 jobId / status'};
    return {job,unreadable:false,error:''};
  }catch(error){return {job:null,unreadable:true,error:String(error?.message||error)};}
}
function pidAlive(pid){
  const value=Number(pid||0);
  if(!Number.isInteger(value)||value<=0)return null;
  try{process.kill(value,0);return true;}catch(error){return error?.code==='EPERM'?true:false;}
}
function sqliteBlockUntil(){
  try{return Number(getDb().prepare('SELECT value FROM app_meta WHERE key=?').get(PURGE_BLOCK_KEY)?.value||0);}catch{return 0;}
}
function lastCommitReceiptState(){
  try{
    const raw=String(getDb().prepare('SELECT value FROM app_meta WHERE key=?').get(PURGE_COMMIT_RECEIPT_KEY)?.value||'');
    if(!raw)return {present:false,receipt:null,unreadable:false,error:''};
    try{
      const receipt=JSON.parse(raw);
      if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))return {present:true,receipt:null,unreadable:true,error:'提交凭证JSON不是对象'};
      const challengeId=String(receipt.challengeId||'').trim();
      const executeJobId=String(receipt.executeJobId||'').trim();
      const committedAt=String(receipt.committedAt||'').trim();
      const finalizedAt=String(receipt.finalizedAt||'').trim();
      const finalizationState=String(receipt.finalizationState||'').trim();
      if(!challengeId||!executeJobId||!committedAt||!Number.isFinite(Date.parse(committedAt))){
        return {present:true,receipt:null,unreadable:true,error:'提交凭证缺少 challengeId / executeJobId / 有效 committedAt'};
      }
      if(finalizedAt&&!Number.isFinite(Date.parse(finalizedAt))){
        return {present:true,receipt:null,unreadable:true,error:'提交凭证 finalizedAt 无效'};
      }
      if(finalizedAt&&finalizationState!=='SAFE_POSTCHECK_PASSED'){
        return {present:true,receipt:null,unreadable:true,error:'提交凭证 finalizedAt 存在但 finalizationState 不是 SAFE_POSTCHECK_PASSED'};
      }
      if(!finalizedAt&&finalizationState){
        return {present:true,receipt:null,unreadable:true,error:'提交凭证存在 finalizationState 但缺少 finalizedAt'};
      }
      return {present:true,receipt,unreadable:false,error:''};
    }catch(error){return {present:true,receipt:null,unreadable:true,error:String(error?.message||error)};}
  }catch(error){return {present:true,receipt:null,unreadable:true,error:`无法读取提交凭证：${error?.message||String(error)}`};}
}
function jobFiles(dir){
  let names=[];
  try{names=fs.readdirSync(dir).filter(name=>name.endsWith('.job.json'));}catch{return [];}
  return names.map(name=>path.join(dir,name));
}
function receiptMatchesExecute(receipt,job={}){
  if(!receipt||String(job.status||'').toUpperCase()==='SUCCEEDED')return false;
  const challengeId=String(job.challengeId||job.request?.challengeId||'');
  return Boolean(challengeId&&String(receipt.challengeId||'')===challengeId&&String(receipt.executeJobId||'')===String(job.jobId||''));
}
function receiptIsFinalized(receipt={}){
  const finalizedAt=String(receipt?.finalizedAt||'').trim();
  return Boolean(finalizedAt&&Number.isFinite(Date.parse(finalizedAt))&&String(receipt?.finalizationState||'')==='SAFE_POSTCHECK_PASSED');
}
function prepareMatchesFinalizedReceipt(receipt,job={}){
  if(!receiptIsFinalized(receipt))return false;
  const challengeId=String(job?.payload?.challengeId||'').trim();
  return Boolean(challengeId&&challengeId===String(receipt?.challengeId||'').trim());
}
function submissionMutexState(){
  const cfg=getRuntimeConfig();
  const file=path.join(cfg.backupsDir,SUBMISSION_MUTEX_FILE);
  if(!fs.existsSync(file))return null;
  const record=readJson(file);
  if(!record)return {active:true,sealed:false,kind:'SUBMISSION',status:'UNKNOWN',workerState:'UNKNOWN',jobId:''};
  const alive=pidAlive(record.pid);
  if(alive===false)return null;
  return {active:true,sealed:false,kind:'SUBMISSION',status:'LOCKED',workerState:alive===true?'ALIVE':'UNKNOWN',jobId:String(record.requestToken||'')};
}

export function inspectExternalPurgeWriteFreeze(){
  const cfg=getRuntimeConfig();
  const now=Date.now();
  const receiptState=lastCommitReceiptState();
  if(receiptState.unreadable){
    return {active:true,sealed:true,kind:'EXECUTE',status:'UNKNOWN',workerState:'COMMIT_RECEIPT_UNREADABLE',jobId:'',stateError:receiptState.error};
  }
  const receipt=receiptState.receipt;
  const groups=[
    {kind:'EXECUTE',dir:path.join(cfg.backupsDir,EXECUTE_DIR)},
    {kind:'PREPARE',dir:path.join(cfg.backupsDir,PREPARE_DIR)}
  ];
  let activeUnsealed=null;
  for(const group of groups){
    for(const file of jobFiles(group.dir)){
      const state=readJobState(file);
      if(state.unreadable){
        const unknown={active:true,sealed:group.kind==='EXECUTE',kind:group.kind,status:'UNKNOWN',workerState:'SIDECAR_UNREADABLE',jobId:'',stateError:state.error};
        if(unknown.sealed)return unknown;
        activeUnsealed ||= unknown;
        continue;
      }
      const job=state.job;
      const status=String(job.status||'').toUpperCase();
      if(group.kind==='EXECUTE'&&receiptMatchesExecute(receipt,job)){
        const alive=pidAlive(job.workerPid);
        if(receiptIsFinalized(receipt)){
          if(alive===true){
            return {active:true,sealed:true,kind:group.kind,status:'FINALIZED',workerState:'FINALIZER_TAIL_ACTIVE',jobId:String(job.jobId||''),durableReceipt:true,receiptFinalized:true};
          }
          continue;
        }
        return {active:true,sealed:true,kind:group.kind,status:'COMMITTED',workerState:alive===true?'ALIVE':'COMMITTED_RECOVERY',jobId:String(job.jobId||''),durableReceipt:true,receiptFinalized:false};
      }
      if(group.kind==='EXECUTE'&&status==='COMMITTED'){
        const alive=pidAlive(job.workerPid);
        return {active:true,sealed:true,kind:group.kind,status,workerState:alive===true?'ALIVE':'COMMITTED_RECOVERY',jobId:String(job.jobId||'')};
      }
      if(ACTIVE.has(status)){
        const alive=pidAlive(job.workerPid);
        if(alive!==false){
          const activeState={active:true,sealed:group.kind==='EXECUTE',kind:group.kind,status,workerState:alive===true?'ALIVE':'UNKNOWN',jobId:String(job.jobId||'')};
          if(activeState.sealed)return activeState;
          activeUnsealed ||= activeState;
        }
      }
      if(group.kind==='PREPARE'&&status==='SUCCEEDED'){
        if(prepareMatchesFinalizedReceipt(receipt,job))continue;
        const expiresAt=Date.parse(String(job.payload?.expiresAt||''));
        if(Number.isFinite(expiresAt)&&expiresAt>now){
          return {active:true,sealed:true,kind:group.kind,status,workerState:'COMPLETED_WAITING_EXECUTE',jobId:String(job.jobId||''),expiresAt};
        }
      }
    }
  }
  if(activeUnsealed)return activeUnsealed;
  if(receipt&&!String(receipt.finalizedAt||'').trim()){
    return {active:true,sealed:true,kind:'EXECUTE',status:'COMMITTED',workerState:'COMMIT_RECEIPT_ORPHANED',jobId:String(receipt.executeJobId||''),durableReceipt:true,receiptFinalized:false};
  }
  const submission=submissionMutexState();
  if(submission)return submission;
  return {active:false,sealed:false};
}

export function inspectPurgeWriteFreezeState(){
  const until=sqliteBlockUntil();
  const external=inspectExternalPurgeWriteFreeze();
  const sqliteActive=Number.isFinite(until)&&until>Date.now();
  return {active:Boolean(sqliteActive||external.active),sealed:Boolean(external.sealed),sqliteActive,until:sqliteActive?until:0,external};
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

function queryOnlyRequired(state={}){
  if(state.sqliteActive)return true;
  if(!state.external?.active)return false;
  return String(state.external.kind||'')!=='SUBMISSION';
}
export function reconcileHistoricalPurgeStartupDebrisNow(){
  try{
    const preview=inspectGlobalHistoricalPurgeStartupDebris();
    if(!preview.needsSerialization)return {attempted:false,retiredCount:0,busy:false,patchId:V505_PURGE_WRITE_FREEZE_ID};
    const mutex=acquireGlobalPurgeSubmissionMutex(SYSTEM_RECONCILE_USER);
    if(!mutex.acquired)return {attempted:true,retiredCount:0,busy:true,patchId:V505_PURGE_WRITE_FREEZE_ID};
    try{
      const result=retireGlobalHistoricalPurgeStartupDebris({mutationAuthorized:true});
      return {attempted:true,busy:false,...result,writeFreezePatch:V505_PURGE_WRITE_FREEZE_ID};
    }finally{
      try{releaseGlobalPurgeSubmissionMutex(mutex.record);}catch{}
    }
  }catch(error){
    return {attempted:true,retiredCount:0,busy:true,error:String(error?.message||error),patchId:V505_PURGE_WRITE_FREEZE_ID};
  }
}
export function reconcilePurgeQueryOnlyNow(){
  const state=inspectPurgeWriteFreezeState();
  const protectSharedDb=queryOnlyRequired(state);
  return {state,queryOnly:syncPurgeQueryOnly(protectSharedDb)};
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
  const protectSharedDb=queryOnlyRequired(state);

  req.v505PurgeWriteFreezeState=state;
  if(state.active)req.v505PurgeReadOnlyAuth=true;

  if(LONG_LIVED_AFTER_AUTH.has(pathname)&&typeof req.v505PurgeHttpActivityRelease==='function'){
    try{req.v505PurgeHttpActivityRelease();}catch{}
  }

  syncPurgeQueryOnly(protectSharedDb);
  if(!state.active)return next();
  if(allowedDuringFreeze(method,pathname))return next();

  return res.status(423).json({
    ok:false,
    code:'DATA_PURGE_IN_PROGRESS',
    error:'系统正在执行安全备份或清空业务数据。为防止清空前备份期间及备份后的数据库继续变化，除清空控制和必要只读状态外，其余接口已临时冻结。',
    until:state.until?new Date(state.until).toISOString():'',
    protectedBy:state.external?.active?`${state.external.kind}:${state.external.status}`:'SQLITE_PURGE_BLOCK',
    workerState:String(state.external?.workerState||''),
    fingerprintSealed:state.sealed,
    mainProcessQueryOnly:queryOnlyState===true,
    guardPatch:V505_PURGE_WRITE_FREEZE_ID
  });
}

const initialReconcile=setImmediate(()=>{
  try{reconcileHistoricalPurgeStartupDebrisNow();}catch{}
  try{reconcilePurgeQueryOnlyNow();}catch{}
});
initialReconcile.unref?.();
const queryOnlyReconciler=setInterval(()=>{
  try{reconcileHistoricalPurgeStartupDebrisNow();}catch{}
  try{reconcilePurgeQueryOnlyNow();}catch{}
},QUERY_ONLY_RECONCILE_MS);
queryOnlyReconciler.unref?.();
