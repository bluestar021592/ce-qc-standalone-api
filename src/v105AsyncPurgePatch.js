import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { resealPurgeChallenge } from './dataPurge.js';
import { getDb, getRuntimeConfig } from './db.js';
import { auditAction } from './accessControl.js';

const PATCH_ID = '2026-08-14-v131-isolated-purge-worker-v1';
const PREPARE_PATH = '/api/admin/data-purge/prepare';
const EXECUTE_PATH = '/api/admin/data-purge/execute';
const PREPARE_STATUS_PATH = '/api/v105/data-purge/prepare/:jobId';
const EXECUTE_STATUS_PATH = '/api/v105/data-purge/execute/:jobId';
const ACTIVE_STATUS_PATH = '/api/v105/data-purge/active';
const RECOVER_STATUS_PATH = '/api/v105/data-purge/recover';
const JOB_TTL_MS = 30 * 60 * 1000;
const JOB_START_DELAY_MS = Math.max(100, Math.min(2000, Number(process.env.PURGE_JOB_START_DELAY_MS || 350)));
const WORKER_TIMEOUT_MS = Math.max(60_000, Math.min(30 * 60_000, Number(process.env.PURGE_WORKER_TIMEOUT_MS || 20 * 60_000)));
const PURGE_PHRASE = '永久清除全部业务数据';
const PURGE_WORKER_FILE = fileURLToPath(new URL('../scripts/CE_QC_PurgeDeleteWorker.mjs', import.meta.url));
const jobs = new Map();
const preparedChallenges = new Map();

