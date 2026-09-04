import fs from 'node:fs';
import path from 'node:path';

export const STORAGE_MAINTENANCE_ID='system-storage-maintenance-v1';
const GIB=1024*1024*1024;
const HOUR=60*60*1000;
const DAY=24*HOUR;

function text(value){return String(value??'').trim();}
function stat(file){try{return fs.statSync(file);}catch{return null;}}
function safeJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function dirBytes(root,maxEntries=250000){
  if(!root||!fs.existsSync(root))return{bytes:0,files:0,entries:0,truncated:false};
  const stack=[root];let bytes=0,files=0,entries=0,truncated=false;
  while(stack.length&&entries<maxEntries){
    const dir=stack.pop();let rows=[];try{rows=fs.readdirSync(dir,{withFileTypes:true});}catch{continue;}
    for(const row of rows){
      entries+=1;if(entries>=maxEntries){truncated=true;break;}
      const full=path.join(dir,row.name);if(row.isSymbolicLink())continue;
      if(row.isDirectory()){stack.push(full);continue;}
      if(!row.isFile())continue;const s=stat(full);if(!s)continue;files+=1;bytes+=Number(s.size||0);
    }
  }
  return{bytes,files,entries,truncated};
}

export function inspectPreUpdateBackups(dataRoot){
  const root=path.join(dataRoot,'backups','pre_update');
  if(!fs.existsSync(root))return{root,entries:[],totalBytes:0};
  const entries=[];
  for(const row of fs.readdirSync(root,{withFileTypes:true})){
    if(!row.isDirectory())continue;
    const dir=path.join(root,row.name),dbFile=path.join(dir,'ce_qc_monitor.db'),manifestFile=path.join(dir,'manifest.json');
    const dbStat=stat(dbFile),manifest=fs.existsSync(manifestFile)?safeJson(manifestFile):null;
    const complete=Boolean(dbStat&&dbStat.isFile()&&Number(dbStat.size||0)>0&&manifest&&typeof manifest==='object');
    entries.push({name:row.name,dir,dbFile,manifestFile,bytes:Number(dbStat?.size||0),mtimeMs:Number(dbStat?.mtimeMs||stat(dir)?.mtimeMs||0),complete,manifestReadable:Boolean(manifest)});
  }
  entries.sort((a,b)=>b.mtimeMs-a.mtimeMs);
  return{root,entries,totalBytes:entries.reduce((sum,item)=>sum+item.bytes,0)};
}

export function prunePreUpdateBackups({dataRoot,keep=2,minAgeMs=24*HOUR,dryRun=false}={}){
  const inventory=inspectPreUpdateBackups(dataRoot);
  const complete=inventory.entries.filter(item=>item.complete);
  // Keep two full generations by default. This mirrors the updater safety policy:
  // one rollback point for the current candidate and one prior known-good generation.
  const keepCount=Math.max(2,Math.floor(Number(keep)||2));
  const protectedDirs=new Set(complete.slice(0,keepCount).map(item=>item.dir));
  const removed=[];let freedBytes=0;
  for(const item of complete.slice(keepCount)){
    if(protectedDirs.has(item.dir))continue;
    if(Date.now()-item.mtimeMs<Math.max(HOUR,Number(minAgeMs)||0))continue;
    if(dryRun){removed.push({...item,dryRun:true});freedBytes+=item.bytes;continue;}
    try{fs.rmSync(item.dir,{recursive:true,force:true});removed.push(item);freedBytes+=item.bytes;}
    catch(error){removed.push({...item,removeError:text(error?.message||error)});}
  }
  return{ok:true,id:STORAGE_MAINTENANCE_ID,root:inventory.root,keep:keepCount,completeBackups:complete.length,removed:removed.filter(item=>!item.removeError).length,freedBytes,freedGiB:Number((freedBytes/GIB).toFixed(2)),details:removed};
}

export function pruneExpiredEvidence({roots=[],retentionDays=400,dryRun=false,maxEntries=250000}={}){
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
  return{ok:true,id:STORAGE_MAINTENANCE_ID,retentionDays:days,removed,freedBytes,freedGiB:Number((freedBytes/GIB).toFixed(2)),scanned,truncated,dryRun};
}

export function pruneRuntimeTemps({roots=[],maxAgeDays=14,dryRun=false,maxEntries=100000}={}){
  const cutoff=Date.now()-Math.max(2,Number(maxAgeDays)||14)*DAY;let removed=0,freedBytes=0,scanned=0;
  for(const root of [...new Set((roots||[]).map(text).filter(Boolean))]){
    if(!fs.existsSync(root))continue;
    for(const row of fs.readdirSync(root,{withFileTypes:true})){
      scanned+=1;if(scanned>maxEntries)break;if(!row.isFile())continue;
      const full=path.join(root,row.name),s=stat(full);if(!s||Number(s.mtimeMs||0)>=cutoff)continue;
      const bytes=Number(s.size||0);if(!dryRun){try{fs.rmSync(full,{force:true});}catch{continue;}}removed+=1;freedBytes+=bytes;
    }
  }
  return{ok:true,id:STORAGE_MAINTENANCE_ID,removed,freedBytes,freedGiB:Number((freedBytes/GIB).toFixed(2)),scanned,dryRun};
}

export function runStorageMaintenance(cfg,{dryRun=false}={}){
  const preUpdate=prunePreUpdateBackups({dataRoot:cfg.dataDir,keep:Number(process.env.CE_QC_PREUPDATE_BACKUPS_KEEP||2),minAgeMs:Number(process.env.CE_QC_PREUPDATE_MIN_AGE_MS||DAY),dryRun});
  const evidence=pruneExpiredEvidence({roots:[cfg.evidenceArchiveDir,cfg.legacyEvidenceArchiveDir],retentionDays:Number(process.env.CE_QC_EVIDENCE_RETENTION_DAYS||400),dryRun});
  const temp=pruneRuntimeTemps({roots:[cfg.importsDir,cfg.tempDir],maxAgeDays:Number(process.env.CE_QC_RUNTIME_TEMP_MAX_AGE_DAYS||14),dryRun});
  return{ok:true,id:STORAGE_MAINTENANCE_ID,dryRun,preUpdate,evidence,temp,at:new Date().toISOString()};
}

export function summarizeStorageFootprint(cfg){
  const targets={database:cfg.dbFile,backups:cfg.backupsDir,evidence:cfg.evidenceArchiveDir,legacyEvidence:cfg.legacyEvidenceArchiveDir,legacyPreUpdate:path.join(cfg.dataDir,'backups','pre_update')};
  return{ok:true,id:STORAGE_MAINTENANCE_ID,targets,databaseBytes:Number(stat(cfg.dbFile)?.size||0),runtimeEvidence:dirBytes(cfg.evidenceArchiveDir,50000),legacyEvidence:dirBytes(cfg.legacyEvidenceArchiveDir,50000),legacyPreUpdate:dirBytes(targets.legacyPreUpdate,5000)};
}
