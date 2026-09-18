import fs from 'fs';
import path from 'path';
import { getRuntimeConfig } from './db.js';

export const V254_STORAGE_HEALTH_ID='2026-08-23-v254-storage-health-readonly-v1';

const MAX_ENTRIES=200000;
const TOP_N=12;

function fileSize(file){
  try{return Number(fs.statSync(file).size||0);}catch{return 0;}
}
function scanDir(root){
  const result={path:root,bytes:0,files:0,dirs:0,entries:0,truncated:false,largest:[]};
  if(!root||!fs.existsSync(root))return result;
  const stack=[root];
  while(stack.length&&result.entries<MAX_ENTRIES){
    const dir=stack.pop();
    let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{continue;}
    for(const entry of entries){
      result.entries+=1;
      if(result.entries>=MAX_ENTRIES){result.truncated=true;break;}
      const full=path.join(dir,entry.name);
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory()){result.dirs+=1;stack.push(full);continue;}
      if(!entry.isFile())continue;
      const bytes=fileSize(full);result.bytes+=bytes;result.files+=1;
      if(bytes>0){
        result.largest.push({path:full,bytes});
        result.largest.sort((a,b)=>b.bytes-a.bytes);
        if(result.largest.length>TOP_N)result.largest.length=TOP_N;
      }
    }
  }
  return result;
}
function mib(bytes){return Number((Number(bytes||0)/1024/1024).toFixed(1));}
function gib(bytes){return Number((Number(bytes||0)/1024/1024/1024).toFixed(2));}
function compactDir(scan){return{bytes:scan.bytes,GiB:gib(scan.bytes),files:scan.files,dirs:scan.dirs,truncated:scan.truncated,largest:scan.largest.map(item=>({name:path.basename(item.path),GiB:gib(item.bytes),path:item.path}))};}

function buildReport(){
  const cfg=getRuntimeConfig();
  const dbBytes=fileSize(cfg.dbFile),walBytes=fileSize(`${cfg.dbFile}-wal`),shmBytes=fileSize(`${cfg.dbFile}-shm`);
  const dirs={
    backups:scanDir(cfg.backupsDir),
    imports:scanDir(cfg.importsDir),
    evidenceArchive:scanDir(path.join(cfg.dataDir,'evidence_archive')),
    exports:scanDir(cfg.exportsDir),
    logs:scanDir(cfg.logsDir)
  };
  const directoryBytes=Object.values(dirs).reduce((sum,item)=>sum+Number(item.bytes||0),0);
  return{
    ok:true,id:V254_STORAGE_HEALTH_ID,createdAt:new Date().toISOString(),dataDir:cfg.dataDir,
    database:{path:cfg.dbFile,bytes:dbBytes,GiB:gib(dbBytes),walBytes,walGiB:gib(walBytes),shmBytes,shmMiB:mib(shmBytes)},
    directories:Object.fromEntries(Object.entries(dirs).map(([key,value])=>[key,compactDir(value)])),
    observedTotalBytes:dbBytes+walBytes+shmBytes+directoryBytes,
    observedTotalGiB:gib(dbBytes+walBytes+shmBytes+directoryBytes),
    note:'READ_ONLY_SIZE_SCAN_NO_DELETE_NO_VACUUM_NO_CHECKPOINT; V266 evidenceArchive included separately'
  };
}

if(String(process.env.CE_QC_ENABLE_STARTUP_STORAGE_SCAN||'')==='1'&&String(process.env.CE_QC_DISABLE_STARTUP_STORAGE_SCAN||'')!=='1'){
  const timer=setTimeout(()=>{
    try{
      const report=buildReport();
      console.log('[CE-QC][V254_STORAGE]',JSON.stringify(report));
      try{fs.mkdirSync(getRuntimeConfig().logsDir,{recursive:true});fs.writeFileSync(path.join(getRuntimeConfig().logsDir,'storage_health_latest.json'),JSON.stringify(report,null,2));}catch{}
    }catch(error){console.warn('[CE-QC][V254_STORAGE] scan failed:',error?.message||error);}
  },15000);
  timer.unref?.();
}else{
  console.log('[CE-QC][V254_STARTUP_STORAGE_SCAN_DISABLED] recursive storage scan is on-demand by default; set CE_QC_ENABLE_STARTUP_STORAGE_SCAN=1 only for explicit maintenance.');
}

export function readV254StorageHealth(){return buildReport();}
