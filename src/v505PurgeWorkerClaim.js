import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const V505_PURGE_WORKER_CLAIM_ID='2026-09-15-v540-worker-claim-pid-reuse-v1';
const CLAIM_LOCK_SUFFIX='.worker-claim.lock';
const PID_IDENTITY_TIMEOUT_MS=Math.max(1000,Math.min(12_000,Number(process.env.V540_PURGE_WORKER_PID_IDENTITY_TIMEOUT_MS||8000)));
export const V540_WORKER_CLAIM_PID_REUSE_TOLERANCE_MS=Math.max(1000,Math.min(60_000,Number(process.env.V540_WORKER_CLAIM_PID_REUSE_TOLERANCE_MS||5000)));

function readJson(file){
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}
  catch(error){const wrapped=new Error(`V505_PURGE_WORKER_CLAIM_JOB_UNREADABLE: ${error?.message||String(error)}`);wrapped.code='V505_PURGE_WORKER_CLAIM_JOB_UNREADABLE';throw wrapped;}
}
function readJsonNullable(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function writeJsonAtomic(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=`${file}.${process.pid}.${crypto.randomUUID().slice(0,8)}.claim.tmp`;
  fs.writeFileSync(temp,JSON.stringify(value||{},null,2),'utf8');
  try{fs.renameSync(temp,file);}catch{
    try{fs.rmSync(file,{force:true});}catch{}
    fs.renameSync(temp,file);
  }
}
function pidAlive(pid){
  const number=Number(pid||0);
  if(!Number.isInteger(number)||number<=0)return null;
  try{process.kill(number,0);return true;}catch(error){return error?.code==='EPERM'?true:false;}
}
function ownershipInstant(value){
  if(value==null||value==='')return 0;
  const numeric=Number(value);
  if(Number.isFinite(numeric))return numeric>1_000_000_000_000?numeric:0;
  const parsed=Date.parse(String(value));
  return Number.isFinite(parsed)&&parsed>1_000_000_000_000?parsed:0;
}
function processStartedAtMs(pid){
  const value=Number(pid||0);
  if(!Number.isInteger(value)||value<=0||process.platform!=='win32')return 0;
  try{
    const script=`$p=Get-CimInstance Win32_Process -Filter \"ProcessId = ${value}\" -ErrorAction SilentlyContinue; if($p -and $p.CreationDate){$d=[DateTimeOffset]$p.CreationDate; [Console]::Write($d.ToUnixTimeMilliseconds())}`;
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:PID_IDENTITY_TIMEOUT_MS});
    if(result.error)return 0;
    const startedAt=Number(String(result.stdout||'').trim());
    return Number.isFinite(startedAt)&&startedAt>1_000_000_000_000?startedAt:0;
  }catch{return 0;}
}
export function classifyV540WorkerPidOwnership({workerState='',ownerAcquiredAt=0,processStartedAt=0,toleranceMs=V540_WORKER_CLAIM_PID_REUSE_TOLERANCE_MS}={}){
  const state=String(workerState||'UNKNOWN').toUpperCase();
  if(state==='DEAD')return {active:false,stale:true,workerState:'DEAD',identityState:'DEAD'};
  if(state!=='ALIVE')return {active:true,stale:false,workerState:state||'UNKNOWN',identityState:'START_UNVERIFIED'};
  const ownerAt=ownershipInstant(ownerAcquiredAt);
  const startedAt=ownershipInstant(processStartedAt);
  const tolerance=Math.max(1000,Math.min(60_000,Number(toleranceMs)||V540_WORKER_CLAIM_PID_REUSE_TOLERANCE_MS));
  if(!ownerAt||!startedAt)return {active:true,stale:false,workerState:'ALIVE',identityState:'START_UNVERIFIED'};
  if(startedAt>ownerAt+tolerance){
    return {active:false,stale:true,workerState:'ALIVE_PID_REUSED',identityState:'PID_REUSED',ownerAcquiredAt:ownerAt,processStartedAt:startedAt};
  }
  return {active:true,stale:false,workerState:'ALIVE',identityState:'START_MATCH',ownerAcquiredAt:ownerAt,processStartedAt:startedAt};
}
function inspectPidOwnership(pid,ownerAcquiredAt){
  const alive=pidAlive(pid);
  const workerState=alive===true?'ALIVE':alive===false?'DEAD':'UNKNOWN';
  const processStartedAt=workerState==='ALIVE'?processStartedAtMs(pid):0;
  return {...classifyV540WorkerPidOwnership({workerState,ownerAcquiredAt,processStartedAt}),processStartedAt};
}
function coded(code,message=code){const error=new Error(message);error.code=code;return error;}
function claimLockFile(jobFile=''){return `${String(jobFile||'')}${CLAIM_LOCK_SUFFIX}`;}
function tryCreateClaimLock(file,record){
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
function sameClaimLockIdentity(left={},right={}){
  const leftToken=String(left.token||'');
  const rightToken=String(right.token||'');
  if(!leftToken||!rightToken||leftToken!==rightToken)return false;
  return String(left.jobId||'')===String(right.jobId||'')
    && Number(left.pid||0)===Number(right.pid||0)
    && Number(left.acquiredAt||0)===Number(right.acquiredAt||0);
}
function removeClaimLockIfUnchanged(file,expected){
  const current=readJsonNullable(file);
  if(!current||!sameClaimLockIdentity(current,expected))return false;
  try{fs.rmSync(file,{force:true});return true;}catch{return false;}
}
function acquireClaimLock(jobFile,jobId){
  const file=claimLockFile(jobFile);
  const record={jobId:String(jobId||''),pid:process.pid,token:crypto.randomUUID(),acquiredAt:Date.now()};
  for(let attempt=0;attempt<2;attempt+=1){
    if(tryCreateClaimLock(file,record))return {file,record};
    const current=readJsonNullable(file);
    if(!current||typeof current!=='object'||Array.isArray(current)){
      throw coded('V505_PURGE_WORKER_CLAIM_LOCK_UNREADABLE','V505_PURGE_WORKER_CLAIM_LOCK_UNREADABLE');
    }
    const ownership=inspectPidOwnership(current.pid,current.acquiredAt);
    if(ownership.active===false&&ownership.stale===true&&removeClaimLockIfUnchanged(file,current)){
      continue;
    }
    throw coded('V505_PURGE_WORKER_CLAIM_BUSY','V505_PURGE_WORKER_CLAIM_BUSY');
  }
  throw coded('V505_PURGE_WORKER_CLAIM_BUSY','V505_PURGE_WORKER_CLAIM_BUSY');
}
function releaseClaimLock(lock={}){
  const file=String(lock.file||'');
  const token=String(lock.record?.token||'');
  if(!file||!token)return false;
  const current=readJsonNullable(file);
  if(!current||String(current.token||'')!==token||Number(current.pid||0)!==process.pid)return false;
  try{fs.rmSync(file,{force:true});return true;}catch{return false;}
}

export function withPurgeWorkerClaimSerialization({jobFile='',jobId=''}={},callback=()=>undefined){
  const file=String(jobFile||'');
  const expectedJobId=String(jobId||'');
  if(!file||!expectedJobId)throw coded('V505_PURGE_WORKER_CLAIM_PAYLOAD_INVALID');
  if(typeof callback!=='function')throw coded('V505_PURGE_WORKER_CLAIM_CALLBACK_INVALID');
  const lock=acquireClaimLock(file,expectedJobId);
  try{return callback();}
  finally{releaseClaimLock(lock);}
}

export function claimPurgeWorkerSidecar({jobFile='',jobId='',allowedStatuses=[]}={}){
  const file=String(jobFile||'');
  const expectedJobId=String(jobId||'');
  return withPurgeWorkerClaimSerialization({jobFile:file,jobId:expectedJobId},()=>{
    const job=readJson(file);
    if(String(job?.jobId||'')!==expectedJobId)throw coded('V505_PURGE_WORKER_CLAIM_JOB_MISMATCH');
    const status=String(job.status||'').toUpperCase();
    const allowed=new Set((allowedStatuses||[]).map(value=>String(value||'').toUpperCase()));
    if(allowed.size&&!allowed.has(status))throw coded('V505_PURGE_WORKER_CLAIM_STATUS_INVALID',`V505_PURGE_WORKER_CLAIM_STATUS_INVALID:${status||'EMPTY'}`);

    const currentPid=Number(job.workerPid||0);
    if(Number.isInteger(currentPid)&&currentPid>0&&currentPid!==process.pid){
      const ownershipAnchor=job.workerClaimedAt||job.startedAt||job.submittedAt||0;
      const ownership=inspectPidOwnership(currentPid,ownershipAnchor);
      if(ownership.active===true){
        throw coded('V505_PURGE_WORKER_ALREADY_CLAIMED');
      }
    }

    const now=Date.now();
    const claimed={
      ...job,
      workerPid:process.pid,
      workerClaimedAt:now,
      heartbeatAt:now,
      updatedAt:now,
      workerClaimPatch:V505_PURGE_WORKER_CLAIM_ID
    };
    writeJsonAtomic(file,claimed);
    return claimed;
  });
}