function ownerKey(user = {}) {
  return String(user.id || user.email || user.username || '').trim().toLowerCase();
}
function statFingerprint(file){
  try{const stat=fs.statSync(file);return {exists:true,size:Number(stat.size||0),mtimeMs:Number(stat.mtimeMs||0)};}
  catch{return {exists:false,size:0,mtimeMs:0};}
}
function databaseFingerprint(dbFile){return {db:statFingerprint(dbFile),wal:statFingerprint(`${dbFile}-wal`)};}
function sameStatFingerprint(a={},b={}){
  return Boolean(a.exists)===Boolean(b.exists)&&Number(a.size||0)===Number(b.size||0)&&Math.abs(Number(a.mtimeMs||0)-Number(b.mtimeMs||0))<=1;
}
function sameFingerprint(a={},b={}){return sameStatFingerprint(a.db,b.db)&&sameStatFingerprint(a.wal,b.wal);}
function clearPurgeBlock(){
  try{getDb().prepare("DELETE FROM app_meta WHERE key='data_purge_block_until'").run();}catch{}
}
function pollUrlFor(job) {
  const base = job.kind === 'EXECUTE' ? '/api/v105/data-purge/execute/' : '/api/v105/data-purge/prepare/';
  return `${base}${encodeURIComponent(job.jobId)}`;
}
function publicJob(job) {
  const elapsedMs = Math.max(0, Date.now() - Number(job.startedAtMs || job.createdAtMs || Date.now()));
  return {
    ok: true, patchId: PATCH_ID, async: true, kind: job.kind, jobId: job.jobId,
    status: job.status, progress: job.progress, message: job.message, elapsedMs,
    createdAt: job.createdAt, startedAt: job.startedAt || '', completedAt: job.completedAt || '',
    pollUrl: pollUrlFor(job), result: job.status === 'COMPLETED' ? job.result : undefined,
    error: job.status === 'FAILED' ? job.error : undefined
  };
}
function pruneJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    const stamp = Number(job.completedAtMs || job.createdAtMs || 0);
    if (stamp && stamp < cutoff) jobs.delete(id);
  }
  for(const [id,item] of preparedChallenges){if(Number(item.expiresAtMs||0)&&item.expiresAtMs<Date.now())preparedChallenges.delete(id);}
}
function activeJobFor(owner, kind) {
  if (!owner) return null;
  pruneJobs();
  for (const job of jobs.values()) if (job.owner === owner && job.kind === kind && ['QUEUED', 'RUNNING'].includes(String(job.status || ''))) return job;
  return null;
}
function recentJobFor(owner, kind) {
  if (!owner) return null;
  pruneJobs();
  let latest = null;
  for (const job of jobs.values()) {
    if (job.owner !== owner || job.kind !== kind) continue;
    if (!latest || Number(job.createdAtMs || 0) > Number(latest.createdAtMs || 0)) latest = job;
  }
  return latest;
}
function fakeResponse(resolve, reject) {
  let statusCode = 200;
  const headers = new Map();
  const response = {
    headersSent: false,
    status(code) { statusCode = Number(code || 500); return response; },
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); return response; },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    json(payload) {
      response.headersSent = true;
      if (statusCode >= 400 || payload?.ok === false) {
        const error = new Error(payload?.error || payload?.message || `HTTP ${statusCode}`);
        error.status = statusCode; error.payload = payload; reject(error);
      } else resolve(payload);
      return response;
    },
    send(payload) { return response.json(payload); },
    end(payload) { return response.json(payload ? { ok: statusCode < 400, payload } : { ok: statusCode < 400 }); }
  };
  return response;
}
function runLegacyHandler(handler, req) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishResolve = value => { if (!settled) { settled = true; resolve(value); } };
    const finishReject = error => { if (!settled) { settled = true; reject(error); } };
    const res = fakeResponse(finishResolve, finishReject);
    const next = error => error ? finishReject(error) : finishReject(new Error('Legacy purge handler completed without a response.'));
    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === 'function') result.catch(finishReject);
    } catch (error) { finishReject(error); }
  });
}
function rememberPreparedChallenge(result, req){
  const challengeId=String(result?.challengeId||'');
  if(!challengeId)return;
  const cfg=getRuntimeConfig();
  const dbFile=String(result.databasePath||cfg.dbFile);
  preparedChallenges.set(challengeId,{
    challengeId, owner:ownerKey(req.user), email:String(req.user?.email||''),
    notBeforeMs:Number(new Date(result.notBefore||0).getTime()||0), expiresAtMs:Number(new Date(result.expiresAt||0).getTime()||0),
    dbFile, backup:result.backup||{}, sourceFingerprint:databaseFingerprint(dbFile), preparedAtMs:Date.now()
  });
}
function verifyPreparedForWorker(req){
  const challengeId=String(req.body?.challengeId||'');
  const prepared=preparedChallenges.get(challengeId);
  if(!prepared||prepared.expiresAtMs<Date.now()||prepared.owner!==ownerKey(req.user))throw new Error('清除验证已失效，请重新开始。');
  if(Date.now()<prepared.notBeforeMs)throw new Error('请等待5秒安全倒计时完成。');
  if(req.body?.backupConfirmed!==true)throw new Error('自动备份尚未确认，已停止清除。');
  if(String(req.body?.phrase||'')!==PURGE_PHRASE)throw new Error(`请输入完整确认短语：${PURGE_PHRASE}`);
  const backupPath=String(prepared.backup?.path||'');
  if(!backupPath||!fs.existsSync(backupPath))throw new Error('清空前安全备份不存在，已停止清除。');
  const backupStat=fs.statSync(backupPath);
  if(backupStat.size<=0||(prepared.backup?.size&&Number(prepared.backup.size)!==Number(backupStat.size)))throw new Error('清空前安全备份大小异常，已停止清除。');
  if(!/^[a-f0-9]{64}$/i.test(String(prepared.backup?.sha256||'')))throw new Error('清空前安全备份校验记录无效，已停止清除。');
  if(!sameFingerprint(prepared.sourceFingerprint,databaseFingerprint(prepared.dbFile)))throw new Error('数据库在安全备份后发生变化，已停止清除。请重新执行一键清空。');
  return prepared;
}
function runPurgeWorker(prepared, job){
  return new Promise((resolve,reject)=>{
    const cfg=getRuntimeConfig();
    const payload=Buffer.from(JSON.stringify({
      dbFile:prepared.dbFile, expectedFingerprint:prepared.sourceFingerprint, nextState:{logs:[]},
      exportsDir:cfg.exportsDir, importsDir:cfg.importsDir, longJsonExportsDir:cfg.longJsonExportsDir
    }),'utf8').toString('base64url');
    job.progress=18;
    job.message='独立 SQLite 清空进程已启动；网页主进程保持可响应';
    let stdout='';let stderr='';let settled=false;
    const child=spawn(process.execPath,[PURGE_WORKER_FILE,payload],{cwd:cfg.projectRoot,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>{try{child.kill();}catch{};if(!settled){settled=true;reject(new Error('独立清空进程执行超时，已停止等待。'));}},WORKER_TIMEOUT_MS);
    child.stdout?.on('data',chunk=>{stdout+=chunk.toString();if(stdout.length>2*1024*1024)stdout=stdout.slice(-2*1024*1024);});
    child.stderr?.on('data',chunk=>{stderr+=chunk.toString();if(stderr.length>2*1024*1024)stderr=stderr.slice(-2*1024*1024);});
    child.once('error',error=>{clearTimeout(timer);if(!settled){settled=true;reject(error);}});
    child.once('exit',code=>{
      clearTimeout(timer);if(settled)return;settled=true;
      const lines=stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);let payloadResult=null;
      for(let i=lines.length-1;i>=0;i-=1){try{payloadResult=JSON.parse(lines[i]);break;}catch{}}
      if(code!==0||!payloadResult?.ok){reject(new Error(payloadResult?.error||stderr.trim()||`独立清空进程退出码 ${code}`));return;}
      resolve(payloadResult);
    });
  });
}
async function runIsolatedExecute(req,job){
  const prepared=verifyPreparedForWorker(req);
  try{
    const workerResult=await runPurgeWorker(prepared,job);
    const totalDeleted=Object.values(workerResult.before||{}).reduce((sum,value)=>sum+Number(value||0),0);
    try{auditAction(req,'DATA_PURGE_WORKER_COMPLETED',{challengeId:prepared.challengeId,totalDeleted,deleteMode:'ISOLATED_SQLITE_WORKER'});}catch{}
    preparedChallenges.delete(prepared.challengeId);
    return {
      backup:prepared.backup,before:workerResult.before||{},after:workerResult.after||{},completedAt:new Date().toISOString(),event:'DATA_RESET',
      integrity:'ok',integrityCheck:'ISOLATED_TRANSACTION_AND_SCHEMA',walCheckpoint:'AUTO',fileCleanupWarnings:workerResult.fileCleanupWarnings||[],
      deleteMode:'ISOLATED_SQLITE_WORKER',performanceIndexes:'V108',countSource:'DELETE_CHANGESET_EXACT',backupSourceFingerprint:'MATCHED'
    };
  }catch(error){
    preparedChallenges.delete(prepared.challengeId);clearPurgeBlock();
    try{auditAction(req,'DATA_PURGE_WORKER_FAILED',{challengeId:prepared.challengeId,error:error?.message||String(error)});}catch{}
    if(String(error?.message||'').includes('DATABASE_CHANGED_BEFORE_PURGE_WORKER_LOCK'))throw new Error('数据库在清空开始前发生变化，系统已安全停止删除。请重新执行一键清空。');
    throw error;
  }
}
function startJob(req, legacyHandler, kind) {
  pruneJobs();
  const owner = ownerKey(req.user);
  const existing = activeJobFor(owner, kind);
  if (existing) return { job: existing, reused: true };
  const prefix = kind === 'EXECUTE' ? 'PURGE-EXEC' : 'PURGE-PREP';
  const jobId = `${prefix}-${crypto.randomUUID().toUpperCase()}`;
  const now = Date.now();
  const job = {kind,jobId,owner,status:'QUEUED',progress:1,message:kind==='EXECUTE'?'安全清空任务已进入独立执行队列':'清空前安全备份任务已进入后台队列',createdAtMs:now,createdAt:new Date(now).toISOString(),startedAtMs:0,result:null,error:''};
  jobs.set(jobId, job);
  const timer = setTimeout(async () => {
    job.status='RUNNING';job.progress=kind==='EXECUTE'?12:8;
    job.message=kind==='EXECUTE'?'正在启动独立 SQLite 清空进程；网页不会被删除任务堵塞':'正在后台创建 SQLite 在线安全备份；页面可继续响应';
    job.startedAtMs=Date.now();job.startedAt=new Date(job.startedAtMs).toISOString();
    try {
      let result;
      if(kind==='EXECUTE')result=await runIsolatedExecute(req,job);
      else{
        result=await runLegacyHandler(legacyHandler,req);
        if(result?.challengeId){resealPurgeChallenge(result.challengeId,req.user);rememberPreparedChallenge(result,req);}
      }
      job.status='COMPLETED';job.progress=100;job.message=kind==='EXECUTE'?'业务数据已由独立进程安全清空':'清空前备份和完整性校验已完成';
      job.result=result;job.completedAtMs=Date.now();job.completedAt=new Date(job.completedAtMs).toISOString();
    } catch (error) {
      job.status='FAILED';job.progress=100;job.message=kind==='EXECUTE'?'独立清空失败；没有自动重复执行删除':'清空前安全备份失败，未删除任何业务数据';
      job.error=error?.message||String(error);job.completedAtMs=Date.now();job.completedAt=new Date(job.completedAtMs).toISOString();
    }
  },JOB_START_DELAY_MS);
  timer.unref?.();
  return {job,reused:false};
}
function statusHandler(expectedKind) {
  return function v131PurgeStatus(req, res) {
    pruneJobs();
    const job=jobs.get(String(req.params.jobId||''));
    if(!job||job.kind!==expectedKind)return res.status(404).json({ok:false,patchId:PATCH_ID,error:'清空任务不存在或已过期。'});
    if(!job.owner||job.owner!==ownerKey(req.user)||String(req.user?.role||'').toUpperCase()!=='ADMIN')return res.status(403).json({ok:false,patchId:PATCH_ID,error:'无权读取该清空任务。'});
    if(job.status==='RUNNING'){
      const seconds=Math.floor((Date.now()-job.startedAtMs)/1000);const base=expectedKind==='EXECUTE'?18:8;
      job.progress=Math.min(94,Math.max(Number(job.progress||0),base+Math.floor(seconds/(expectedKind==='EXECUTE'?1:2))));
    }
    res.setHeader('Cache-Control','no-store');return res.json(publicJob(job));
  };
}
function activeStatusHandler(req,res){
  if(String(req.user?.role||'').toUpperCase()!=='ADMIN')return res.status(403).json({ok:false,patchId:PATCH_ID,error:'无权读取清空任务。'});
  const kind=String(req.query?.kind||'EXECUTE').toUpperCase()==='PREPARE'?'PREPARE':'EXECUTE';const job=activeJobFor(ownerKey(req.user),kind);
  res.setHeader('Cache-Control','no-store');if(!job)return res.status(404).json({ok:false,patchId:PATCH_ID,error:'当前没有正在运行的清空任务。'});return res.json(publicJob(job));
}
function recoverStatusHandler(req,res){
  if(String(req.user?.role||'').toUpperCase()!=='ADMIN')return res.status(403).json({ok:false,patchId:PATCH_ID,error:'无权恢复清空任务。'});
  const kind=String(req.query?.kind||'EXECUTE').toUpperCase()==='PREPARE'?'PREPARE':'EXECUTE';const owner=ownerKey(req.user);const job=activeJobFor(owner,kind)||recentJobFor(owner,kind);
  res.setHeader('Cache-Control','no-store');if(!job)return res.status(404).json({ok:false,patchId:PATCH_ID,error:'最近没有可恢复的清空任务。'});return res.json(publicJob(job));
}

