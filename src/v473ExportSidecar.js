import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { accessIdentity, requireRole } from './accessControl.js';
import { closeDb, getRuntimeConfig } from './db.js';

const VERSION='2026-09-08-v473-all-business-isolated-export-sidecar-v1';
const PORT=Math.max(1024,Math.min(65535,Number(process.env.CE_QC_EXPORT_SIDECAR_PORT||5178)));
const HOST=String(process.env.CE_QC_EXPORT_SIDECAR_HOST||'0.0.0.0');
const SINGLE_JOB_HEAP_MB=Math.max(384,Math.min(1024,Number(process.env.EXPORT_SINGLE_JOB_HEAP_MB||768)));
const ALL_JOB_HEAP_MB=Math.max(256,Math.min(1024,Number(process.env.EXPORT_JOB_HEAP_MB||512)));
const EXPORT_CONTRACT_VERSION='ONE_WORKBOOK_PER_BUSINESS_V473_ISOLATED_TRANSPORT';
const TYPES=new Set(['ALL','CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const singleWorkerFile=path.join(__dirname,'v183SingleBusinessExportJobWorker.js');
const allWorkerFile=path.join(__dirname,'v473AllBusinessExportWorker.js');
const pendingJobs=new Map();
const app=express();

function sha256(value){return crypto.createHash('sha256').update(String(value||'')).digest('hex');}
function safeJobId(value){const id=String(value||'').trim();return /^EXP-[A-Z0-9-]{10,80}$/i.test(id)?id:'';}
function dateKey(value=''){const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
function normalizePayload(body={}){
  const periodType=['daily','weekly','monthly','custom'].includes(String(body.periodType||''))?String(body.periodType):'daily';
  const businessType=String(body.businessType||'ALL').trim().toUpperCase()||'ALL';
  return {periodType,date:dateKey(body.date),fromDate:dateKey(body.fromDate),toDate:dateKey(body.toDate),businessType};
}
function validatePayload(payload,res){
  if(!TYPES.has(payload.businessType)){res.status(400).json({ok:false,code:'V473_INVALID_BUSINESS',error:'不支持的导出业务。'});return false;}
  if(payload.periodType==='custom'){
    if(!payload.fromDate||!payload.toDate||payload.fromDate>payload.toDate){res.status(400).json({ok:false,code:'V473_INVALID_RANGE',error:'请选择有效的开始日期和结束日期。'});return false;}
    const days=Math.floor((Date.parse(`${payload.toDate}T00:00:00Z`)-Date.parse(`${payload.fromDate}T00:00:00Z`))/86400000)+1;
    if(days>180){res.status(400).json({ok:false,code:'V473_RANGE_TOO_LARGE',error:'单次日期范围最多180天。'});return false;}
  }else if(!payload.date){res.status(400).json({ok:false,code:'V473_INVALID_DATE',error:'请选择有效的基准日期。'});return false;}
  return true;
}
function payloadKey(payload){return sha256(JSON.stringify({...payload,exportContractVersion:EXPORT_CONTRACT_VERSION}));}
function jobsDir(){return path.join(getRuntimeConfig().dataDir,'export_jobs');}
function jobPath(jobId){const safe=safeJobId(jobId);return safe?path.join(jobsDir(),`${safe}.json`):'';}
async function writeJsonAtomic(file,value){const temp=`${file}.${process.pid}.v473.tmp`;await fsp.writeFile(temp,JSON.stringify(value,null,2),'utf8');await fsp.rename(temp,file);}
async function readJob(file){try{return JSON.parse(await fsp.readFile(file,'utf8'));}catch{return null;}}
function tokenMatches(job,token){const expected=String(job?.pollTokenHash||'');const actual=sha256(token);if(!expected||expected.length!==actual.length)return false;try{return crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(actual,'hex'));}catch{return false;}}
function stripPrivate(job={}){const {pollTokenHash,...safe}=job||{};return {...safe,files:Array.isArray(safe.files)?safe.files:[],sidecarVersion:VERSION};}
function base(req){return `${req.protocol}://${req.get('host')}`;}
function decorateFiles(req,job,token){return (Array.isArray(job?.files)?job.files:[]).map(item=>{const name=path.basename(String(item?.name||''));if(!name)return item;const q=new URLSearchParams({jobId:String(job.jobId||''),token:String(token||''),name});return {...item,name,url:`${base(req)}/api/v473/export-file?${q.toString()}`};});}
function publicJob(req,job,token){const safe=stripPrivate(job);return {...safe,files:decorateFiles(req,safe,token),statusTransport:'ASYNC_JOB_FILE_V473'};}
function setMemory(jobId,job,file=''){if(!jobId||!job)return;const current=pendingJobs.get(jobId)||{};pendingJobs.set(jobId,{...current,job,file:file||current.file||jobPath(jobId)});}
async function loadJob(jobId){
  const pending=pendingJobs.get(jobId);
  const file=pending?.file||jobPath(jobId);
  const disk=file?await readJob(file):null;
  if(disk){setMemory(jobId,disk,file);return {job:disk,file,source:'JOB_FILE'};}
  if(pending?.job)return {job:pending.job,file,source:'MEMORY_ACK'};
  return {job:null,file,source:'NONE'};
}
async function markFailure(file,jobId,error,code='V473_EXPORT_WORKER_FAILED'){
  const loaded=await loadJob(jobId);const current=loaded.job;if(!current||!['QUEUED','RUNNING'].includes(String(current.status||'').toUpperCase()))return;
  const now=new Date().toISOString();const failed={...current,status:'FAILED',errorCode:code,message:error?.message||String(error),error:error?.stack||String(error),failedAt:now,updatedAt:now,sidecarVersion:VERSION};
  setMemory(jobId,failed,file);try{if(file)await writeJsonAtomic(file,failed);}catch{}
}
function launchWorker(file,job){
  const all=String(job?.payload?.businessType||'ALL').toUpperCase()==='ALL';
  const workerFile=all?allWorkerFile:singleWorkerFile;
  const heapMb=all?ALL_JOB_HEAP_MB:SINGLE_JOB_HEAP_MB;
  let child;
  try{
    child=spawn(process.execPath,[`--max-old-space-size=${heapMb}`,workerFile,file],{cwd:getRuntimeConfig().projectRoot,env:{...process.env,CE_QC_EXPORT_WORKER_MODE:all?'V473_ISOLATED_ALL_BUSINESS':'V473_ISOLATED_SINGLE_BUSINESS',CE_QC_EXPORT_PREPARE_ACK_VERSION:VERSION},detached:false,windowsHide:true,stdio:'ignore'});
  }catch(error){void markFailure(file,job.jobId,error,'V473_EXPORT_WORKER_SPAWN_FAILED');return;}
  child.once('error',error=>{void markFailure(file,job.jobId,error,'V473_EXPORT_WORKER_SPAWN_FAILED');});
  child.once('exit',(code,signal)=>{void(async()=>{const loaded=await loadJob(job.jobId);if(loaded.job&&!['QUEUED','RUNNING'].includes(String(loaded.job.status||'').toUpperCase()))return;const reason=new Error(code===0?'V473后台报表进程已结束，但任务没有写入完成状态。':`V473后台报表进程异常退出（code=${code??'null'}${signal?`, signal=${signal}`:''}）。`);await markFailure(file,job.jobId,reason,'V473_EXPORT_WORKER_EXITED_EARLY');})();});
  child.unref?.();
}
async function persistAndLaunch(job){
  let file='';
  try{const dir=jobsDir();await fsp.mkdir(dir,{recursive:true});file=jobPath(job.jobId);const persisted={...job,persistedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),message:job.payload.businessType==='ALL'?'V473独立5178已接单；先在独立worker核对历史安全，再生成7业务完整报表':'V473独立5178已接单；正在生成单业务完整报表'};await writeJsonAtomic(file,persisted);setMemory(job.jobId,persisted,file);launchWorker(file,persisted);}catch(error){await markFailure(file,job.jobId,error,'V473_EXPORT_JOB_PERSIST_FAILED');}
}
function originAllowed(req){const raw=String(req.get('origin')||'').trim();if(!raw)return {ok:true,origin:''};try{const origin=new URL(raw);const requestHost=String(req.hostname||'').toLowerCase();const sameHost=origin.hostname.toLowerCase()===requestHost;const appPort=origin.port==='5177'||(!origin.port&&origin.protocol==='https:');return {ok:sameHost&&appPort,origin:raw};}catch{return {ok:false,origin:raw};}}

app.disable('x-powered-by');app.set('trust proxy',1);
app.use((req,res,next)=>{const allowed=originAllowed(req);if(!allowed.ok)return res.status(403).json({ok:false,code:'V473_ORIGIN_DENIED',error:'V473独立导出通道拒绝跨主机请求。'});if(allowed.origin){res.setHeader('Access-Control-Allow-Origin',allowed.origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');}res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Cache-Control','no-store');if(req.method==='OPTIONS')return res.sendStatus(204);next();});
app.use(express.json({limit:'1mb'}));
app.get('/api/v473/export-ping',(req,res)=>res.json({ok:true,version:VERSION,port:PORT,pendingJobs:pendingJobs.size,businessTypes:[...TYPES],statusTransport:'ASYNC_JOB_FILE_V473',allWorker:'V473_PREFLIGHT_THEN_V84'}));
app.post('/api/v473/export-period/prepare',accessIdentity,requireRole('OPERATOR'),(req,res)=>{
  const startedAt=Date.now();const payload=normalizePayload(req.body||{});if(!validatePayload(payload,res))return;
  const jobId=`EXP-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomUUID().slice(0,12).toUpperCase()}`;const pollToken=crypto.randomBytes(32).toString('base64url');const now=new Date().toISOString();const all=payload.businessType==='ALL';
  const job={version:VERSION,sidecarVersion:VERSION,exportContractVersion:EXPORT_CONTRACT_VERSION,jobId,payloadKey:payloadKey(payload),pollTokenHash:sha256(pollToken),pollAuth:'TOKEN_V473_NO_STATUS_SQLITE',statusTransport:'ASYNC_JOB_FILE_V473',status:'QUEUED',progress:0,message:all?'V473独立七业务Job已创建；历史安全检查将在独立worker中先执行':'V473独立单业务Job已创建',payload,files:[],createdAt:now,updatedAt:now,requestedBy:req.user?.username||req.user?.email||'',launcherHeapMB:all?ALL_JOB_HEAP_MB:SINGLE_JOB_HEAP_MB,workerMode:all?'V473_ISOLATED_ALL_BUSINESS':'V473_ISOLATED_SINGLE_BUSINESS'};
  setMemory(jobId,job,'');const ackMs=Date.now()-startedAt;const q=new URLSearchParams({token:pollToken});res.status(202).json({ok:true,async:true,jobId,status:'QUEUED',progress:0,message:job.message,pollUrl:`/api/v473/export-job/${encodeURIComponent(jobId)}?${q.toString()}`,sidecarVersion:VERSION,prepareAckMs:ackMs,workerMode:job.workerMode,pollAuth:job.pollAuth,statusTransport:job.statusTransport});setImmediate(()=>{void persistAndLaunch(job);});
});
app.get('/api/v473/export-job/:jobId',async(req,res)=>{const jobId=safeJobId(req.params?.jobId);const token=String(req.query?.token||'').trim();if(!jobId)return res.status(404).json({ok:false,code:'V473_JOB_NOT_FOUND',error:'导出任务不存在或已过期。'});const loaded=await loadJob(jobId);if(!loaded.job)return res.status(404).json({ok:false,code:'V473_JOB_NOT_FOUND',error:'导出任务不存在或已过期。'});if(!tokenMatches(loaded.job,token))return res.status(403).json({ok:false,code:'V473_JOB_TOKEN_DENIED',error:'导出任务状态令牌无效。'});res.setHeader('X-CE-QC-Export-Status-Source',loaded.source);return res.json({ok:true,...publicJob(req,loaded.job,token)});});
app.get('/api/v473/export-file',async(req,res)=>{const jobId=safeJobId(req.query?.jobId);const token=String(req.query?.token||'').trim();const name=path.basename(String(req.query?.name||''));if(!jobId||!name)return res.status(400).json({ok:false,code:'V473_FILE_REQUEST_INVALID',error:'下载参数无效。'});const loaded=await loadJob(jobId);if(!loaded.job||!tokenMatches(loaded.job,token))return res.status(403).json({ok:false,code:'V473_JOB_TOKEN_DENIED',error:'导出文件令牌无效。'});const allowed=new Set((Array.isArray(loaded.job.files)?loaded.job.files:[]).map(item=>path.basename(String(item?.name||''))).filter(Boolean));if(!allowed.has(name))return res.status(404).json({ok:false,code:'V473_EXPORT_FILE_NOT_FOUND',error:'导出文件不存在或不属于该任务。'});const file=path.join(getRuntimeConfig().exportsDir,name);try{const stat=await fsp.stat(file);if(!stat.isFile())throw new Error('not-file');}catch{return res.status(404).json({ok:false,code:'V473_EXPORT_FILE_NOT_FOUND',error:'导出文件不存在。'});}res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(name)}`);res.sendFile(file);});

const server=app.listen(PORT,HOST,()=>console.log(`[CE-QC][V473_EXPORT_SIDECAR] READY http://${HOST}:${PORT} · ${VERSION} · ALL+single business isolated from 5177`));
server.on('error',error=>{console.error('[CE-QC][V473_EXPORT_SIDECAR] START FAILED:',error?.stack||error);process.exitCode=1;});
function shutdown(){try{server.close();}catch{}try{closeDb();}catch{}}
process.once('SIGINT',()=>{shutdown();process.exit(0);});process.once('SIGTERM',()=>{shutdown();process.exit(0);});process.once('exit',shutdown);
