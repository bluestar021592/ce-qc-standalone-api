import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getDb, getRuntimeConfig } from './db.js';
import { waitForMainApiDrain, V505_PURGE_HTTP_ACTIVITY_ID } from './v505PurgeHttpActivity.js';
import { inspectGlobalHistoricalPurgeStartupDebris, retireGlobalHistoricalPurgeStartupDebris } from './v505PurgeStartupOrphanGuard.js';
import { inspectV541PurgeJobWorker, inspectV541PurgePidOwnership, V541_PURGE_PID_OWNERSHIP_ID } from './v541PurgePidOwnership.js';

export const V505_PURGE_GLOBAL_GUARD_ID='2026-09-15-v541-global-purge-pid-reuse-v1';
const ACTIVE=new Set(['QUEUED','RUNNING','COMMITTED']);
const KNOWN_JOB_STATUS=new Set(['QUEUED','RUNNING','COMMITTED','SUCCEEDED','FAILED']);
const PREPARE_DIR='.purge_prepare_jobs';
const EXECUTE_DIR='.purge_execute_jobs';
const PURGE_BLOCK_KEY='data_purge_block_until';
const PURGE_COMMIT_RECEIPT_KEY='data_purge_last_commit_receipt';
const SUBMISSION_MUTEX_FILE='.purge_global_submission.lock.json';
const PROCESS_INSTANCE_TOKEN=crypto.randomBytes(16).toString('hex');

