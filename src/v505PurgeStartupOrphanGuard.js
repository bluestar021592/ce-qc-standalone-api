import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { getDb, getRuntimeConfig } from './db.js';
import { withPurgeWorkerClaimSerialization } from './v505PurgeWorkerClaim.js';

export const V505_PURGE_STARTUP_ORPHAN_ID='2026-09-12-v505-startup-orphan-v10-challenge-generation-bound-retirement';
const PREPARE_DIR='.purge_prepare_jobs';
const EXECUTE_DIR='.purge_execute_jobs';
const PURGE_COMMIT_RECEIPT_KEY='data_purge_last_commit_receipt';
const PREPARE_WORKER=fileURLToPath(new URL('../scripts/CE_QC_PurgePrepareTaskWorker.mjs',import.meta.url));
const EXECUTE_WORKER=fileURLToPath(new URL('../scripts/CE_QC_PurgeExecuteTaskWorker.mjs',import.meta.url));
const configuredStaleMs=Number(process.env.V505_PURGE_STARTUP_ORPHAN_STALE_MS||120_000);
const STARTUP_ORPHAN_STALE_MS=Math.max(60_000,Math.min(10*60_000,Number.isFinite(configuredStaleMs)?configuredStaleMs:120_000));
const ACTIVE_EXECUTE=new Set(['QUEUED','RUNNING','COMMITTED']);
const STARTUP_STATES=new Set(['QUEUED','RUNNING']);

