import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createPurgeChallenge, executePurge, resealPurgeChallenge, PURGE_PHRASE, V505_PURGE_RECOVERY_ID } from './dataPurge.js';
import { getDb, getRuntimeConfig, nowIso } from './db.js';

export const V505_PURGE_COORDINATOR_ID='2026-09-10-v505-purge-coordinator-v3';
const PURGE_BLOCK_KEY='data_purge_block_until';
const PREPARE_JOB_DIR='.purge_prepare_jobs';
const EXECUTE_JOB_DIR='.purge_execute_jobs';
const STATUS_DIR='purge-status';
const EXECUTE_WORKER=fileURLToPath(new URL('../scripts/CE_QC_PurgeExecuteTaskWorker.mjs',import.meta.url));
const ACTIVE_PREPARE=new Set(['QUEUED','RUNNING']);
const ACTIVE_EXECUTE=new Set(['QUEUED','RUNNING']);
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
function setPurgeBlock(until=Date.now()+60*60_000){
  getDb().prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(PURGE_BLOCK_KEY,String(until),nowIso());
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
  return {
    async:true,
    kind:String(job.kind||'EXECUTE'),
    status:String(job.status||'QUEUED'),
    jobId:String(job.jobId||''),
    statusToken:String(job.statusToken||''),
    statusUrl:job.statusToken?`/${STATUS_DIR}/${job.statusToken}.json`:'',
    pollUrl:job.statusToken?`/${STATUS_DIR}/${job.statusToken}.json`:'',
    submittedAt:Number(job.submittedAt||0),
    startedAt:Number(job.startedAt||0),
    heartbeatAt:Number(job.heartbeatAt||0),
    heartbeatStale:Boolean(job.heartbeatAt&&Date.now()-Number(job.heartbeatAt)>HEARTBEAT_STALE_MS),
    workerState:Number(job.workerPid||0)>0?(pidAlive(job.workerPid)?'ALIVE':'DEAD'):'UNKNOWN',
    recoveryPatch:V505_PURGE_RECOVERY_ID,
    coordinatorPatch:V505_PURGE_COORDINATOR_ID,
    message:String(job.message||'')
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
function failJob(jobFile,job={},message=''){
  const failed={...job,status:'FAILED',failedAt:Date.now(),heartbeatAt:Date.now(),updatedAt:Date.now(),error:String(message||'后台清空任务失败。'),message:String(message||'后台清空任务失败。')};
  writeJson(jobFile,failed);writePublic(failed);return failed;
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

export function inspectLivePrepareJob(user={}){
  const file=prepareJobFile(user);const job=readJson(file);
  if(!job||!ACTIVE_PREPARE.has(String(job.status||'').toUpperCase()))return null;
  const alive=pidAlive(job.workerPid);
  if(alive===false)return {dead:true,job,file};
  return {dead:false,job,file,payload:pendingPreparePayload({...job,message:alive===null?'安全备份任务进程状态暂时无法确认；系统保持锁定，不会启动第二份备份。':(Date.now()-Number(job.heartbeatAt||0)>HEARTBEAT_STALE_MS?'安全备份进程仍存活，但状态心跳延迟；系统保持锁定，不会启动第二份备份。':'安全备份正在后台执行。')})};
}

export function inspectExecutionRecovery(user={}){
  const file=executeJobFile(user);const job=readJson(file);
  if(!job)return null;
  const status=String(job.status||'').toUpperCase();
  if(ACTIVE_EXECUTE.has(status)){
    const alive=pidAlive(job.workerPid);
    if(alive===false){
      const failed=failJob(file,job,'后台清空进程已退出。SQLite事务会自动回滚未提交修改；系统已解除清空锁，请重新开始。');
      clearPurgeBlock();
      return pendingPayload(failed);
    }
    return pendingPayload({...job,message:alive===null?'清空进程状态暂时无法确认；系统保持锁定，不会启动第二个清空任务。':(Date.now()-Number(job.heartbeatAt||0)>HEARTBEAT_STALE_MS?'清空进程仍存活，但状态心跳延迟；系统保持锁定，不会启动第二个清空任务。':'正在后台清空业务数据。')});
  }
  if(status==='SUCCEEDED'&&Date.now()-Number(job.completedAt||job.updatedAt||0)<=EXECUTE_RECOVERY_MS)return {...pendingPayload(job),status:'SUCCEEDED',completed:true,result:job.result||null};
  if(status==='FAILED'){removeJobArtifacts(file,job);return null;}
  if(status==='SUCCEEDED'){removeJobArtifacts(file,job);return null;}
  return null;
}

export async function v505PurgePrepareHandler(req,res){
  try{
    const executing=inspectExecutionRecovery(req.user||{});
    if(executing)return res.json({ok:true,...executing,administrator:req.user?.email||req.user?.username||''});
    const live=inspectLivePrepareJob(req.user||{});
    if(live&&!live.dead)return res.json({ok:true,...live.payload,administrator:req.user?.email||req.user?.username||''});
    assertNoBusinessLock();
    let challenge=await createPurgeChallenge(req.user||{}, {activeRunIds:new Set()});
    if(live?.dead&&String(challenge?.status||'').toUpperCase()==='FAILED'){
      challenge=await createPurgeChallenge(req.user||{}, {activeRunIds:new Set()});
    }
    return res.json({ok:true,...challenge,administrator:req.user?.email||req.user?.username||'',coordinatorPatch:V505_PURGE_COORDINATOR_ID});
  }catch(error){
    return res.status(409).json({ok:false,code:'V505_PURGE_PREPARE_BLOCKED',error:error?.message||String(error),coordinatorPatch:V505_PURGE_COORDINATOR_ID});
  }
}

export async function queuePurgeExecution(user={},request={}){
  const challengeId=String(request.challengeId||'');
  if(!challengeId)throw new Error('缺少清空验证凭证。');
  if(String(request.phrase||'')!==PURGE_PHRASE)throw new Error(`请输入完整确认短语：${PURGE_PHRASE}`);
  if(request.backupConfirmed!==true)throw new Error('请确认自动安全备份已经完成。');
  const file=executeJobFile(user);
  const existing=readJson(file);
  if(existing){
    const status=String(existing.status||'').toUpperCase();
    if(ACTIVE_EXECUTE.has(status)){
      const alive=pidAlive(existing.workerPid);
      if(alive!==false)return pendingPayload(existing);
      failJob(file,existing,'上一个后台清空进程已经退出，已允许重新创建安全任务。');
      clearPurgeBlock();
    }else if(status==='SUCCEEDED'&&String(existing.challengeId||'')===challengeId&&Date.now()-Number(existing.completedAt||0)<=EXECUTE_RECOVERY_MS){
      return {...pendingPayload(existing),status:'SUCCEEDED',completed:true,result:existing.result||null};
    }
    removeJobArtifacts(file,readJson(file)||existing);
  }
  assertNoBusinessLock();
  resealPurgeChallenge(challengeId,user);
  setPurgeBlock(Date.now()+60*60_000);
  const statusToken=crypto.randomBytes(24).toString('hex');
  const publicFile=statusFile(statusToken);
  const jobId=crypto.randomUUID();
  const submittedAt=Date.now();
  let job={
    patchId:V505_PURGE_COORDINATOR_ID,kind:'EXECUTE',jobId,challengeId,statusToken,statusFile:publicFile,
    status:'QUEUED',submittedAt,startedAt:0,heartbeatAt:submittedAt,updatedAt:submittedAt,workerPid:0,error:'',message:'后台清空任务已排队。',
    user:{id:user.id||null,email:String(user.email||''),username:String(user.username||''),role:String(user.role||'ADMIN')},
    request:{challengeId,phrase:PURGE_PHRASE,backupConfirmed:true}
  };
  writeJson(file,job);writePublic(job);
  const workerPayload={jobFile:file,statusFile:publicFile,jobId,user:job.user,request:job.request,delayMs:750};
  const encoded=Buffer.from(JSON.stringify(workerPayload),'utf8').toString('base64url');
  let child;
  try{
    child=spawn(process.execPath,[EXECUTE_WORKER,encoded],{cwd:getRuntimeConfig().projectRoot,env:{...process.env,CE_QC_PURGE_EXECUTE_CHILD:'1'},windowsHide:true,detached:true,stdio:'ignore'});
    child.unref();
  }catch(error){
    failJob(file,job,`无法启动后台清空进程：${error?.message||String(error)}`);clearPurgeBlock();throw error;
  }
  job={...job,workerPid:Number(child.pid||0),updatedAt:Date.now(),message:'后台清空任务已提交，等待独立进程接管。'};
  writeJson(file,job);writePublic(job);
  return pendingPayload(job);
}

export async function v505PurgeExecuteHandler(req,res){
  try{
    const queued=await queuePurgeExecution(req.user||{},req.body||{});
    return res.status(queued.status==='SUCCEEDED'?200:202).json({ok:true,...queued,coordinatorPatch:V505_PURGE_COORDINATOR_ID});
  }catch(error){
    return res.status(409).json({ok:false,code:'V505_PURGE_EXECUTE_BLOCKED',error:error?.message||String(error),coordinatorPatch:V505_PURGE_COORDINATOR_ID});
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
  const startedAt=Date.now();
  job={...job,status:'RUNNING',startedAt,heartbeatAt:startedAt,updatedAt:startedAt,workerPid:process.pid,message:'独立进程正在执行事务化业务数据清空。'};
  writeJson(file,job);writePublic(job);
  const heartbeat=setInterval(()=>{
    const latest=readJson(file);
    if(!latest||latest.jobId!==jobId||String(latest.status||'').toUpperCase()!=='RUNNING')return;
    const now=Date.now();job={...latest,heartbeatAt:now,updatedAt:now,workerPid:process.pid,message:'独立进程正在执行事务化业务数据清空。'};writeJson(file,job);writePublic(job);
  },5000);
  heartbeat.unref?.();
  try{
    resealPurgeChallenge(payload.request?.challengeId,payload.user||{});
    const result=await executePurge({...payload.request,user:payload.user||{},activeRunIds:new Set()});
    const completedAt=Date.now();
    const completed={...readJson(file),status:'SUCCEEDED',completedAt,heartbeatAt:completedAt,updatedAt:completedAt,result,error:'',message:'业务数据已安全清空，正在刷新页面。'};
    writeJson(file,completed);writePublic(completed);
    workerAudit(payload.user||{},'DATA_PURGE_COMPLETED',{backupPath:result?.backup?.filePath||'',before:result?.before||{},after:result?.after||{},worker:'V505_DETACHED_EXECUTE'});
    return result;
  }catch(error){
    const failedAt=Date.now();
    const failed={...readJson(file),status:'FAILED',failedAt,heartbeatAt:failedAt,updatedAt:failedAt,error:String(error?.message||error),message:'后台清空失败；未提交的SQLite事务会自动回滚。'};
    writeJson(file,failed);writePublic(failed);clearPurgeBlock();
    workerAudit(payload.user||{},'DATA_PURGE_FAILED',{stage:'execute-worker',error:String(error?.message||error)});
    throw error;
  }finally{clearInterval(heartbeat);}
}

export function v505PurgeWriteBlockMiddleware(req,res,next){
  if(!['POST','PUT','PATCH','DELETE'].includes(String(req.method||'').toUpperCase()))return next();
  const pathname=String(req.originalUrl||req.url||'').split('?')[0];
  if(/^\/api\/admin\/data-purge\/(?:prepare|execute)$/.test(pathname))return next();
  const until=purgeBlockUntil();
  if(Number.isFinite(until)&&until>Date.now()){
    return res.status(423).json({ok:false,code:'DATA_PURGE_IN_PROGRESS',error:'系统正在执行安全备份或清空业务数据。为防止数据在备份后继续变化，当前写入已临时锁定。',until:new Date(until).toISOString(),coordinatorPatch:V505_PURGE_COORDINATOR_ID});
  }
  return next();
}
