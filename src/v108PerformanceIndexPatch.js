import express from 'express';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PATCH_ID='2026-08-14-v108-deferred-query-index-scheduler-v1';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const workerFile=path.join(__dirname,'v108PerformanceIndexWorker.js');
const delayMs=Math.max(30_000,Number(process.env.V108_INDEX_DELAY_MS||90_000));
let scheduled=false;
let running=false;

function launch(){
  if(running)return;
  running=true;
  const child=spawn(process.execPath,[workerFile],{
    cwd:path.resolve(__dirname,'..'),
    env:process.env,
    windowsHide:true,
    detached:true,
    stdio:'ignore'
  });
  child.unref();
  child.once('exit',()=>{running=false;});
  child.once('error',()=>{running=false;});
}

const previousListen=express.application.listen;
express.application.listen=function v108DeferredIndexListen(...args){
  const server=previousListen.apply(this,args);
  if(!scheduled&&!(process.env.CI||process.env.NODE_ENV==='test')){
    scheduled=true;
    const timer=setTimeout(launch,delayMs);
    timer.unref?.();
  }
  return server;
};

export const V108_PERFORMANCE_INDEX_PATCH_ID=PATCH_ID;
