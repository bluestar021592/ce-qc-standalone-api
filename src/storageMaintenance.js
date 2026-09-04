import fs from 'node:fs';
import path from 'node:path';

export const STORAGE_MAINTENANCE_ID='system-storage-maintenance-v2';
const GIB=1024*1024*1024;
const MIB=1024*1024;
const HOUR=60*60*1000;
const DAY=24*HOUR;
const DEFAULT_MAX_SCAN_ENTRIES=250000;

function text(value){return String(value??'').trim();}
function stat(file){try{return fs.statSync(file);}catch{return null;}}
function safeJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function gib(bytes){return Number((Number(bytes||0)/GIB).toFixed(2));}
function mib(bytes){return Number((Number(bytes||0)/MIB).toFixed(1));}
function dirBytes(root,maxEntries=DEFAULT_MAX_SCAN_ENTRIES,topN=12){
  const result={path:root||'',bytes:0,files:0,dirs:0,entries:0,truncated:false,largest:[]};
  if(!root||!fs.existsSync(root))return result;
  const stack=[root];
  while(stack.length&&result.entries<maxEntries){
    const dir=stack.pop();let rows=[];try{rows=fs.readdirSync(dir,{withFileTypes:true});}catch{continue;}
    for(const row of rows){
      result.entries+=1;if(result.entries>=maxEntries){result.truncated=true;break;}
      const full=path.join(dir,row.name);if(row.isSymbolicLink())continue;
      if(row.isDirectory()){result.dirs+=1;stack.push(full);continue;}
      if(!row.isFile())continue;const s=stat(full);if(!s)continue;
      const bytes=Number(s.size||0);result.files+=1;result.bytes+=bytes;
      if(bytes>0){result.largest.push({path:full,bytes});result.largest.sort((a,b)=>b.bytes-a.bytes);if(result.largest.length>topN)result.largest.length=topN;}
    }
  }
  return result;
}
function manifestField(manifest,keys=[]){for(const key of keys)if(manifest?.[key]!==undefined&&manifest?.[key]!==null)return manifest[key];return undefined;}
function normalizedQuickCheck(manifest){
  const value=manifestField(manifest,['quickCheck','quick_check','dbQuickCheck','sqliteQuickCheck','integrityCheck','quickCheckResult']);
  if(value===true)return'ok';
  return text(value).toLowerCase();
}
function manifestSha(manifest){return text(manifestField(manifest,['sha256','dbSha256','databaseSha256','backupSha256','fileSha256']));}
function manifestBytes(manifest){const value=Number(manifestField(manifest,['bytes','dbBytes','databaseBytes','backupBytes','fileSize']));return Number.isFinite(value)&&value>0?value:0;}
function verifiedBackupManifest(manifest,dbStat){
  if(!manifest||typeof manifest!=='object'||!dbStat?.isFile?.()||Number(dbStat.size||0)<=0)return{verified:false,reason:'MISSING_DB_OR_MANIFEST'};
  const quick=normalizedQuickCheck(manifest),sha=manifestSha(manifest),declaredBytes=manifestBytes(manifest);
  if(quick!=='ok')return{verified:false,reason:'QUICK_CHECK_NOT_OK',quickCheck:quick||''};
  if(!/^[a-f0-9]{64}$/i.test(sha))return{verified:false,reason:'SHA256_MISSING_OR_INVALID',quickCheck:quick};
  if(declaredBytes&&declaredBytes!==Number(dbStat.size||0))return{verified:false,reason:'SIZE_MISMATCH',quickCheck:quick,sha256:sha,declaredBytes,actualBytes:Number(dbStat.size||0)};
  if(manifest.sourceStable===false||manifest.source_stable===false)return{verified:false,reason:'SOURCE_NOT_STABLE',quickCheck:quick,sha256:sha};
  return{verified:true,reason:'VERIFIED_MANIFEST',quickCheck:quick,sha256:sha,declaredBytes};
}

export function inspectPreUpdateBackups(dataRoot){
  const root=path.join(dataRoot,'backups','pre_update');
  if(!fs.existsSync(root))return{root,entries:[],totalBytes:0,verifiedBytes:0};
  const entries=[];
  for(const row of fs.readdirSync(root,{withFileTypes:true})){
    if(!row.isDirectory())continue;
    const dir=path.join(root,row.name),dbFile=path.join(dir,'ce_qc_monitor.db'),manifestFile=path.join(dir,'manifest.json');
    const dbStat=stat(dbFile),manifest=fs.existsSync(manifestFile)?safeJson(manifestFile):null;
    const verification=verifiedBackupManifest(manifest,dbStat);
    entries.push({name:row.name,dir,dbFile,manifestFile,bytes:Number(dbStat?.size||0),mtimeMs:Number(dbStat?.mtimeMs||stat(dir)?.mtimeMs||0),manifestReadable:Boolean(manifest),...verification});
  }
  entries.sort((a,b)=>b.mtimeMs-a.mtimeMs);
  return{
    root,entries,
    totalBytes:entries.reduce((sum,item)=>sum+item.bytes,0),
    verifiedBytes:entries.filter(item=>item.verified).reduce((sum,item)=>sum+item.bytes,0)
  };
}

