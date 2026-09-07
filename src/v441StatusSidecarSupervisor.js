import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const V441_STATUS_SIDECAR_SUPERVISOR_ID='2026-09-07-v441-status-sidecar-supervisor-v1';
const PORT=Math.max(1024,Math.min(65535,Number(process.env.CE_QC_STATUS_SIDECAR_PORT||5180)));
let child=null;
let stopping=false;
let restartTimer=null;

function eligible(){
  if(String(process.env.CE_QC_STATUS_SIDECAR_CHILD||'')==='1')return false;
  if(String(process.env.CE_QC_EXPORT_SIDECAR_CHILD||'')==='1')return false;
  if(String(process.env.CE_QC_LOCAL_AUTH_CHILD||'')==='1')return false;
  if(String(process.env.NODE_ENV||'').toLowerCase()==='test')return false;
  return true;
}
function start(){
  if(!eligible()||stopping||child)return;
  const file=fileURLToPath(new URL('./localStatusSidecar.js',import.meta.url));
  try{
    child=spawn(process.execPath,[file],{
      cwd:process.cwd(),
      env:{...process.env,CE_QC_STATUS_SIDECAR_CHILD:'1',CE_QC_STATUS_SIDECAR_PORT:String(PORT)},
      windowsHide:true,detached:false,stdio:['ignore','inherit','inherit']
    });
    console.log(`[CE-QC][V441_STATUS_SUPERVISOR] starting pid=${child.pid||'-'} port=${PORT}`);
    child.once('error',error=>console.error('[CE-QC][V441_STATUS_SUPERVISOR] spawn failed:',error?.stack||error));
    child.once('exit',(code,signal)=>{
      console.log(`[CE-QC][V441_STATUS_SUPERVISOR] exited code=${code??'null'}${signal?` signal=${signal}`:''}`);
      child=null;
      if(!stopping){clearTimeout(restartTimer);restartTimer=setTimeout(start,1000);restartTimer.unref?.();}
    });
  }catch(error){child=null;console.error('[CE-QC][V441_STATUS_SUPERVISOR] start failed:',error?.stack||error);}
}
function stop(){
  stopping=true;clearTimeout(restartTimer);
  try{child?.kill();}catch{}
  child=null;
}
process.once('exit',stop);
start();

export function inspectV441StatusSupervisor(){return{eligible:eligible(),running:Boolean(child),pid:child?.pid||0,port:PORT,id:V441_STATUS_SIDECAR_SUPERVISOR_ID};}
