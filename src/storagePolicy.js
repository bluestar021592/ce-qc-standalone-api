import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const STORAGE_POLICY_ID='system-storage-policy-v1';
export const DEFAULT_DATA_DIR='D:\\CE CCSL金边数据库';

function text(value){return String(value??'').trim();}
function absolute(value,base=process.cwd()){
  const raw=text(value);
  if(!raw)return'';
  return path.isAbsolute(raw)?path.normalize(raw):path.resolve(base,raw);
}
function rootAvailable(target=''){
  try{const resolved=path.resolve(target);const root=path.parse(resolved).root;return !root||fs.existsSync(root);}catch{return false;}
}
function defaultLocalRuntimeRoot(){
  if(process.platform==='win32'){
    const local=text(process.env.LOCALAPPDATA);
    if(local)return path.join(local,'CE_QC_RUNTIME');
    return path.join(text(process.env.SystemDrive)||'C:','CE_QC_RUNTIME');
  }
  return path.join(os.homedir(),'.ce-qc-runtime');
}
function defaultLocalDataRoot(){
  if(process.platform==='win32'){
    const local=text(process.env.LOCALAPPDATA);
    if(local)return path.join(local,'CE_QC_DATA');
    return path.join(text(process.env.SystemDrive)||'C:','CE_QC_DATA');
  }
  return path.join(os.homedir(),'.ce-qc-data');
}
export function diskSpaceFor(target=''){
  try{
    const resolved=path.resolve(target||'.');
    const root=path.parse(resolved).root||resolved;
    const stat=fs.statfsSync(root);
    const block=Number(stat.bsize||stat.frsize||0);
    const total=Math.max(0,Number(stat.blocks||0)*block);
    const free=Math.max(0,Number(stat.bavail??stat.bfree??0)*block);
    return{ok:true,root,totalBytes:total,freeBytes:free,usedBytes:Math.max(0,total-free)};
  }catch(error){return{ok:false,root:'',totalBytes:0,freeBytes:0,usedBytes:0,error:text(error?.message||error)};}
}

export function resolveStorageLayout({env=process.env,baseDir=process.cwd()}={}){
  const explicitData=absolute(env.DATA_DIR,baseDir);
  const preferredData=explicitData||DEFAULT_DATA_DIR;
  const localData=defaultLocalDataRoot();
  const dataRoot=rootAvailable(preferredData)?preferredData:(rootAvailable(localData)?localData:absolute('./data',baseDir));

  const explicitRuntime=absolute(env.CE_QC_RUNTIME_DIR,baseDir);
  const localRuntime=defaultLocalRuntimeRoot();
  const dataRuntime=path.join(dataRoot,'runtime');
  const runtimeRoot=explicitRuntime&&rootAvailable(explicitRuntime)
    ?explicitRuntime
    :(rootAvailable(localRuntime)?localRuntime:dataRuntime);

  const dbFile=absolute(env.DB_FILE,baseDir)||path.join(dataRoot,'ce_qc_monitor.db');
  const exportsDir=absolute(env.EXPORTS_DIR,baseDir)||path.join(runtimeRoot,'exports');
  const importsDir=absolute(env.IMPORTS_DIR,baseDir)||path.join(runtimeRoot,'imports');
  const backupsDir=absolute(env.BACKUPS_DIR,baseDir)||path.join(runtimeRoot,'backups');
  const logsDir=absolute(env.LOGS_DIR,baseDir)||path.join(runtimeRoot,'logs');
  const evidenceArchiveDir=absolute(env.EVIDENCE_ARCHIVE_DIR,baseDir)||path.join(runtimeRoot,'evidence_archive');
  const tempDir=absolute(env.CE_QC_TEMP_DIR,baseDir)||path.join(runtimeRoot,'temp');
  const tokenDir=path.join(dataRoot,'token');
  const legacyEvidenceArchiveDir=path.join(dataRoot,'evidence_archive');
  return{
    id:STORAGE_POLICY_ID,
    dataRoot,runtimeRoot,dbFile,exportsDir,importsDir,backupsDir,logsDir,evidenceArchiveDir,tempDir,tokenDir,
    legacyEvidenceArchiveDir:path.normalize(legacyEvidenceArchiveDir)===path.normalize(evidenceArchiveDir)?'':legacyEvidenceArchiveDir,
    dataDisk:diskSpaceFor(dataRoot),runtimeDisk:diskSpaceFor(runtimeRoot),
    usingDataFallback:path.normalize(dataRoot)!==path.normalize(preferredData),
    databasePlacement:'PERSISTENT_DATA_ROOT',runtimePlacement:path.normalize(runtimeRoot)===path.normalize(dataRuntime)?'DATA_DRIVE_RUNTIME_FALLBACK':'LOCAL_RUNTIME_ROOT'
  };
}

export function applyStoragePolicy(options={}){
  const layout=resolveStorageLayout(options);
  if(!process.env.DATA_DIR)process.env.DATA_DIR=layout.dataRoot;
  if(!process.env.DB_FILE)process.env.DB_FILE=layout.dbFile;
  if(!process.env.CE_QC_RUNTIME_DIR)process.env.CE_QC_RUNTIME_DIR=layout.runtimeRoot;
  if(!process.env.EXPORTS_DIR)process.env.EXPORTS_DIR=layout.exportsDir;
  if(!process.env.IMPORTS_DIR)process.env.IMPORTS_DIR=layout.importsDir;
  if(!process.env.BACKUPS_DIR)process.env.BACKUPS_DIR=layout.backupsDir;
  if(!process.env.LOGS_DIR)process.env.LOGS_DIR=layout.logsDir;
  if(!process.env.EVIDENCE_ARCHIVE_DIR)process.env.EVIDENCE_ARCHIVE_DIR=layout.evidenceArchiveDir;
  if(!process.env.CE_QC_TEMP_DIR)process.env.CE_QC_TEMP_DIR=layout.tempDir;
  if(!process.env.TEMP)process.env.TEMP=layout.tempDir;
  if(!process.env.TMP)process.env.TMP=layout.tempDir;
  return resolveStorageLayout(options);
}

export function ensureStorageLayout(layout=resolveStorageLayout()){
  for(const dir of [layout.dataRoot,layout.runtimeRoot,layout.exportsDir,layout.importsDir,layout.backupsDir,layout.logsDir,layout.evidenceArchiveDir,layout.tempDir,layout.tokenDir]){
    try{fs.mkdirSync(dir,{recursive:true});}catch(error){throw new Error(`无法创建系统存储目录 ${dir}: ${text(error?.message||error)}`);}
  }
  return layout;
}