export function prunePreUpdateBackups({dataRoot,keep=2,minAgeMs=24*HOUR,dryRun=false}={}){
  const inventory=inspectPreUpdateBackups(dataRoot);
  const verified=inventory.entries.filter(item=>item.verified);
  const keepCount=Math.max(2,Math.floor(Number(keep)||2));
  const protectedDirs=new Set(verified.slice(0,keepCount).map(item=>item.dir));
  const removed=[];let freedBytes=0;
  for(const item of verified.slice(keepCount)){
    if(protectedDirs.has(item.dir))continue;
    if(Date.now()-item.mtimeMs<Math.max(HOUR,Number(minAgeMs)||0))continue;
    if(dryRun){removed.push({...item,dryRun:true});freedBytes+=item.bytes;continue;}
    try{fs.rmSync(item.dir,{recursive:true,force:true});removed.push(item);freedBytes+=item.bytes;}
    catch(error){removed.push({...item,removeError:text(error?.message||error)});}
  }
  const unverified=inventory.entries.filter(item=>!item.verified).map(item=>({name:item.name,dir:item.dir,bytes:item.bytes,reason:item.reason}));
  return{
    ok:true,id:STORAGE_MAINTENANCE_ID,root:inventory.root,keep:keepCount,
    verifiedBackups:verified.length,unverifiedBackups:unverified.length,
    unverifiedProtected:unverified,
    removed:removed.filter(item=>!item.removeError).length,freedBytes,freedGiB:gib(freedBytes),details:removed
  };
}

export function pruneExpiredEvidence({roots=[],retentionDays=400,dryRun=false,maxEntries=DEFAULT_MAX_SCAN_ENTRIES}={}){
  const minimumDays=366;
  const days=Math.max(minimumDays,Math.floor(Number(retentionDays)||400));
  const cutoff=Date.now()-days*DAY;
  let removed=0,freedBytes=0,scanned=0,truncated=false;
  for(const root of [...new Set((roots||[]).map(text).filter(Boolean))]){
    if(!fs.existsSync(root))continue;
    const stack=[root];
    while(stack.length&&scanned<maxEntries){
      const dir=stack.pop();let rows=[];try{rows=fs.readdirSync(dir,{withFileTypes:true});}catch{continue;}
      for(const row of rows){
        scanned+=1;if(scanned>=maxEntries){truncated=true;break;}
        const full=path.join(dir,row.name);if(row.isSymbolicLink())continue;
        if(row.isDirectory()){stack.push(full);continue;}
        if(!row.isFile())continue;const s=stat(full);if(!s||Number(s.mtimeMs||0)>=cutoff)continue;
        const bytes=Number(s.size||0);
        if(!dryRun){try{fs.rmSync(full,{force:true});}catch{continue;}}
        removed+=1;freedBytes+=bytes;
      }
    }
  }
  return{ok:true,id:STORAGE_MAINTENANCE_ID,retentionDays:days,removed,freedBytes,freedGiB:gib(freedBytes),scanned,truncated,dryRun};
}

export function pruneRuntimeTemps({roots=[],maxAgeDays=14,dryRun=false,maxEntries=100000}={}){
  const cutoff=Date.now()-Math.max(2,Number(maxAgeDays)||14)*DAY;let removed=0,freedBytes=0,scanned=0,truncated=false;
  for(const root of [...new Set((roots||[]).map(text).filter(Boolean))]){
    if(!fs.existsSync(root))continue;
    const stack=[root];
    while(stack.length&&scanned<maxEntries){
      const dir=stack.pop();let rows=[];try{rows=fs.readdirSync(dir,{withFileTypes:true});}catch{continue;}
      for(const row of rows){
        scanned+=1;if(scanned>=maxEntries){truncated=true;break;}
        const full=path.join(dir,row.name);if(row.isSymbolicLink())continue;
        if(row.isDirectory()){stack.push(full);continue;}
        if(!row.isFile())continue;const s=stat(full);if(!s||Number(s.mtimeMs||0)>=cutoff)continue;
        const bytes=Number(s.size||0);if(!dryRun){try{fs.rmSync(full,{force:true});}catch{continue;}}removed+=1;freedBytes+=bytes;
      }
    }
  }
  return{ok:true,id:STORAGE_MAINTENANCE_ID,removed,freedBytes,freedGiB:gib(freedBytes),scanned,truncated,dryRun};
}

