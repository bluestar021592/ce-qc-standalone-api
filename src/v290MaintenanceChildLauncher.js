import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { V290_INTERACTIVE_STARTUP_GRACE_ID,v290AutoTaskDelay } from './v290InteractiveStartupGrace.js';

export const V290_MAINTENANCE_CHILD_LAUNCHER_ID='2026-08-24-v290-maintenance-child-launcher-v1';
const workerFile=fileURLToPath(new URL('./v290MaintenanceWorker.js',import.meta.url));
const CHILD_FLAG='CE_QC_V290_MAINTENANCE_CHILD';

export function scheduleV290MaintenanceChild(task,{targetAfterBootMs=300_000,reason='AUTO'}={}){
  if(process.env.NODE_ENV==='test'||process.env.CI||String(process.env[CHILD_FLAG]||'')==='1')return null;
  const delayMs=v290AutoTaskDelay(targetAfterBootMs);
  const timer=setTimeout(()=>spawnV290MaintenanceChild(task,{reason}),delayMs);
  timer.unref?.();
  console.info('[CE-QC][V290_MAINTENANCE_SCHEDULE]',JSON.stringify({task,reason,delayMs,targetAfterBootMs,graceId:V290_INTERACTIVE_STARTUP_GRACE_ID}));
  return timer;
}

export function spawnV290MaintenanceChild(task,{reason='AUTO'}={}){
  const child=spawn(process.execPath,[workerFile,String(task||''),String(reason||'AUTO')],{
    cwd:process.cwd(),
    windowsHide:true,
    detached:false,
    env:{
      ...process.env,
      [CHILD_FLAG]:'1',
      SQLITE_CACHE_KIB:'8192',
      SQLITE_MMAP_BYTES:'0',
      SQLITE_TEMP_STORE:'FILE'
    },
    stdio:['ignore','inherit','inherit']
  });
  child.once('error',error=>console.warn('[CE-QC][V290_MAINTENANCE_CHILD_FAILED]',JSON.stringify({task,reason,error:error?.message||String(error)})));
  child.once('exit',(code,signal)=>console.info('[CE-QC][V290_MAINTENANCE_CHILD_EXIT]',JSON.stringify({task,reason,code,signal:signal||''})));
  console.info('[CE-QC][V290_MAINTENANCE_CHILD_START]',JSON.stringify({task,reason,pid:child.pid||0,launcherId:V290_MAINTENANCE_CHILD_LAUNCHER_ID}));
  return child;
}
