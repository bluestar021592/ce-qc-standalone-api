import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const V505_PURGE_WORKER_CLAIM_ID='2026-09-12-v505-worker-claim-v3-shared-serialization';
const CLAIM_LOCK_SUFFIX='.worker-claim.lock';

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
function acquireClaimLock(jobFile,jobId){
  const file=claimLockFile(jobFile);
  const record={jobId:String(jobId||''),pid:process.pid,token:crypto.randomUUID(),acquiredAt:Date.now()};
  for(let attempt=0;attempt<2;attempt+=1){
    if(tryCreateClaimLock(file,record))return {file,record};
    const current=readJsonNullable(file);
    if(!current||typeof current!=='object'||Array.isArray(current)){
      throw coded('V505_PURGE_WORKER_CLAIM_LOCK_UNREADABLE','V505_PURGE_WORKER_CLAIM_LOCK_UNREADABLE');
    }
    const live=pidAlive(current.pid);
    if(live===false){
      try{fs.rmSync(file,{force:true});}catch{}
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
    if(Number.isInteger(currentPid)&&currentPid>0&&currentPid!==process.pid&&pidAlive(currentPid)===true){
      throw coded('V505_PURGE_WORKER_ALREADY_CLAIMED');
    }

    const now=Date.now();
    const claimed={
      ...job,
      workerPid:process.pid,
      workerClaimedAt:Number(job.workerClaimedAt||0)||now,
      heartbeatAt:now,
      updatedAt:now,
      workerClaimPatch:V505_PURGE_WORKER_CLAIM_ID
    };
    writeJsonAtomic(file,claimed);
    return claimed;
  });
}