function identityKey(user={}){
  const identity=String(user.id||user.email||user.username||'').trim().toLowerCase();
  if(!identity)return '';
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0,24);
}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function validJobSidecar(job){
  if(!job||typeof job!=='object'||Array.isArray(job))return false;
  return Boolean(String(job.jobId||'').trim()&&KNOWN_JOB_STATUS.has(String(job.status||'').toUpperCase()));
}
function readJobRow(directory,name){
  const file=path.join(directory,name);
  try{
    const job=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!validJobSidecar(job))return {name,file,job:null,unreadable:true,error:'JSON结构缺少有效 jobId / status'};
    return {name,file,job,unreadable:false,error:''};
  }catch(error){return {name,file,job:null,unreadable:true,error:String(error?.message||error)};}
}
function blockUntil(db=getDb()){
  return Number(db.prepare('SELECT value FROM app_meta WHERE key=?').get(PURGE_BLOCK_KEY)?.value||0);
}
function lastCommitReceiptState(db=getDb()){
  const raw=String(db.prepare('SELECT value FROM app_meta WHERE key=?').get(PURGE_COMMIT_RECEIPT_KEY)?.value||'');
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
}
function listJobs(directory){
  let names=[];
  try{names=fs.readdirSync(directory).filter(name=>name.endsWith('.job.json'));}catch{return [];}
  return names.map(name=>readJobRow(directory,name));
}
function receiptMatchesExecute(receipt,row){
  if(!receipt||!row?.job)return false;
  const status=String(row.job.status||'').toUpperCase();
  if(status==='SUCCEEDED')return false;
  const challengeId=String(row.job.challengeId||row.job.request?.challengeId||'');
  return Boolean(challengeId&&String(receipt.challengeId||'')===challengeId&&String(receipt.executeJobId||'')===String(row.job.jobId||''));
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
function activeWorkerState(ownership={}){
  if(ownership.active!==true)return ownership.workerState||'DEAD';
  return String(ownership.workerState||'UNKNOWN');
}
function protectedJob(group,row,lockedUntil,now,receipt){
  if(row?.unreadable){
    return {kind:group.kind,status:'UNKNOWN',workerState:'SIDECAR_UNREADABLE',jobId:'',lockedUntil,durableReceipt:false,stateError:String(row.error||'UNKNOWN')};
  }
  const status=String(row.job.status||'').toUpperCase();
  const ownership=inspectV541PurgeJobWorker(row.job);
  const live=ownership.active===true&&String(ownership.workerState||'')==='ALIVE';
  if(group.kind==='EXECUTE'&&receiptMatchesExecute(receipt,row)){
    if(receiptIsFinalized(receipt)){
      if(live){
        return {kind:group.kind,status:'FINALIZED',workerState:'FINALIZER_TAIL_ACTIVE',identityState:ownership.identityState||'',jobId:String(row.job.jobId||''),lockedUntil,durableReceipt:true,receiptFinalized:true};
      }
      return null;
    }
    return {kind:group.kind,status:'COMMITTED',workerState:live?'ALIVE':'COMMITTED_RECOVERY',identityState:ownership.identityState||'',jobId:String(row.job.jobId||''),lockedUntil,durableReceipt:true,receiptFinalized:false};
  }
  if(group.kind==='EXECUTE'&&status==='COMMITTED'){
    return {kind:group.kind,status,workerState:live?'ALIVE':'COMMITTED_RECOVERY',identityState:ownership.identityState||'',jobId:String(row.job.jobId||''),lockedUntil};
  }
  if(ACTIVE.has(status)){
    if(ownership.active===true||lockedUntil>now){
      let workerState=activeWorkerState(ownership);
      if(ownership.active!==true&&lockedUntil>now){
        workerState=String(ownership.identityState||'')==='PID_REUSED'?'PID_REUSED_LOCKED':'DEAD_LOCKED';
      }
      return {kind:group.kind,status,workerState,identityState:ownership.identityState||'',jobId:String(row.job.jobId||''),lockedUntil};
    }
    return null;
  }
  if(group.kind==='EXECUTE'&&status==='FAILED'&&lockedUntil>now){
    return {kind:group.kind,status,workerState:'FAILED_RETRYABLE',jobId:String(row.job.jobId||''),lockedUntil};
  }
  if(group.kind==='PREPARE'&&status==='SUCCEEDED'){
    if(prepareMatchesFinalizedReceipt(receipt,row.job))return null;
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
  const db=getDb();
  const lockedUntil=blockUntil(db);
  const receiptState=lastCommitReceiptState(db);
  const receipt=receiptState.receipt;
  const groups=[
    {kind:'EXECUTE',dir:path.join(cfg.backupsDir,EXECUTE_DIR)},
    {kind:'PREPARE',dir:path.join(cfg.backupsDir,PREPARE_DIR)}
  ];
  const own=[];
  let foreign=null;
  let receiptMatched=false;
  for(const group of groups){
    for(const row of listJobs(group.dir)){
      const protectedState=protectedJob(group,row,lockedUntil,now,receipt);
      if(!protectedState)continue;
      if(group.kind==='EXECUTE'&&receipt&&String(protectedState.jobId||'')===String(receipt.executeJobId||''))receiptMatched=true;
      if(row.name===ownName)own.push(protectedState);
      else if(!foreign)foreign=protectedState;
    }
  }
  const ownProtected=own.length>0;
  const orphanedLock=lockedUntil>now&&!ownProtected&&!foreign;
  const commitReceiptPending=Boolean(receipt&&!String(receipt.finalizedAt||'').trim());
  const commitReceiptOrphaned=Boolean(commitReceiptPending&&!receiptMatched);
  return {
    foreign,own,ownProtected,orphanedLock,lockedUntil,
    commitReceiptUnreadable:Boolean(receiptState.unreadable),
    commitReceiptError:String(receiptState.error||''),
    commitReceiptPending,
    commitReceiptOrphaned,
    receiptExecuteJobId:String(receipt?.executeJobId||''),
    receiptFinalizedAt:String(receipt?.finalizedAt||''),
    pidOwnershipPatch:V541_PURGE_PID_OWNERSHIP_ID
  };
}

function submissionMutexFile(){
  const dir=getRuntimeConfig().backupsDir;
  fs.mkdirSync(dir,{recursive:true});
  return path.join(dir,SUBMISSION_MUTEX_FILE);
}
function sameSubmissionMutexIdentity(left={},right={}){
  const leftRequest=String(left.requestToken||'');
  const rightRequest=String(right.requestToken||'');
  if(!leftRequest||!rightRequest||leftRequest!==rightRequest)return false;
  return Number(left.pid||0)===Number(right.pid||0)
    && String(left.processInstanceToken||'')===String(right.processInstanceToken||'')
    && Number(left.acquiredAt||0)===Number(right.acquiredAt||0)
    && String(left.ownerKey||'')===String(right.ownerKey||'');
}
function removeStaleSubmissionMutexIfUnchanged(file,expected){
  const current=readJson(file);
  if(!current||!sameSubmissionMutexIdentity(current,expected))return false;
  try{fs.rmSync(file,{force:true});return true;}catch{return false;}
}
function inspectSubmissionMutex(record={}){
  if(!record||typeof record!=='object'||Array.isArray(record))return {active:true,stale:false,workerState:'UNKNOWN',identityState:'START_UNVERIFIED'};
  const pid=Number(record.pid||0);
  if(pid===process.pid&&String(record.processInstanceToken||'')!==PROCESS_INSTANCE_TOKEN){
    return {active:false,stale:true,workerState:'PROCESS_INSTANCE_REPLACED',identityState:'PROCESS_INSTANCE_REPLACED'};
  }
  return inspectV541PurgePidOwnership({pid,ownerAcquiredAt:record.acquiredAt});
}
function tryCreateSubmissionMutex(file,record){
  let fd=null;
  try{
    fd=fs.openSync(file,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify(record),'utf8');
    try{fs.fsyncSync(fd);}catch{}
    fs.closeSync(fd);fd=null;
    return true;
  }catch(error){
    if(fd!==null){try{fs.closeSync(fd);}catch{}try{fs.rmSync(file,{force:true});}catch{}}
    if(error?.code==='EEXIST')return false;
    throw error;
  }
}

export function acquireGlobalPurgeSubmissionMutex(user={}){
  const ownerKey=identityKey(user);
  if(!ownerKey)throw new Error('缺少管理员身份，无法申请全局清空提交锁。');
  const file=submissionMutexFile();
  const record={ownerKey,pid:process.pid,processInstanceToken:PROCESS_INSTANCE_TOKEN,requestToken:crypto.randomUUID(),acquiredAt:Date.now(),guard:V505_PURGE_GLOBAL_GUARD_ID};
  if(tryCreateSubmissionMutex(file,record))return {acquired:true,record,file};
  const current=readJson(file);
  const ownership=inspectSubmissionMutex(current);
  if(!current||ownership.active===true||ownership.stale!==true)return {acquired:false,current,file,ownership};
  if(!removeStaleSubmissionMutexIfUnchanged(file,current))return {acquired:false,current:readJson(file)||current,file,ownership};
  if(tryCreateSubmissionMutex(file,record))return {acquired:true,record,file,recoveredStale:true,recoveryReason:ownership.identityState||ownership.workerState||'STALE'};
  return {acquired:false,current:readJson(file),file,ownership};
}

export function releaseGlobalPurgeSubmissionMutex(record={}){
  if(!record?.requestToken)return false;
  const file=submissionMutexFile();
  const current=readJson(file);
  if(!current||String(current.requestToken||'')!==String(record.requestToken)||String(current.processInstanceToken||'')!==PROCESS_INSTANCE_TOKEN)return false;
  try{fs.rmSync(file,{force:true});return true;}catch{return false;}
}

function blocked(res,code,error,detail={}){
  return res.status(423).json({ok:false,code,error,...detail,guardPatch:V505_PURGE_GLOBAL_GUARD_ID,pidOwnershipPatch:V541_PURGE_PID_OWNERSHIP_ID});
}
function receiptBlockedResponse(ownership,res){
  if(ownership.commitReceiptUnreadable){
    return blocked(res,'DATA_PURGE_COMMIT_RECEIPT_UNREADABLE','检测到无法验证的SQLite清空事务提交凭证。系统无法安全判断此前DELETE是否已经提交，因此保持停止，不会启动或接管任何清空任务。',{
      workerState:'COMMIT_RECEIPT_UNREADABLE'
    });
  }
  if(ownership.commitReceiptOrphaned){
    return blocked(res,'DATA_PURGE_COMMIT_RECEIPT_PENDING_RECOVERY','检测到SQLite已提交但尚未完成最终安全校验的清空凭证，同时对应任务状态文件缺失或不再可确认。系统保持停止和只读保护，不会启动第二次DELETE。',{
      workerState:'COMMIT_RECEIPT_ORPHANED',executeJobId:ownership.receiptExecuteJobId
    });
  }
  return null;
}
function retireHistoricalStartupGlobally(user={}){
  const preview=inspectGlobalHistoricalPurgeStartupDebris();
  if(!preview.needsSerialization)return {attempted:false,busy:false,result:null};
  const mutex=acquireGlobalPurgeSubmissionMutex(user);
  if(!mutex.acquired)return {attempted:true,busy:true,result:null};
  try{
    const result=retireGlobalHistoricalPurgeStartupDebris({mutationAuthorized:true});
    return {attempted:true,busy:false,result};
  }finally{
    try{releaseGlobalPurgeSubmissionMutex(mutex.record);}catch{}
  }
}

export async function v505PurgeGlobalOwnerGuard(req,res,next){
  try{
    let ownership=inspectGlobalPurgeOwnership(req.user||{});
    const initialReceiptBlock=receiptBlockedResponse(ownership,res);
    if(initialReceiptBlock)return initialReceiptBlock;

    const retired=retireHistoricalStartupGlobally(req.user||{});
    if(retired.busy){
      return blocked(res,'DATA_PURGE_SUBMISSION_BUSY','历史清空启动状态正在被另一项原子操作核对。系统不会并发覆盖任务，请稍后重试。');
    }
    if(retired.attempted){
      ownership=inspectGlobalPurgeOwnership(req.user||{});
      const receiptBlock=receiptBlockedResponse(ownership,res);
      if(receiptBlock)return receiptBlock;
    }

    if(ownership.foreign){
      const phase=ownership.foreign.kind==='EXECUTE'?'清空':'安全备份';
      return blocked(res,'DATA_PURGE_OWNED_BY_ANOTHER_ADMIN',`另一名管理员已有${phase}任务处于受保护或无法确认状态。系统不会启动第二个任务。`,{
        phase:ownership.foreign.kind,status:ownership.foreign.status,workerState:ownership.foreign.workerState,
        identityState:ownership.foreign.identityState||'',
        lockedUntil:ownership.foreign.lockedUntil>0?new Date(ownership.foreign.lockedUntil).toISOString():''
      });
    }
    const ownUnreadable=ownership.own.find(item=>item.workerState==='SIDECAR_UNREADABLE');
    if(ownUnreadable){
      return blocked(res,'DATA_PURGE_OWNER_STATE_UNREADABLE','检测到当前管理员已有无法读取或结构不完整的清空任务状态文件。为避免覆盖仍可能存活的后台任务，系统保持停止，不会启动第二个任务。',{
        phase:ownUnreadable.kind,status:ownUnreadable.status,workerState:ownUnreadable.workerState
      });
    }
    if(ownership.orphanedLock){
      return blocked(res,'DATA_PURGE_GLOBAL_LOCK_ORPHANED','检测到仍有效的全局清空安全锁，但无法确认其任务所有者。为避免并发清空，系统已安全阻止本次操作。',{
        lockedUntil:new Date(ownership.lockedUntil).toISOString()
      });
    }

    const pathname=String(req.originalUrl||req.url||req.path||'').split('?')[0];
    const isPrepare=pathname==='/api/admin/data-purge/prepare';
    const reusableOwnTask=ownership.own.some(item=>(ACTIVE.has(String(item.status||'').toUpperCase())&&String(item.workerState||'')==='ALIVE')||String(item.workerState||'')==='FINALIZER_TAIL_ACTIVE');
    if(isPrepare&&reusableOwnTask)return next();

    const mutex=acquireGlobalPurgeSubmissionMutex(req.user||{});
    if(!mutex.acquired){
      return blocked(res,'DATA_PURGE_SUBMISSION_BUSY','另一项清空提交正在进入受保护任务队列。系统不会并发创建第二个备份或删除任务，请稍后重试。',{
        workerState:mutex.ownership?.workerState||'',identityState:mutex.ownership?.identityState||''
      });
    }
    let released=false;
    const release=()=>{
      if(released)return;
      released=true;
      try{releaseGlobalPurgeSubmissionMutex(mutex.record);}catch{}
      if(req.v505PurgeSubmissionMutexRelease===release)delete req.v505PurgeSubmissionMutexRelease;
    };
    req.v505PurgeSubmissionMutexRelease=release;
    res.once?.('finish',release);

    const drained=await waitForMainApiDrain({timeoutMs:3000,pollMs:25});
    if(!drained.drained){
      release();
      return blocked(res,'DATA_PURGE_HTTP_BUSY','仍有清空请求之前就已进入主服务的API正在处理。系统没有启动备份，请等待当前请求结束后再重试。',{
        activityGate:V505_PURGE_HTTP_ACTIVITY_ID,
        activeRequests:drained.requests.slice(0,5).map(item=>({method:item.method,pathname:item.pathname,ageMs:item.ageMs}))
      });
    }

    try{return next();}
    catch(error){release();throw error;}
  }catch(error){
    return blocked(res,'DATA_PURGE_GLOBAL_GUARD_UNAVAILABLE',`无法确认全局清空任务所有权，已安全阻止本次操作：${error?.message||String(error)}`);
  }
}
