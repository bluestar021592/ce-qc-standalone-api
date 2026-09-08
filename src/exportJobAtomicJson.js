import fs from 'node:fs';
import fsp from 'node:fs/promises';

export const EXPORT_JOB_ATOMIC_JSON_ID='2026-09-08-v478-windows-retry-safe-export-job-json-v1';
const RETRYABLE=new Set(['EPERM','EBUSY','EACCES']);
const DELAYS=[10,25,50,100,200,400,800,1200];
const waiter=new Int32Array(new SharedArrayBuffer(4));
const retryable=error=>RETRYABLE.has(String(error?.code||'').toUpperCase());
const uniqueTemp=file=>`${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
const cleanupSync=file=>{try{fs.rmSync(file,{force:true});}catch{}};
const cleanup=async file=>{try{await fsp.rm(file,{force:true});}catch{}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function writeJsonAtomicSync(file,value){
  const temp=uniqueTemp(file),body=JSON.stringify(value,null,2);
  fs.writeFileSync(temp,body,'utf8');
  let lastError=null;
  try{
    for(let attempt=0;attempt<=DELAYS.length;attempt+=1){
      try{fs.renameSync(temp,file);return {ok:true,attempts:attempt+1};}
      catch(error){
        lastError=error;
        if(!retryable(error)||attempt>=DELAYS.length)throw error;
        Atomics.wait(waiter,0,0,DELAYS[attempt]);
      }
    }
  }finally{cleanupSync(temp);}
  throw lastError||new Error('EXPORT_JOB_ATOMIC_WRITE_FAILED');
}

export async function writeJsonAtomic(file,value){
  const temp=uniqueTemp(file),body=JSON.stringify(value,null,2);
  await fsp.writeFile(temp,body,'utf8');
  let lastError=null;
  try{
    for(let attempt=0;attempt<=DELAYS.length;attempt+=1){
      try{await fsp.rename(temp,file);return {ok:true,attempts:attempt+1};}
      catch(error){
        lastError=error;
        if(!retryable(error)||attempt>=DELAYS.length)throw error;
        await sleep(DELAYS[attempt]);
      }
    }
  }finally{await cleanup(temp);}
  throw lastError||new Error('EXPORT_JOB_ATOMIC_WRITE_FAILED');
}

console.info('[CE-QC][EXPORT_JOB_ATOMIC_JSON]',EXPORT_JOB_ATOMIC_JSON_ID,'Windows EPERM/EBUSY/EACCES rename collisions get bounded retry; no direct overwrite/delete fallback and no business-data mutation.');