function identityKey(user={}){
  const identity=String(user.id||user.email||user.username||'').trim().toLowerCase();
  if(!identity)throw new Error('缺少管理员身份，无法恢复清空启动状态。');
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0,24);
}
function filesFor(user={}){
  const key=identityKey(user);
  const cfg=getRuntimeConfig();
  return {
    prepare:path.join(cfg.backupsDir,PREPARE_DIR,`${key}.job.json`),
    challenge:path.join(cfg.backupsDir,PREPARE_DIR,`${key}.challenge.json`),
    execute:path.join(cfg.backupsDir,EXECUTE_DIR,`${key}.job.json`),
    statusDir:path.join(cfg.projectRoot,'public','purge-status'),
    projectRoot:cfg.projectRoot
  };
}
function readState(file){
  if(!fs.existsSync(file))return {exists:false,job:null,unreadable:false,error:''};
  try{
    const job=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!job||typeof job!=='object'||Array.isArray(job)||!String(job.jobId||'').trim()||!String(job.status||'').trim()){
      return {exists:true,job:null,unreadable:true,error:'JSON结构缺少有效 jobId / status'};
    }
    return {exists:true,job,unreadable:false,error:''};
  }catch(error){return {exists:true,job:null,unreadable:true,error:String(error?.message||error)};}
}
function writeJsonAtomic(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=`${file}.${process.pid}.${crypto.randomUUID().slice(0,8)}.startup.tmp`;
  fs.writeFileSync(temp,JSON.stringify(value||{},null,2),'utf8');
  try{fs.renameSync(temp,file);}catch{try{fs.rmSync(file,{force:true});}catch{}fs.renameSync(temp,file);}
}
function receiptState(){
  let raw='';
  try{raw=String(getDb().prepare('SELECT value FROM app_meta WHERE key=?').get(PURGE_COMMIT_RECEIPT_KEY)?.value||'');}
  catch(error){return {present:true,receipt:null,unreadable:true,error:String(error?.message||error),finalized:false};}
  if(!raw)return {present:false,receipt:null,unreadable:false,error:'',finalized:false};
  try{
    const receipt=JSON.parse(raw);
    if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))throw new Error('提交凭证JSON不是对象');
    const challengeId=String(receipt.challengeId||'').trim();
    const executeJobId=String(receipt.executeJobId||'').trim();
    const committedAt=String(receipt.committedAt||'').trim();
    const finalizedAt=String(receipt.finalizedAt||'').trim();
    const finalizationState=String(receipt.finalizationState||'').trim();
    if(!challengeId||!executeJobId||!committedAt||!Number.isFinite(Date.parse(committedAt)))throw new Error('提交凭证缺少 challengeId / executeJobId / 有效 committedAt');
    if(finalizedAt&&!Number.isFinite(Date.parse(finalizedAt)))throw new Error('提交凭证 finalizedAt 无效');
    if(finalizedAt&&finalizationState!=='SAFE_POSTCHECK_PASSED')throw new Error('提交凭证最终状态不完整');
    if(!finalizedAt&&finalizationState)throw new Error('提交凭证缺少 finalizedAt');
    return {present:true,receipt,unreadable:false,error:'',finalized:Boolean(finalizedAt&&finalizationState==='SAFE_POSTCHECK_PASSED')};
  }catch(error){return {present:true,receipt:null,unreadable:true,error:String(error?.message||error),finalized:false};}
}
function startupAnchor(job={}){
  return Number(job.heartbeatAt||job.updatedAt||job.startedAt||job.submittedAt||0);
}
function staleUnclaimed(job={},now=Date.now()){
  const status=String(job.status||'').toUpperCase();
  const pid=Number(job.workerPid||0);
  const anchor=startupAnchor(job);
  return STARTUP_STATES.has(status)&&(!Number.isInteger(pid)||pid<=0)&&anchor>0&&now-anchor>=STARTUP_ORPHAN_STALE_MS;
}
function exactReceiptForJob(receipt,job={}){
  if(!receipt||!job)return false;
  const challengeId=String(job.challengeId||job.request?.challengeId||'').trim();
  return Boolean(challengeId&&String(receipt.challengeId||'')===challengeId&&String(receipt.executeJobId||'')===String(job.jobId||''));
}
function finalizedReceiptOrdering(receipt,job={}){
  const finalizedAt=Date.parse(String(receipt?.finalizedAt||''));
  const submittedAt=Number(job?.submittedAt||0);
  if(!Number.isFinite(finalizedAt)||finalizedAt<=0||!Number.isFinite(submittedAt)||submittedAt<=0)return 'AMBIGUOUS';
  return submittedAt>finalizedAt?'AFTER_FINALIZED':'BEFORE_OR_AT_FINALIZED';
}
function startupCanRespawn(receipt,job={}){
  if(!receipt.present)return true;
  if(!receipt.finalized)return false;
  return finalizedReceiptOrdering(receipt.receipt,job)==='AFTER_FINALIZED';
}
function startupIsHistoricalDebris(receipt,job={}){
  if(!receipt.present||!receipt.finalized||exactReceiptForJob(receipt.receipt,job))return false;
  return finalizedReceiptOrdering(receipt.receipt,job)==='BEFORE_OR_AT_FINALIZED';
}
function statusFile(job={},statusDir=''){
  const token=String(job.statusToken||'').trim();
  if(!/^[a-f0-9]{48}$/i.test(token))return '';
  return path.join(statusDir,`${token}.json`);
}
function removePublicStatus(job={},statusDir=''){
  const file=statusFile(job,statusDir);
  if(!file)return false;
  try{fs.rmSync(file,{force:true});return true;}catch{return false;}
}
function timeMs(value){
  const numeric=Number(value||0);
  if(Number.isFinite(numeric)&&numeric>0)return numeric;
  const parsed=Date.parse(String(value||''));
  return Number.isFinite(parsed)&&parsed>0?parsed:0;
}
function retireHistoricalPrepareChallenge(file='',job={},receipt={}){
  if(!file||!fs.existsSync(file))return {removed:false,reason:'CHALLENGE_MISSING'};
  let record=null;
  try{record=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {removed:false,reason:'CHALLENGE_UNREADABLE_PRESERVED'};}
  if(!record||typeof record!=='object'||Array.isArray(record))return {removed:false,reason:'CHALLENGE_INVALID_PRESERVED'};
  const persistedId=String(record.challengeId||'').trim();
  const jobChallenge=String(job?.payload?.challengeId||job?.challengeId||job?.request?.challengeId||'').trim();
  const finalizedAt=timeMs(receipt?.receipt?.finalizedAt||receipt?.finalizedAt);
  const challengeAt=timeMs(record?.challenge?.createdAt||record?.updatedAt);
  const exactOldChallenge=Boolean(jobChallenge&&persistedId&&jobChallenge===persistedId);
  const provablyPreFinalized=Boolean(finalizedAt&&challengeAt&&challengeAt<=finalizedAt);
  if(!exactOldChallenge&&!provablyPreFinalized){
    return {removed:false,reason:challengeAt&&finalizedAt&&challengeAt>finalizedAt?'NEWER_CHALLENGE_PRESERVED':'AMBIGUOUS_CHALLENGE_PRESERVED'};
  }
  try{fs.rmSync(file,{force:true});return {removed:true,reason:exactOldChallenge?'EXACT_OLD_CHALLENGE':'PRE_FINALIZATION_CHALLENGE'};}
  catch(error){return {removed:false,reason:`CHALLENGE_REMOVE_FAILED:${error?.message||String(error)}`};}
}
function executeStillActive(state){
  return Boolean(state?.job&&ACTIVE_EXECUTE.has(String(state.job.status||'').toUpperCase()));
}
function sanitizedUser(user={}){
  return {id:user.id||null,email:String(user.email||''),username:String(user.username||''),role:String(user.role||'ADMIN')};
}
function defaultSpawnWorker(kind,payload,projectRoot){
  const worker=kind==='EXECUTE'?EXECUTE_WORKER:PREPARE_WORKER;
  const encoded=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');
  const extra=kind==='EXECUTE'?{CE_QC_PURGE_EXECUTE_CHILD:'1'}:{CE_QC_PURGE_PREPARE_CHILD:'1'};
  const child=spawn(process.execPath,[worker,encoded],{
    cwd:projectRoot,env:{...process.env,...extra},windowsHide:true,detached:true,stdio:'ignore'
  });
  child.unref();
  return {pid:Number(child.pid||0)};
}
function respawnSameJob(kind,file,job,user,files,spawnWorker){
  const current=readState(file);
  if(!current.job||String(current.job.jobId||'')!==String(job.jobId||'')||!staleUnclaimed(current.job))return {recovered:false,reason:'STATE_CHANGED'};
  const publicFile=statusFile(current.job,files.statusDir);
  if(!publicFile)return {recovered:false,reason:'STATUS_TOKEN_MISSING'};
  if(kind==='PREPARE'){try{fs.rmSync(files.challenge,{force:true});}catch{}}

  const recoveryAt=Date.now();
  const restarting={
    ...current.job,workerPid:0,heartbeatAt:recoveryAt,updatedAt:recoveryAt,
    startupRecoveryAt:recoveryAt,startupRecoveryPatch:V505_PURGE_STARTUP_ORPHAN_ID,
    message:kind==='EXECUTE'?'检测到清空子进程启动认领中断，正在使用同一任务编号重新启动；不会创建第二个DELETE任务。':'检测到安全备份子进程启动认领中断，正在使用同一任务编号重新启动。'
  };
  writeJsonAtomic(file,restarting);

  const workerPayload=kind==='EXECUTE'?{
    jobFile:file,statusFile:publicFile,jobId:String(restarting.jobId||''),
    user:restarting.user||sanitizedUser(user),request:restarting.request||{challengeId:String(restarting.challengeId||'')},delayMs:250
  }:{
    jobId:String(restarting.jobId||''),statusToken:String(restarting.statusToken||''),jobFile:file,statusFile:publicFile,
    user:sanitizedUser(user),activeRunIds:[],delayMs:250
  };
  const spawned=spawnWorker(kind,workerPayload,files.projectRoot)||{};
  const pid=Number(spawned.pid||0);
  if(!Number.isInteger(pid)||pid<=0)throw new Error(`V505_PURGE_${kind}_RESPAWN_PID_INVALID`);
  return {recovered:true,pid,claimedByParent:false,reason:'CHILD_CLAIM_REQUIRED',job:restarting};
}
function retireHistoricalStartup(kind,file,job,files,receipt){
  try{
    return withPurgeWorkerClaimSerialization({jobFile:file,jobId:String(job?.jobId||'')},()=>{
      const current=readState(file);
      if(!current.job||String(current.job.jobId||'')!==String(job.jobId||'')||!staleUnclaimed(current.job))return {retired:false,reason:'STATE_CHANGED'};
      if(!startupIsHistoricalDebris(receipt,current.job))return {retired:false,reason:'GENERATION_CHANGED'};
      try{fs.rmSync(file,{force:true});}catch(error){return {retired:false,reason:`SIDECAR_REMOVE_FAILED:${error?.message||String(error)}`};}
      removePublicStatus(current.job,files.statusDir);
      const challengeRetirement=kind==='PREPARE'?retireHistoricalPrepareChallenge(files.challenge,current.job,receipt):null;
      return {retired:true,jobId:String(current.job.jobId||''),reason:'PRE_FINALIZATION_STARTUP_DEBRIS',challengeRetirement};
    });
  }catch(error){
    if(['V505_PURGE_WORKER_CLAIM_BUSY','V505_PURGE_WORKER_CLAIM_LOCK_UNREADABLE'].includes(String(error?.code||''))){
      return {retired:false,reason:String(error.code)};
    }
    throw error;
  }
}
function listJobFiles(directory){
  try{return fs.readdirSync(directory).filter(name=>name.endsWith('.job.json')).map(name=>path.join(directory,name));}
  catch{return [];}
}
function challengeFileForPrepare(file=''){
  return String(file||'').replace(/\.job\.json$/i,'.challenge.json');
}
function globalHistoricalRows(receipt=receiptState()){
  const cfg=getRuntimeConfig();
  const statusDir=path.join(cfg.projectRoot,'public','purge-status');
  if(receipt.unreadable||!receipt.finalized)return {receipt,rows:[],statusDir,projectRoot:cfg.projectRoot};
  const rows=[];
  for(const [kind,directory] of [['EXECUTE',path.join(cfg.backupsDir,EXECUTE_DIR)],['PREPARE',path.join(cfg.backupsDir,PREPARE_DIR)]]){
    for(const file of listJobFiles(directory)){
      const state=readState(file);
      if(state.job&&staleUnclaimed(state.job)&&startupIsHistoricalDebris(receipt,state.job)){
        rows.push({kind,file,job:state.job,challenge:kind==='PREPARE'?challengeFileForPrepare(file):''});
      }
    }
  }
  return {receipt,rows,statusDir,projectRoot:cfg.projectRoot};
}