const originalPost=express.application.post;
const originalGet=express.application.get;
let statusInstalled=false;
function installStatusRoutes(app){
  if(statusInstalled)return;statusInstalled=true;
  originalGet.call(app,PREPARE_STATUS_PATH,statusHandler('PREPARE'));
  originalGet.call(app,EXECUTE_STATUS_PATH,statusHandler('EXECUTE'));
  originalGet.call(app,ACTIVE_STATUS_PATH,activeStatusHandler);
  originalGet.call(app,RECOVER_STATUS_PATH,recoverStatusHandler);
}
express.application.post=function v131AsyncPurgePost(pathValue,...handlers){
  if(![PREPARE_PATH,EXECUTE_PATH].includes(pathValue)||!handlers.length)return originalPost.call(this,pathValue,...handlers);
  const legacyHandler=handlers[handlers.length-1];
  if(typeof legacyHandler!=='function')return originalPost.call(this,pathValue,...handlers);
  installStatusRoutes(this);
  const preserved=handlers.slice(0,-1);const kind=pathValue===EXECUTE_PATH?'EXECUTE':'PREPARE';
  const enqueue=function v131PurgeJobEnqueue(req,res){
    const started=startJob(req,legacyHandler,kind);const job=started.job;
    res.setHeader('Cache-Control','no-store');
    return res.status(202).json({ok:true,patchId:PATCH_ID,async:true,reused:started.reused?'ACTIVE':false,kind,jobId:job.jobId,status:job.status,progress:job.progress,message:started.reused?'相同清空阶段正在执行，已复用当前任务':job.message,pollUrl:pollUrlFor(job)});
  };
  return originalPost.call(this,pathValue,...preserved,enqueue);
};

export function inspectV131PurgeJobs(){
  const active=[...jobs.values()].filter(job=>['QUEUED','RUNNING'].includes(String(job.status||'')));
  return {total:jobs.size,active:active.length,preparedChallenges:preparedChallenges.size,startDelayMs:JOB_START_DELAY_MS,workerTimeoutMs:WORKER_TIMEOUT_MS,workerFile:PURGE_WORKER_FILE,recoveryPath:RECOVER_STATUS_PATH,byKind:{PREPARE:active.filter(job=>job.kind==='PREPARE').length,EXECUTE:active.filter(job=>job.kind==='EXECUTE').length}};
}
export const V105_ASYNC_PURGE_PATCH_ID=PATCH_ID;