export function pruneOldLogs({roots=[],maxAgeDays=45,dryRun=false,maxEntries=100000}={}){
  return pruneRuntimeTemps({roots,maxAgeDays:Math.max(14,Number(maxAgeDays)||45),dryRun,maxEntries});
}

export function runStorageMaintenance(cfg,{dryRun=false}={}){
  const preUpdate=prunePreUpdateBackups({dataRoot:cfg.dataDir,keep:Number(process.env.CE_QC_PREUPDATE_BACKUPS_KEEP||2),minAgeMs:Number(process.env.CE_QC_PREUPDATE_MIN_AGE_MS||DAY),dryRun});
  const evidence=pruneExpiredEvidence({roots:[cfg.evidenceArchiveDir,cfg.legacyEvidenceArchiveDir],retentionDays:Number(process.env.CE_QC_EVIDENCE_RETENTION_DAYS||400),dryRun});
  const temp=pruneRuntimeTemps({roots:[cfg.importsDir,cfg.tempDir],maxAgeDays:Number(process.env.CE_QC_RUNTIME_TEMP_MAX_AGE_DAYS||14),dryRun});
  const logs=pruneOldLogs({roots:[cfg.logsDir],maxAgeDays:Number(process.env.CE_QC_LOG_MAX_AGE_DAYS||45),dryRun});
  return{ok:true,id:STORAGE_MAINTENANCE_ID,dryRun,preUpdate,evidence,temp,logs,at:new Date().toISOString(),protected:['PRIMARY_SQLITE','SQLITE_WAL','SQLITE_SHM','UNVERIFIED_BACKUPS','EXPORTS','BUSINESS_TABLES']};
}

export function readStorageHealth(cfg){
  const dbBytes=Number(stat(cfg.dbFile)?.size||0),walBytes=Number(stat(`${cfg.dbFile}-wal`)?.size||0),shmBytes=Number(stat(`${cfg.dbFile}-shm`)?.size||0);
  const dirs={
    runtimeBackups:dirBytes(cfg.backupsDir,50000),
    runtimeImports:dirBytes(cfg.importsDir,50000),
    runtimeEvidenceArchive:dirBytes(cfg.evidenceArchiveDir,200000),
    runtimeExports:dirBytes(cfg.exportsDir,100000),
    runtimeLogs:dirBytes(cfg.logsDir,50000),
    runtimeTemp:dirBytes(cfg.tempDir,50000)
  };
  if(cfg.legacyEvidenceArchiveDir&&path.normalize(cfg.legacyEvidenceArchiveDir)!==path.normalize(cfg.evidenceArchiveDir))dirs.legacyDataDriveEvidenceArchive=dirBytes(cfg.legacyEvidenceArchiveDir,200000);
  const legacyPreUpdate=path.join(cfg.dataDir,'backups','pre_update');
  if(path.normalize(legacyPreUpdate)!==path.normalize(path.join(cfg.backupsDir,'pre_update')))dirs.legacyDataDrivePreUpdateBackups=dirBytes(legacyPreUpdate,10000);
  const directoryBytes=Object.values(dirs).reduce((sum,item)=>sum+Number(item.bytes||0),0);
  return{
    ok:true,id:STORAGE_MAINTENANCE_ID,createdAt:new Date().toISOString(),storagePolicyId:cfg.storagePolicyId||'',
    placement:{dataRoot:cfg.dataDir,runtimeRoot:cfg.runtimeDir,database:cfg.dbFile,evidenceArchive:cfg.evidenceArchiveDir,backups:cfg.backupsDir,exports:cfg.exportsDir,imports:cfg.importsDir,logs:cfg.logsDir,temp:cfg.tempDir},
    database:{path:cfg.dbFile,bytes:dbBytes,GiB:gib(dbBytes),walBytes,walGiB:gib(walBytes),shmBytes,shmMiB:mib(shmBytes)},
    directories:Object.fromEntries(Object.entries(dirs).map(([key,value])=>[key,{...value,GiB:gib(value.bytes),largest:value.largest.map(item=>({path:item.path,name:path.basename(item.path),GiB:gib(item.bytes)}))}])),
    observedTotalBytes:dbBytes+walBytes+shmBytes+directoryBytes,
    observedTotalGiB:gib(dbBytes+walBytes+shmBytes+directoryBytes),
    cleanupPreview:runStorageMaintenance(cfg,{dryRun:true}),
    protected:['PRIMARY_SQLITE','SQLITE_WAL','SQLITE_SHM','UNVERIFIED_BACKUPS','EXPORTS','BUSINESS_TABLES'],
    note:'READ_ONLY_AUDIT_PLUS_DRY_RUN_CLEANUP_PREVIEW; no database, WAL/SHM, export or unverified backup is deleted by the health report'
  };
}

export function summarizeStorageFootprint(cfg){return readStorageHealth(cfg);}