export function inspectGlobalHistoricalPurgeStartupDebris(){
  const state=globalHistoricalRows();
  return {
    needsSerialization:state.rows.length>0,
    count:state.rows.length,
    receiptUnreadable:Boolean(state.receipt.unreadable),
    jobIds:state.rows.map(row=>String(row.job?.jobId||'')),
    patchId:V505_PURGE_STARTUP_ORPHAN_ID
  };
}

export function retireGlobalHistoricalPurgeStartupDebris(options={}){
  const mutationAuthorized=Boolean(options.mutationAuthorized);
  const state=globalHistoricalRows();
  if(!mutationAuthorized||state.receipt.unreadable||!state.rows.length){
    return {retired:false,retiredCount:0,pendingCount:state.rows.length,patchId:V505_PURGE_STARTUP_ORPHAN_ID};
  }
  let retiredCount=0;
  const results=[];
  for(const row of state.rows){
    const files={statusDir:state.statusDir,projectRoot:state.projectRoot,challenge:row.challenge};
    const result=retireHistoricalStartup(row.kind,row.file,row.job,files,state.receipt);
    if(result.retired)retiredCount+=1;
    results.push({kind:row.kind,jobId:String(row.job?.jobId||''),...result});
  }
  return {
    retired:retiredCount>0,retiredCount,pendingCount:Math.max(0,state.rows.length-retiredCount),results,
    patchId:V505_PURGE_STARTUP_ORPHAN_ID
  };
}

