import { getRuntimeConfig } from '../src/db.js';
import { runStorageMaintenance, summarizeStorageFootprint } from '../src/storageMaintenance.js';

const apply=process.argv.includes('--apply');
const cfg=getRuntimeConfig();
const before=summarizeStorageFootprint(cfg);
console.log('[SYSTEM STORAGE CLEANUP] before',JSON.stringify(before));
const result=runStorageMaintenance(cfg,{dryRun:!apply});
console.log('[SYSTEM STORAGE CLEANUP] result',JSON.stringify(result));
if(!apply){
  console.log('[SYSTEM STORAGE CLEANUP] dry-run only; pass --apply after reviewing the inventory. Live DB/WAL/SHM are never deletion targets.');
}else{
  const after=summarizeStorageFootprint(cfg);
  console.log('[SYSTEM STORAGE CLEANUP] after',JSON.stringify(after));
}
