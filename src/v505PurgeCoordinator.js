import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createPurgeChallenge, executePurge, finalizeCommittedPurge, readPurgeCommitReceipt, PURGE_PHRASE, V505_PURGE_RECOVERY_ID } from './dataPurge.js';
import { getDb, getRuntimeConfig, nowIso } from './db.js';
import { assertNoActiveExportJobs, V505_PURGE_EXTERNAL_ACTIVITY_ID } from './v505PurgeExternalActivity.js';
import { inspectV541PurgeJobWorker, V541_PURGE_PID_OWNERSHIP_ID } from './v541PurgePidOwnership.js';

export const V505_PURGE_COORDINATOR_ID='2026-09-15-v541-purge-coordinator-pid-reuse-v1';
const PURGE_BLOCK_KEY='data_purge_block_until';
const PREPARE_JOB_DIR='.purge_prepare_jobs';
const EXECUTE_JOB_DIR='.purge_execute_jobs';
const STATUS_DIR='purge-status';
const EXECUTE_WORKER=fileURLToPath(new URL('../scripts/CE_QC_PurgeExecuteTaskWorker.mjs',import.meta.url));
const ACTIVE_PREPARE=new Set(['QUEUED','RUNNING']);
const ACTIVE_EXECUTE=new Set(['QUEUED','RUNNING','COMMITTED']);
const EXECUTE_RECOVERY_MS=10*60_000;
const HEARTBEAT_STALE_MS=60_000;