export function inspectStaleUnclaimedPurgeStartup(user={}){
  const files=filesFor(user);
  const now=Date.now();
  const receipt=receiptState();
  const execute=readState(files.execute);
  const prepare=readState(files.prepare);
  const executeRecoverable=Boolean(
    execute.job&&staleUnclaimed(execute.job,now)&&
    !receipt.unreadable&&!exactReceiptForJob(receipt.receipt,execute.job)&&
    startupCanRespawn(receipt,execute.job)
  );
  const executeRetirable=Boolean(
    execute.job&&staleUnclaimed(execute.job,now)&&
    !receipt.unreadable&&startupIsHistoricalDebris(receipt,execute.job)
  );
  const executeWillRemain=executeStillActive(execute)&&!executeRetirable;
  const prepareRecoverable=Boolean(
    prepare.job&&staleUnclaimed(prepare.job,now)&&
    !receipt.unreadable&&startupCanRespawn(receipt,prepare.job)&&
    !execute.unreadable&&!executeWillRemain
  );
  const prepareRetirable=Boolean(
    prepare.job&&staleUnclaimed(prepare.job,now)&&
    !receipt.unreadable&&startupIsHistoricalDebris(receipt,prepare.job)&&
    !execute.unreadable&&!executeWillRemain
  );
  return {
    executeRecoverable,prepareRecoverable,executeRetirable,prepareRetirable,
    needsSerialization:Boolean(executeRecoverable||prepareRecoverable||executeRetirable||prepareRetirable),
    receiptUnreadable:Boolean(receipt.unreadable),
    executeUnreadable:Boolean(execute.unreadable),
    prepareUnreadable:Boolean(prepare.unreadable),
    staleMs:STARTUP_ORPHAN_STALE_MS,
    patchId:V505_PURGE_STARTUP_ORPHAN_ID
  };
}

