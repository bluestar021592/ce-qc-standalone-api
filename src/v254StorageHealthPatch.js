import fs from 'node:fs';
import path from 'node:path';
import { getRuntimeConfig } from './db.js';
import { readStorageHealth, STORAGE_MAINTENANCE_ID } from './storageMaintenance.js';

export const V254_STORAGE_HEALTH_ID='2026-08-23-v254-storage-health-readonly-v1';

// Compatibility shim only. Detailed C/D sizing, largest-file detection and safe
// cleanup preview are owned by the unversioned storageMaintenance core.
function buildReport(){
  const report=readStorageHealth(getRuntimeConfig());
  return{...report,legacyId:V254_STORAGE_HEALTH_ID,coreStorageMaintenanceId:STORAGE_MAINTENANCE_ID};
}

if(String(process.env.CE_QC_DISABLE_STARTUP_STORAGE_SCAN||'')!=='1'){
  const timer=setTimeout(()=>{
    try{
      const report=buildReport();
      console.log('[CE-QC][STORAGE_HEALTH]',JSON.stringify(report));
      try{
        const cfg=getRuntimeConfig();
        fs.mkdirSync(cfg.logsDir,{recursive:true});
        fs.writeFileSync(path.join(cfg.logsDir,'storage_health_latest.json'),JSON.stringify(report,null,2));
      }catch{}
    }catch(error){console.warn('[CE-QC][STORAGE_HEALTH] scan failed:',error?.message||error);}
  },15000);
  timer.unref?.();
}else console.log('[CE-QC][RECOVERY_SAFE_MODE] automatic full-directory size scan skipped; readV254StorageHealth remains available on demand.');

export function readV254StorageHealth(){return buildReport();}