function identityKey(user={}){
  const identity=String(user.id||user.email||user.username||'').trim().toLowerCase();
  if(!identity)throw new Error('缺少管理员身份，无法协调安全清空任务。');
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0,24);
}
function prepareJobFile(user={}){
  const dir=path.join(getRuntimeConfig().backupsDir,PREPARE_JOB_DIR);
  fs.mkdirSync(dir,{recursive:true});
  return path.join(dir,`${identityKey(user)}.job.json`);
}
function prepareChallengeFile(user={}){
  const dir=path.join(getRuntimeConfig().backupsDir,PREPARE_JOB_DIR);
  fs.mkdirSync(dir,{recursive:true});
  return path.join(dir,`${identityKey(user)}.challenge.json`);
}
function executeJobFile(user={}){
  const dir=path.join(getRuntimeConfig().backupsDir,EXECUTE_JOB_DIR);
  fs.mkdirSync(dir,{recursive:true});
  return path.join(dir,`${identityKey(user)}.job.json`);
}
function statusFile(token=''){
  if(!/^[a-f0-9]{48}$/i.test(String(token||'')))throw new Error('V505_INVALID_PURGE_STATUS_TOKEN');
  const dir=path.join(getRuntimeConfig().projectRoot,'public',STATUS_DIR);
  fs.mkdirSync(dir,{recursive:true});
  return path.join(dir,`${token}.json`);
}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function normalizedFilePath(value=''){
  const text=String(value||'').trim();
  if(!text)return '';
  const resolved=path.resolve(text);
  return process.platform==='win32'?resolved.toLowerCase():resolved;
}
function sameFilePath(a,b){
  const left=normalizedFilePath(a),right=normalizedFilePath(b);
  return Boolean(left&&right&&left===right);
}
function coded(code,message){const error=new Error(message);error.code=code;return error;}
function sealedDatabasePathForChallenge(user={},challengeId=''){
  const expected=String(challengeId||'').trim();
  if(!expected)throw coded('V505_PURGE_EXECUTE_SEALED_DB_EVIDENCE_MISSING','缺少 challengeId，无法封存 destructive worker 数据库路径。');
  const prepare=readJson(prepareJobFile(user));
  const persisted=readJson(prepareChallengeFile(user));
  if(String(prepare?.status||'').toUpperCase()!=='SUCCEEDED'||String(prepare?.payload?.challengeId||'')!==expected){
    throw coded('V505_PURGE_EXECUTE_SEALED_DB_EVIDENCE_MISMATCH','已完成 PREPARE 与当前 challengeId 不一致，不能创建 destructive worker。');
  }
  if(String(persisted?.challengeId||'')!==expected||!persisted?.challenge){
    throw coded('V505_PURGE_EXECUTE_SEALED_DB_EVIDENCE_MISMATCH','持久化 challenge 与当前 destructive request 不一致。');
  }
  const preparePath=String(prepare?.payload?.databasePath||'').trim();
  const persistedPath=String(persisted?.payload?.databasePath||'').trim();
  const manifestPath=String(persisted?.challenge?.backup?.manifestPath||'').trim();
  const manifest=manifestPath?readJson(manifestPath):null;
  const manifestDatabasePath=String(manifest?.databasePath||'').trim();
  if(!preparePath||!persistedPath||!manifestDatabasePath||!sameFilePath(preparePath,persistedPath)||!sameFilePath(preparePath,manifestDatabasePath)){
    throw coded('V505_PURGE_EXECUTE_SEALED_DB_PATH_MISMATCH','PREPARE、持久化 challenge 与 backup manifest 的数据库路径不一致，不能创建 destructive worker。');
  }
  const runtimePath=String(getRuntimeConfig().dbFile||'').trim();
  if(!sameFilePath(preparePath,runtimePath)){
    throw coded('V505_PURGE_EXECUTE_SEALED_DB_PATH_CHANGED','当前运行时数据库路径已不同于安全备份封存路径；不会对 fallback 或其他数据库创建 destructive worker。');
  }
  return preparePath;
}
function writeJson(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=`${file}.${process.pid}.${crypto.randomUUID().slice(0,8)}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(value||{},null,2),'utf8');
  try{fs.renameSync(temp,file);}catch{try{fs.rmSync(file,{force:true});}catch{}fs.renameSync(temp,file);}
}
function pidAlive(pid){
  const number=Number(pid||0);
  if(!Number.isInteger(number)||number<=0)return null;
  try{process.kill(number,0);return true;}catch(error){return error?.code==='EPERM'?true:false;}
}
function workerOwnership(job={}){return inspectV541PurgeJobWorker(job);}
function workerLive(job={}){
  const ownership=workerOwnership(job);
  return {ownership,live:ownership.active===true&&String(ownership.workerState||'')==='ALIVE'};
}
function clearPurgeBlock(){try{getDb().prepare('DELETE FROM app_meta WHERE key=?').run(PURGE_BLOCK_KEY);}catch{}}
export function purgeBlockUntil(){
  try{return Number(getDb().prepare('SELECT value FROM app_meta WHERE key=?').get(PURGE_BLOCK_KEY)?.value||0);}catch{return 0;}
}
export function purgeBlockActive(){const until=purgeBlockUntil();return Number.isFinite(until)&&until>Date.now();}

function publicStatus(job={}){
  const status=String(job.status||'');
  const heartbeatAt=Number(job.heartbeatAt||0);
  return {
    ok:true,
    patchId:V505_PURGE_COORDINATOR_ID,
    recoveryPatch:V505_PURGE_RECOVERY_ID,
    externalActivityGate:V505_PURGE_EXTERNAL_ACTIVITY_ID,
    pidOwnershipPatch:V541_PURGE_PID_OWNERSHIP_ID,
    kind:String(job.kind||'EXECUTE'),
    jobId:String(job.jobId||''),
    status,
    submittedAt:Number(job.submittedAt||0),
    startedAt:Number(job.startedAt||0),
    heartbeatAt,
    completedAt:Number(job.completedAt||0),
    failedAt:Number(job.failedAt||0),
    heartbeatStale:Boolean(heartbeatAt&&Date.now()-heartbeatAt>HEARTBEAT_STALE_MS),
    error:status==='FAILED'?String(job.error||'后台清空任务失败。'):'',
    message:String(job.message||'')
  };
}
function writePublic(job={}){if(job.statusFile)writeJson(job.statusFile,publicStatus(job));}
function pendingPayload(job={}){
  const state=String(job.status||'QUEUED').toUpperCase();
  const pidState=Number(job.workerPid||0)>0?pidAlive(job.workerPid):null;
  return {
    async:true,
    kind:String(job.kind||'EXECUTE'),
    status:state,
    jobId:String(job.jobId||''),
    statusToken:String(job.statusToken||''),
    statusUrl:job.statusToken?`/${STATUS_DIR}/${job.statusToken}.json`:'',
    pollUrl:job.statusToken?`/${STATUS_DIR}/${job.statusToken}.json`:'',
    submittedAt:Number(job.submittedAt||0),
    startedAt:Number(job.startedAt||0),
    heartbeatAt:Number(job.heartbeatAt||0),
    heartbeatStale:Boolean(job.heartbeatAt&&Date.now()-Number(job.heartbeatAt)>HEARTBEAT_STALE_MS),
    workerState:pidState===true?'ALIVE':pidState===false?'DEAD':'UNKNOWN',
    committed:state==='COMMITTED',
    recoveryPatch:V505_PURGE_RECOVERY_ID,
    coordinatorPatch:V505_PURGE_COORDINATOR_ID,
    externalActivityGate:V505_PURGE_EXTERNAL_ACTIVITY_ID,
    pidOwnershipPatch:V541_PURGE_PID_OWNERSHIP_ID,
    message:String(job.message||'')
  };
}
function finalizedTailPayload(job={}){
  return {
    ...pendingPayload({...job,status:'COMMITTED',message:'SQLite最终完成凭证已经提交；原后台进程仍存活，正在完成本次任务的最后文件状态收尾。系统不会启动下一代清空任务。'}),
    status:'COMMITTED',committed:true,workerState:'FINALIZER_TAIL_ACTIVE'
  };
}
function pendingPreparePayload(job={}){
  return {
    ...pendingPayload({...job,kind:'PREPARE'}),
    databasePath:getRuntimeConfig().dbFile,
    counts:null,
    countMode:'DEFERRED_TO_TRANSACTIONAL_DELETE',
    administrator:String(job.email||''),
    backup:{path:`PENDING:${String(job.jobId||'')}`,sha256:'',size:0,integrity:'pending',method:'detached-background-worker'}
  };
}
function removeJobArtifacts(jobFile,job={}){
  try{fs.rmSync(jobFile,{force:true});}catch{}
  if(job?.statusFile){try{fs.rmSync(job.statusFile,{force:true});}catch{}}
}
function currentPrepareChallenge(user={}){
  const prepare=readJson(prepareJobFile(user));
  const fromJob=String(prepare?.payload?.challengeId||'').trim();
  if(fromJob)return fromJob;
  const persisted=readJson(prepareChallengeFile(user));
  return String(persisted?.challengeId||'').trim();
}
function clearFinalizedPrepareArtifacts(user={},challengeId=''){
  const expected=String(challengeId||'').trim();
  if(!expected)return false;
  let cleared=false;
  const jobFile=prepareJobFile(user);
  const prepare=readJson(jobFile);
  if(prepare&&String(prepare?.payload?.challengeId||'').trim()===expected){
    removeJobArtifacts(jobFile,prepare);
    cleared=true;
  }
  const challengeFile=prepareChallengeFile(user);
  const persisted=readJson(challengeFile);
  if(persisted&&String(persisted?.challengeId||'').trim()===expected){
    try{fs.rmSync(challengeFile,{force:true});cleared=true;}catch{}
  }
  return cleared;
}
function failJob(jobFile,job={},message=''){
  const failed={...job,status:'FAILED',failedAt:Date.now(),heartbeatAt:Date.now(),updatedAt:Date.now(),error:String(message||'后台清空任务失败。'),message:String(message||'后台清空任务失败。')};
  writeJson(jobFile,failed);writePublic(failed);return failed;
}
function committedReceipt(job={}){
  const challengeId=String(job.challengeId||job.request?.challengeId||'');
  const executeJobId=String(job.jobId||'');
  if(!challengeId||!executeJobId)return null;
  return readPurgeCommitReceipt({challengeId,executeJobId});
}
function receiptIsFinalized(receipt={}){
  const finalizedAt=String(receipt?.finalizedAt||'').trim();
  return Boolean(finalizedAt&&Number.isFinite(Date.parse(finalizedAt))&&String(receipt?.finalizationState||'')==='SAFE_POSTCHECK_PASSED');
}
function finalizedReceiptResult(receipt={}){
  const warnings=Array.isArray(receipt?.fileCleanupWarnings)?receipt.fileCleanupWarnings:[];
  return {
    backup:receipt.backup||{},
    before:receipt.before||{},
    after:receipt.after||{},
    completedAt:String(receipt.committedAt||nowIso()),
    finalizedAt:String(receipt.finalizedAt||''),
    event:'DATA_RESET',
    integrity:warnings.length?'committed-with-warnings':'ok',
    integrityCheck:'DURABLE_FINALIZED_RECEIPT',
    walCheckpoint:'AUTO',
    fileCleanupWarnings:warnings,
    deleteMode:'FAST_TABLE_DELETE_FK_GUARDED',
    performanceIndexes:'V108',
    countSource:'DELETE_CHANGESET_EXACT',
    backupSourceFingerprint:'MATCHED_UNDER_BEGIN_IMMEDIATE',
    sourceFingerprintGate:String(receipt.sourceFingerprintGate||''),
    executeJobId:String(receipt.executeJobId||''),
    challengeId:String(receipt.challengeId||''),
    committedReceipt:true,
    recoveryBlockUntil:Number(receipt.recoveryBlockUntil||0),
    recoveredAfterCommit:true,
    recoveredAfterFinalize:true,
    recoveryPatch:V505_PURGE_RECOVERY_ID
  };
}
function recoverFinalizedReceipt(file,job={},receipt={},user={}){
  const result=finalizedReceiptResult(receipt);
  const completedAt=Date.now();
  const completed={...job,status:'SUCCEEDED',completedAt,heartbeatAt:completedAt,updatedAt:completedAt,workerPid:0,result,error:'',message:'检测到SQLite最终完成凭证；不会再次执行后置清理或DELETE，已恢复为完成状态。'};
  writeJson(file,completed);writePublic(completed);
  try{clearFinalizedPrepareArtifacts(user,String(receipt?.challengeId||job?.challengeId||job?.request?.challengeId||''));}catch{}
  workerAudit(user,'DATA_PURGE_FINALIZED_RECEIPT_RECOVERED',{executeJobId:String(receipt.executeJobId||job.jobId||''),challengeId:String(receipt.challengeId||job.challengeId||''),finalizedAt:String(receipt.finalizedAt||'')});
  return {job:completed,result,payload:{...pendingPayload(completed),status:'SUCCEEDED',completed:true,committed:true,workerState:'FINALIZED_RECEIPT',result}};
}
function postCommitStructuralWarning(result={}){
  const warnings=Array.isArray(result?.fileCleanupWarnings)?result.fileCleanupWarnings:[];
  return warnings.find(item=>String(item||'').startsWith('清空后结构校验警告：'))||'';
}
function businessLock(){
  const db=getDb();
  try{
    const row=db.prepare("SELECT runId,'CCSL' AS family FROM run_locks WHERE status IN ('running','paused','paused_write') LIMIT 1").get();
    if(row)return row;
  }catch{}
  try{
    const row=db.prepare("SELECT runId,COALESCE(businessType,'BUSINESS') AS family FROM business_run_locks WHERE status IN ('running','paused','paused_write') LIMIT 1").get();
    if(row)return row;
  }catch{}
  return null;
}
function assertNoBusinessLock(){const row=businessLock();if(row)throw new Error(`当前存在运行中或暂停中的任务，不能清空。runId：${row.runId||'unknown'}`);}

function spawnExecutionWorker(file,job={},options={}){
  const committed=Boolean(options.committed);
  const delayMs=Math.max(0,Number(options.delayMs??(committed?250:750))||0);
  const workerPayload={jobFile:file,statusFile:job.statusFile,jobId:job.jobId,user:job.user||{},request:job.request||{},sealedDatabasePath:String(job.sealedDatabasePath||''),delayMs};
  const encoded=Buffer.from(JSON.stringify(workerPayload),'utf8').toString('base64url');
  let child;
  try{
    child=spawn(process.execPath,[EXECUTE_WORKER,encoded],{cwd:getRuntimeConfig().projectRoot,env:{...process.env,CE_QC_PURGE_EXECUTE_CHILD:'1'},windowsHide:true,detached:true,stdio:'ignore'});
    child.unref();
  }catch(error){
    if(committed){
      const stalled={...job,status:'COMMITTED',workerPid:0,heartbeatAt:Date.now(),updatedAt:Date.now(),error:String(error?.message||error),message:'业务数据事务已提交，但后置恢复进程暂未启动；系统保持提交凭证，不会重复删除。'};
      writeJson(file,stalled);writePublic(stalled);
      return pendingPayload(stalled);
    }
    failJob(file,job,`无法启动后台清空进程：${error?.message||String(error)}`);
    throw error;
  }
  const now=Date.now();
  const queued={...job,status:committed?'COMMITTED':'QUEUED',workerPid:Number(child.pid||0),heartbeatAt:now,updatedAt:now,error:'',message:committed?'已确认清空事务完成，后台仅恢复提交后清理，不会重复删除业务数据。':'后台清空任务已提交，等待独立进程接管。'};
  writeJson(file,queued);writePublic(queued);
  return pendingPayload(queued);
}

export function inspectLivePrepareJob(user={}){
  const file=prepareJobFile(user);const job=readJson(file);
  if(!job||!ACTIVE_PREPARE.has(String(job.status||'').toUpperCase()))return null;
  const ownership=workerOwnership(job);
  if(ownership.active===false)return {dead:true,job,file,ownership};
  const unknown=String(ownership.workerState||'')!=='ALIVE';
  return {dead:false,job,file,ownership,payload:pendingPreparePayload({...job,message:unknown?'安全备份任务进程状态暂时无法确认；系统保持锁定，不会启动第二份备份。':(Date.now()-Number(job.heartbeatAt||0)>HEARTBEAT_STALE_MS?'安全备份进程仍存活，但状态心跳延迟；系统保持锁定，不会启动第二份备份。':'安全备份正在后台执行。')})};
}

export function inspectExecutionRecovery(user={}){
  const file=executeJobFile(user);let job=readJson(file);
  if(!job)return null;
  let status=String(job.status||'').toUpperCase();
  const receipt=committedReceipt(job);
  if(receipt&&receiptIsFinalized(receipt)&&status!=='SUCCEEDED'){
    if(workerLive(job).live)return finalizedTailPayload(job);
    const finalizedChallenge=String(receipt.challengeId||'').trim();
    const prepareBefore=currentPrepareChallenge(user);
    const newerPrepare=Boolean(prepareBefore&&prepareBefore!==finalizedChallenge);
    const recovered=recoverFinalizedReceipt(file,job,receipt,user);
    if(newerPrepare)return null;
    return recovered.payload;
  }
  if(receipt&&status!=='SUCCEEDED'){
    if(status!=='COMMITTED'){
      job={...job,status:'COMMITTED',heartbeatAt:Date.now(),updatedAt:Date.now(),error:'',message:'检测到与本任务完全匹配的SQLite事务提交凭证；不会再次执行删除，只恢复后置清理。'};
      writeJson(file,job);writePublic(job);status='COMMITTED';
    }
    if(workerLive(job).live)return pendingPayload(job);
    return spawnExecutionWorker(file,job,{committed:true,delayMs:250});
  }
  if(receipt&&receiptIsFinalized(receipt)&&status==='SUCCEEDED'){
    const finalizedChallenge=String(receipt.challengeId||'').trim();
    const prepareChallenge=currentPrepareChallenge(user);
    if(!prepareChallenge||prepareChallenge!==finalizedChallenge){
      removeJobArtifacts(file,job);
      return null;
    }
    return recoverFinalizedReceipt(file,job,receipt,user).payload;
  }
  if(ACTIVE_EXECUTE.has(status)){
    const ownership=workerOwnership(job);
    if(ownership.active===false){
      if(status==='COMMITTED'){
        const held={...job,status:'COMMITTED',workerPid:0,heartbeatAt:Date.now(),updatedAt:Date.now(),error:'缺少与当前任务匹配的事务提交凭证。',message:'任务曾进入已提交状态，但当前无法验证精确提交凭证。系统保持停止，不会重试删除。'};
        writeJson(file,held);writePublic(held);return pendingPayload(held);
      }
      const reason=String(ownership.identityState||'')==='PID_REUSED'?'检测到后台清空PID已被Windows复用；原清空进程已不存在。':'后台清空进程已退出。';
      const failed=failJob(file,job,`${reason} 未提交的SQLite事务会自动回滚；已验证备份的安全锁保持不变，可在凭证有效期内重新恢复。`);
      return pendingPayload(failed);
    }
    const unknown=String(ownership.workerState||'')!=='ALIVE';
    return pendingPayload({...job,message:status==='COMMITTED'?'业务数据事务已提交，正在完成提交后清理。':unknown?'清空进程状态暂时无法确认；系统保持锁定，不会启动第二个清空任务。':(Date.now()-Number(job.heartbeatAt||0)>HEARTBEAT_STALE_MS?'清空进程仍存活，但状态心跳延迟；系统保持锁定，不会启动第二个清空任务。':'正在后台清空业务数据。')});
  }
  if(status==='SUCCEEDED'&&Date.now()-Number(job.completedAt||job.updatedAt||0)<=EXECUTE_RECOVERY_MS)return {...pendingPayload(job),status:'SUCCEEDED',completed:true,result:job.result||null};
  if(status==='FAILED'){
    if(receipt)return spawnExecutionWorker(file,{...job,status:'COMMITTED'},{committed:true,delayMs:250});
    removeJobArtifacts(file,job);return null;
  }
  if(status==='SUCCEEDED'){removeJobArtifacts(file,job);return null;}
  return null;
}

export async function v505PurgePrepareHandler(req,res){
  try{
    const executing=inspectExecutionRecovery(req.user||{});
    if(executing)return res.json({ok:true,...executing,administrator:req.user?.email||req.user?.username||''});
    const live=inspectLivePrepareJob(req.user||{});
    if(live&&!live.dead)return res.json({ok:true,...live.payload,administrator:req.user?.email||req.user?.username||''});
    if(live?.dead){
      const reason=String(live.ownership?.identityState||'')==='PID_REUSED'?'检测到安全备份PID已被Windows复用；原备份进程已不存在。':'清空前安全备份后台进程已经退出。';
      failJob(live.file,live.job,`${reason} 系统将重新建立同一安全入口，不会复用旧进程状态。`);
      clearPurgeBlock();
    }
    assertNoBusinessLock();
    assertNoActiveExportJobs();
    let challenge=await createPurgeChallenge(req.user||{}, {activeRunIds:new Set()});
    if(live?.dead&&String(challenge?.status||'').toUpperCase()==='FAILED'){
      challenge=await createPurgeChallenge(req.user||{}, {activeRunIds:new Set()});
    }
    return res.json({ok:true,...challenge,administrator:req.user?.email||req.user?.username||'',coordinatorPatch:V505_PURGE_COORDINATOR_ID,externalActivityGate:V505_PURGE_EXTERNAL_ACTIVITY_ID,pidOwnershipPatch:V541_PURGE_PID_OWNERSHIP_ID});
  }catch(error){
    return res.status(409).json({ok:false,code:error?.code||'V505_PURGE_PREPARE_BLOCKED',error:error?.message||String(error),coordinatorPatch:V505_PURGE_COORDINATOR_ID,externalActivityGate:V505_PURGE_EXTERNAL_ACTIVITY_ID,pidOwnershipPatch:V541_PURGE_PID_OWNERSHIP_ID});
  }
}

export async function queuePurgeExecution(user={},request={}){
  const challengeId=String(request.challengeId||'');
  if(!challengeId)throw new Error('缺少清空验证凭证。');
  if(String(request.phrase||'')!==PURGE_PHRASE)throw new Error(`请输入完整确认短语：${PURGE_PHRASE}`);
  if(request.backupConfirmed!==true)throw new Error('请确认自动安全备份已经完成。');
  const file=executeJobFile(user);
  let existing=readJson(file);
  if(existing){
    let status=String(existing.status||'').toUpperCase();
    const receipt=committedReceipt(existing);
    if(receipt&&receiptIsFinalized(receipt)){
      if(workerLive(existing).live)return finalizedTailPayload(existing);
      const existingChallenge=String(existing.challengeId||existing.request?.challengeId||'');
      const recovered=recoverFinalizedReceipt(file,existing,receipt,user);
      if(existingChallenge===challengeId)return recovered.payload;
      removeJobArtifacts(file,recovered.job);
      existing=null;
    }
    if(existing&&receipt&&status!=='SUCCEEDED'){
      if(status!=='COMMITTED'){
        existing={...existing,status:'COMMITTED',heartbeatAt:Date.now(),updatedAt:Date.now(),error:'',message:'检测到精确事务提交凭证，恢复后置清理。'};
        writeJson(file,existing);writePublic(existing);status='COMMITTED';
      }
      if(workerLive(existing).live)return pendingPayload(existing);
      return spawnExecutionWorker(file,existing,{committed:true,delayMs:250});
    }
    if(existing&&ACTIVE_EXECUTE.has(status)){
      const ownership=workerOwnership(existing);
      if(ownership.active===true)return pendingPayload(existing);
      if(status==='COMMITTED')return pendingPayload({...existing,workerPid:0,message:'无法验证已提交状态对应的精确提交凭证；系统不会重复删除。'});
      const reason=String(ownership.identityState||'')==='PID_REUSED'?'检测到上一后台清空PID已被Windows复用；原进程已不存在。':'上一个后台清空进程已经退出。';
      failJob(file,existing,`${reason} 保留已验证备份的安全锁，准备恢复同一凭证。`);
    }else if(existing&&status==='SUCCEEDED'&&String(existing.challengeId||'')===challengeId&&Date.now()-Number(existing.completedAt||0)<=EXECUTE_RECOVERY_MS){
      return {...pendingPayload(existing),status:'SUCCEEDED',completed:true,result:existing.result||null};
    }
    if(existing)removeJobArtifacts(file,readJson(file)||existing);
  }
  assertNoBusinessLock();
  assertNoActiveExportJobs();
  if(!purgeBlockActive())throw new Error('清空安全锁已失效，请重新开始，系统会重新验证备份与数据库状态。');
  const sealedDatabasePath=sealedDatabasePathForChallenge(user,challengeId);
  const statusToken=crypto.randomBytes(24).toString('hex');
  const publicFile=statusFile(statusToken);
  const jobId=crypto.randomUUID();
  const submittedAt=Date.now();
  const job={
    patchId:V505_PURGE_COORDINATOR_ID,kind:'EXECUTE',jobId,challengeId,statusToken,statusFile:publicFile,sealedDatabasePath,
    status:'QUEUED',submittedAt,startedAt:0,heartbeatAt:submittedAt,updatedAt:submittedAt,workerPid:0,error:'',message:'后台清空任务已排队。',
    user:{id:user.id||null,email:String(user.email||''),username:String(user.username||''),role:String(user.role||'ADMIN')},
    request:{challengeId,phrase:PURGE_PHRASE,backupConfirmed:true}
  };
  writeJson(file,job);writePublic(job);
  return spawnExecutionWorker(file,job,{committed:false,delayMs:750});
}

export async function v505PurgeExecuteHandler(req,res){
  try{
    const queued=await queuePurgeExecution(req.user||{},req.body||{});
    return res.status(queued.status==='SUCCEEDED'?200:202).json({ok:true,...queued,coordinatorPatch:V505_PURGE_COORDINATOR_ID,externalActivityGate:V505_PURGE_EXTERNAL_ACTIVITY_ID,pidOwnershipPatch:V541_PURGE_PID_OWNERSHIP_ID});
  }catch(error){
    return res.status(409).json({ok:false,code:error?.code||'V505_PURGE_EXECUTE_BLOCKED',error:error?.message||String(error),coordinatorPatch:V505_PURGE_COORDINATOR_ID,externalActivityGate:V505_PURGE_EXTERNAL_ACTIVITY_ID,pidOwnershipPatch:V541_PURGE_PID_OWNERSHIP_ID});
  }
}

function workerAudit(user={},action='',detail={}){
  try{
    getDb().prepare('INSERT INTO audit_logs(userEmail,userRole,action,businessType,reportDate,runId,detailJson,ipAddress,createdAt) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(user.email||user.username||'',user.role||'ADMIN',action,'','','',JSON.stringify(detail||{}),'',nowIso());
  }catch{}
}

export async function runPurgeExecutionWorker(payload={}){
  const file=String(payload.jobFile||'');const jobId=String(payload.jobId||'');
  let job=readJson(file);
  if(!file||!jobId||job?.jobId!==jobId)throw new Error('V505_PURGE_EXECUTE_JOB_NOT_FOUND');
  const challengeId=String(payload.request?.challengeId||job.challengeId||'');
  const resumeReceipt=readPurgeCommitReceipt({challengeId,executeJobId:jobId});
  if(resumeReceipt&&receiptIsFinalized(resumeReceipt)){
    return recoverFinalizedReceipt(file,job,resumeReceipt,payload.user||{}).result;
  }
  const startedAt=Date.now();
  job={...job,status:resumeReceipt?'COMMITTED':'RUNNING',startedAt:Number(job.startedAt||0)||startedAt,heartbeatAt:startedAt,updatedAt:startedAt,workerPid:process.pid,error:'',message:resumeReceipt?'已确认SQLite清空事务此前已经提交；本进程仅恢复提交后清理，不会重复删除。':'独立进程正在执行事务化业务数据清空。'};
  writeJson(file,job);writePublic(job);
  const heartbeat=setInterval(()=>{
    const latest=readJson(file);
    const state=String(latest?.status||'').toUpperCase();
    if(!latest||latest.jobId!==jobId||!['RUNNING','COMMITTED'].includes(state))return;
    const now=Date.now();job={...latest,status:state,heartbeatAt:now,updatedAt:now,workerPid:process.pid,message:state==='COMMITTED'?'业务数据事务已提交，正在完成提交后清理。':'独立进程正在执行事务化业务数据清空。'};writeJson(file,job);writePublic(job);
  },5000);
  heartbeat.unref?.();
  try{
    let result;
    if(resumeReceipt){
      result=await finalizeCommittedPurge({challengeId,executeJobId:jobId,user:payload.user||{},recoveredAfterCommit:true});
    }else{
      result=await executePurge({...payload.request,user:payload.user||{},activeRunIds:new Set(),executeJobId:jobId,onCommitted:receipt=>{
        const now=Date.now();
        const committed={...readJson(file),status:'COMMITTED',heartbeatAt:now,updatedAt:now,workerPid:process.pid,error:'',commitReceiptAt:String(receipt?.committedAt||''),message:'SQLite业务数据清空事务已经提交；正在进行可恢复的后置清理。'};
        writeJson(file,committed);writePublic(committed);
      }});
    }
    const structuralWarning=postCommitStructuralWarning(result);
    if(structuralWarning){
      const unsafe=new Error(`业务数据事务已经提交，但结构校验未通过；系统保持COMMITTED保护状态，不会恢复普通写入：${structuralWarning}`);
      unsafe.code='V505_PURGE_POST_COMMIT_STRUCTURE_UNSAFE';
      throw unsafe;
    }
    const completedAt=Date.now();
    const warningCount=Array.isArray(result?.fileCleanupWarnings)?result.fileCleanupWarnings.length:0;
    const completed={...readJson(file),status:'SUCCEEDED',completedAt,heartbeatAt:completedAt,updatedAt:completedAt,result,error:'',message:warningCount?'业务数据已清空；提交后维护存在警告，结果已保留。':'业务数据已安全清空，正在刷新页面。'};
    writeJson(file,completed);writePublic(completed);
    workerAudit(payload.user||{},'DATA_PURGE_COMPLETED',{backupPath:result?.backup?.filePath||'',before:result?.before||{},after:result?.after||{},executeJobId:jobId,recoveredAfterCommit:Boolean(result?.recoveredAfterCommit),worker:'V505_DETACHED_EXECUTE'});
    return result;
  }catch(error){
    const committed=readPurgeCommitReceipt({challengeId,executeJobId:jobId});
    const failedAt=Date.now();
    if(committed){
      const structuralUnsafe=String(error?.code||'')==='V505_PURGE_POST_COMMIT_STRUCTURE_UNSAFE';
      const pending={...readJson(file),status:'COMMITTED',failedAt:0,heartbeatAt:failedAt,updatedAt:failedAt,workerPid:process.pid,error:String(error?.message||error),message:structuralUnsafe?'业务数据事务已经提交，但数据库结构校验未通过。系统保持只读保护；恢复只会重新检查后置状态，绝不会再次删除业务数据。':'业务数据事务已经提交，但后置清理尚未完成。提交凭证已保留；恢复时只继续清理，绝不会再次删除业务数据。'};
      writeJson(file,pending);writePublic(pending);
      workerAudit(payload.user||{},structuralUnsafe?'DATA_PURGE_POST_COMMIT_STRUCTURE_UNSAFE':'DATA_PURGE_POST_COMMIT_RECOVERY_PENDING',{executeJobId:jobId,challengeId,error:String(error?.message||error)});
      throw error;
    }
    const failed={...readJson(file),status:'FAILED',failedAt,heartbeatAt:failedAt,updatedAt:failedAt,error:String(error?.message||error),message:'后台清空失败；未提交的SQLite事务会自动回滚。'};
    writeJson(file,failed);writePublic(failed);clearPurgeBlock();
    workerAudit(payload.user||{},'DATA_PURGE_FAILED',{stage:'execute-worker',error:String(error?.message||error)});
    throw error;
  }finally{clearInterval(heartbeat);}
}
