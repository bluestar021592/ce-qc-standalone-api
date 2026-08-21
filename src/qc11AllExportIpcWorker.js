import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const workerFile=path.join(__dirname,'v84ExportJobWorker.js');
const jobFile=path.resolve(String(process.argv[2]||''));
const HEAP_MB=Math.max(256,Math.min(1024,Number(process.env.EXPORT_JOB_HEAP_MB||512)));

if(!jobFile||!fs.existsSync(jobFile))process.exit(2);

let last='';
function readJob(){try{return JSON.parse(fs.readFileSync(jobFile,'utf8'));}catch{return null;}}
function push(force=false){
  const job=readJob();
  if(!job)return;
  const signature=JSON.stringify([job.status,job.progress,job.currentBusiness,job.message,job.updatedAt,Array.isArray(job.files)?job.files.length:0]);
  if(!force&&signature===last)return;
  last=signature;
  try{process.send?.({type:'CE_QC_EXPORT_JOB_UPDATE',job});}catch{}
}
function killTree(child){
  if(!child||!child.pid)return;
  try{child.kill('SIGTERM');}catch{}
  if(process.platform==='win32'){
    try{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.unref?.();}catch{}
  }
}

const child=spawn(process.execPath,[`--max-old-space-size=${HEAP_MB}`,workerFile,jobFile],{
  cwd:process.cwd(),
  env:{...process.env,CE_QC_EXPORT_WORKER_MODE:'ALL_BUSINESS_ORCHESTRATOR',CE_QC_EXPORT_STATUS_TRANSPORT:'IPC_MEMORY_V195'},
  windowsHide:true,
  stdio:'ignore'
});
const timer=setInterval(()=>push(false),750);timer.unref?.();
push(true);
child.once('error',error=>{
  clearInterval(timer);
  try{process.send?.({type:'CE_QC_EXPORT_JOB_UPDATE',job:{...(readJob()||{}),status:'FAILED',errorCode:'QC11_ALL_EXPORT_WRAPPER_FAILED',message:error?.message||String(error),updatedAt:new Date().toISOString()}});}catch{}
  process.exitCode=1;
});
child.once('close',code=>{
  clearInterval(timer);push(true);process.exitCode=Number(code||0);
});
process.once('SIGTERM',()=>{clearInterval(timer);killTree(child);});
process.once('SIGINT',()=>{clearInterval(timer);killTree(child);});