export function recoverStaleUnclaimedPurgeStartup(user={},options={}){
  const mutationAuthorized=Boolean(options.mutationAuthorized);
  const spawnWorker=typeof options.spawnWorker==='function'?options.spawnWorker:defaultSpawnWorker;
  const files=filesFor(user);
  const before=inspectStaleUnclaimedPurgeStartup(user);
  if(!before.needsSerialization||!mutationAuthorized)return {...before,recovered:false};

  let receipt=receiptState();
  if(receipt.unreadable)return {...before,recovered:false,blockedBy:'COMMIT_RECEIPT_UNREADABLE'};
  let executeRecovery=null;
  let prepareRecovery=null;
  let executeRetirement=null;
  let prepareRetirement=null;

  const execute=readState(files.execute);
  if(execute.job&&staleUnclaimed(execute.job)&&!exactReceiptForJob(receipt.receipt,execute.job)){
    if(startupCanRespawn(receipt,execute.job)){
      executeRecovery=respawnSameJob('EXECUTE',files.execute,execute.job,user,files,spawnWorker);
    }else if(startupIsHistoricalDebris(receipt,execute.job)){
      executeRetirement=retireHistoricalStartup('EXECUTE',files.execute,execute.job,files,receipt);
    }
  }

  const executeAfter=readState(files.execute);
  const prepare=readState(files.prepare);
  receipt=receiptState();
  if(!receipt.unreadable&&prepare.job&&staleUnclaimed(prepare.job)&&!executeAfter.unreadable&&!executeStillActive(executeAfter)){
    if(startupCanRespawn(receipt,prepare.job)){
      prepareRecovery=respawnSameJob('PREPARE',files.prepare,prepare.job,user,files,spawnWorker);
    }else if(startupIsHistoricalDebris(receipt,prepare.job)){
      prepareRetirement=retireHistoricalStartup('PREPARE',files.prepare,prepare.job,files,receipt);
    }
  }

  const executeRecovered=Boolean(executeRecovery?.recovered);
  const prepareRecovered=Boolean(prepareRecovery?.recovered);
  const executeRetired=Boolean(executeRetirement?.retired);
  const prepareRetired=Boolean(prepareRetirement?.retired);
  return {
    ...before,recovered:Boolean(executeRecovered||prepareRecovered||executeRetired||prepareRetired),
    executeRecovered,prepareRecovered,executeRetired,prepareRetired,
    executeRecovery,prepareRecovery,executeRetirement,prepareRetirement,
    patchId:V505_PURGE_STARTUP_ORPHAN_ID
  };
}

export function v505PurgeStartupOrphanGuard(req,res,next){
  try{
    const preview=inspectStaleUnclaimedPurgeStartup(req.user||{});
    const serialized=typeof req.v505PurgeSubmissionMutexRelease==='function';
    if(preview.needsSerialization&&!serialized){
      return res.status(423).json({
        ok:false,code:'DATA_PURGE_STARTUP_ORPHAN_NEEDS_MUTEX',
        error:'检测到后台清空任务在启动阶段未完成进程认领，但当前没有全局提交互斥锁。系统不会擅自覆盖该任务，请重试控制请求。',
        startupOrphanPatch:V505_PURGE_STARTUP_ORPHAN_ID
      });
    }
    const recovery=recoverStaleUnclaimedPurgeStartup(req.user||{},{mutationAuthorized:serialized});
    req.v505PurgeStartupOrphanRecovery=recovery;
    if(preview.needsSerialization&&!recovery.recovered){
      return res.status(423).json({
        ok:false,code:'DATA_PURGE_STARTUP_ORPHAN_RECOVERY_PENDING',
        error:'后台清空启动状态正在被原子认领或仍无法安全替换。系统保持停止，不会创建第二个任务，请稍后重试。',
        startupOrphanPatch:V505_PURGE_STARTUP_ORPHAN_ID
      });
    }
    return next();
  }catch(error){
    return res.status(423).json({
      ok:false,code:'DATA_PURGE_STARTUP_ORPHAN_RECOVERY_BLOCKED',
      error:`无法安全核对后台清空启动状态，系统保持停止：${error?.message||String(error)}`,
      startupOrphanPatch:V505_PURGE_STARTUP_ORPHAN_ID
    });
  }
}
