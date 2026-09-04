import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { backup, DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const candidateRoot=path.resolve(__dirname,'..');
const root=path.resolve(process.env.CE_QC_BACKUP_PROJECT_ROOT||candidateRoot);
dotenv.config({path:path.join(root,'.env'),override:false});

const DEFAULT_DATA_DIR='D:\\CE CCSL金边数据库';
const resolveProjectPath=value=>path.isAbsolute(value)?path.normalize(value):path.resolve(root,value);
const fallbackDataDir=path.resolve(root,'data');
const rootAvailable=value=>{try{return fs.existsSync(path.parse(path.resolve(value)).root);}catch{return false;}};
const preferredDataDir=resolveProjectPath(process.env.DATA_DIR||DEFAULT_DATA_DIR);
const dataDir=rootAvailable(preferredDataDir)?preferredDataDir:fallbackDataDir;
const preferredDbFile=resolveProjectPath(process.env.DB_FILE||path.join(dataDir,'ce_qc_monitor.db'));
const dbFile=rootAvailable(preferredDbFile)?preferredDbFile:path.join(fallbackDataDir,'ce_qc_monitor.db');
const beforeCommit=String(process.argv[2]||'').trim();
const targetCommit=String(process.argv[3]||'').trim();
const GIB=1024*1024*1024;
const V425_BACKUP_STORAGE_POLICY_ID='2026-09-04-v425-c-d-auto-backup-retention-v1';
const legacyBackupRoot=path.join(dataDir,'backups','pre_update');
const managedLauncherHome=String(process.env.LOCALAPPDATA||'').trim()
  ?path.join(String(process.env.LOCALAPPDATA).trim(),'CE_QC_LAUNCHER')
  :path.resolve(root,'.ce-qc-launcher');
const managedBackupRoot=path.join(managedLauncherHome,'backups','pre_update');
const explicitBackupRoot=String(process.env.CE_QC_PREUPDATE_BACKUP_ROOT||'').trim();
const BACKUP_RATE_PAGES=Math.max(1024,Math.min(32768,Number(process.env.CE_QC_UPDATE_BACKUP_RATE_PAGES||8192)));
const REUSE_SCAN_LIMIT=Math.max(1,Math.min(100,Number(process.env.CE_QC_UPDATE_BACKUP_REUSE_SCAN_LIMIT||30)));
const LOW_RISK_BACKUP_MAX_AGE_MS=Math.max(60*60*1000,Math.min(7*24*60*60*1000,Number(process.env.CE_QC_LOW_RISK_BACKUP_MAX_AGE_MS||24*60*60*1000)));
const SOURCE_LOCK_TIMEOUT_MS=Math.max(5000,Math.min(120000,Number(process.env.CE_QC_UPDATE_BACKUP_LOCK_TIMEOUT_MS||30000)));
const PHYSICAL_BACKUP_KEEP_COUNT=Math.max(2,Math.min(6,Number(process.env.CE_QC_PREUPDATE_BACKUP_KEEP_COUNT||2)));
const ABANDONED_BACKUP_MAX_AGE_MS=Math.max(60*60*1000,Math.min(7*24*60*60*1000,Number(process.env.CE_QC_ABANDONED_BACKUP_MAX_AGE_MS||24*60*60*1000)));
const METADATA_RETENTION_MS=Math.max(24*60*60*1000,Math.min(30*24*60*60*1000,Number(process.env.CE_QC_BACKUP_METADATA_RETENTION_MS||7*24*60*60*1000)));
const BACKUP_HEADROOM_MIN_BYTES=Math.max(4*GIB,Math.min(64*GIB,Number(process.env.CE_QC_BACKUP_HEADROOM_MIN_BYTES||8*GIB)));
const SHA_BUFFER_BYTES=16*1024*1024;

// Progress intentionally goes to stderr. Older managed launchers pipe stdout to
// Out-Null, but stderr remains visible, so a large backup never looks frozen.
function log(step,text){console.error(`[BACKUP ${step}] ${text}`);}
function stamp(){const d=new Date();const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;}
function fileStat(file){try{const s=fs.statSync(file);return {exists:true,size:Number(s.size||0),mtimeMs:Number(s.mtimeMs||0)};}catch{return {exists:false,size:0,mtimeMs:0};}}
function sourceFingerprint(){return {db:fileStat(dbFile),wal:fileStat(`${dbFile}-wal`)};}
function sameStat(a={},b={}){return Boolean(a.exists)===Boolean(b.exists)&&Number(a.size||0)===Number(b.size||0)&&Math.abs(Number(a.mtimeMs||0)-Number(b.mtimeMs||0))<=1;}
function sameFingerprint(a={},b={}){return sameStat(a.db,b.db)&&sameStat(a.wal,b.wal);}
function validSha(value){return /^[a-f0-9]{64}$/i.test(String(value||''));}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function uniquePaths(values=[]){const seen=new Set(),result=[];for(const value of values){if(!value)continue;const full=path.resolve(value),key=process.platform==='win32'?full.toLowerCase():full;if(seen.has(key))continue;seen.add(key);result.push(full);}return result;}
function nearestExisting(value){let current=path.resolve(value);for(;;){if(fs.existsSync(current))return current;const parent=path.dirname(current);if(parent===current)return '';current=parent;}}
function freeBytesFor(value){try{const existing=nearestExisting(value);if(!existing)return 0;const stat=fs.statfsSync(existing);const blocks=Number(stat.bavail??stat.bfree??0),size=Number(stat.bsize??0);const bytes=blocks*size;return Number.isFinite(bytes)&&bytes>0?bytes:0;}catch{return 0;}}
function formatGiB(bytes){return `${(Math.max(0,Number(bytes||0))/GIB).toFixed(1)} GiB`;}
function driveLabel(value){const parsed=path.parse(path.resolve(value));return parsed.root||path.resolve(value);}

const candidateBackupRoots=uniquePaths([
  explicitBackupRoot?resolveProjectPath(explicitBackupRoot):'',
  managedBackupRoot,
  legacyBackupRoot
]).filter(rootPath=>rootAvailable(rootPath)||nearestExisting(rootPath));
if(candidateBackupRoots.length===0)candidateBackupRoots.push(path.join(fallbackDataDir,'backups','pre_update'));

function selectBackupRoot(dbSize=0){
  const required=Number(dbSize||0)+Math.max(BACKUP_HEADROOM_MIN_BYTES,Math.ceil(Number(dbSize||0)*0.25));
  const ranked=candidateBackupRoots.map(rootPath=>({root:rootPath,freeBytes:freeBytesFor(rootPath),drive:driveLabel(rootPath)})).sort((a,b)=>b.freeBytes-a.freeBytes);
  let selected=null;
  if(explicitBackupRoot){const explicit=ranked.find(item=>path.resolve(item.root)===path.resolve(resolveProjectPath(explicitBackupRoot)));if(explicit&&explicit.freeBytes>=required)selected=explicit;}
  if(!selected)selected=ranked.find(item=>item.freeBytes>=required)||ranked[0]||null;
  if(!selected)throw new Error('BACKUP_STORAGE_UNAVAILABLE:no C/D backup root is available');
  return {...selected,requiredBytes:required,eligible:selected.freeBytes>=required,policy:V425_BACKUP_STORAGE_POLICY_ID,candidates:ranked};
}

let selectedStorage=selectBackupRoot(fileStat(dbFile).size);
let backupRoot=selectedStorage.root;
const backupRoots=uniquePaths([backupRoot,...candidateBackupRoots]);

function directBackupEntries(){
  const items=[];
  for(const rootPath of backupRoots){
    if(!fs.existsSync(rootPath))continue;
    let entries=[];try{entries=fs.readdirSync(rootPath,{withFileTypes:true});}catch{continue;}
    for(const entry of entries){if(entry.isDirectory())items.push({name:entry.name,dir:path.join(rootPath,entry.name),root:rootPath});}
  }
  return items.sort((a,b)=>b.name.localeCompare(a.name));
}
function verifiedBackupEntry(entry){
  const manifestPath=path.join(entry.dir,'manifest.json');
  const manifest=readJson(manifestPath);
  if(!manifest||manifest.reason!=='before-automatic-code-update')return null;
  const backupPath=String(manifest.backupPath||'');
  if(!backupPath||!fs.existsSync(backupPath)||!validSha(manifest.sha256))return null;
  const stat=fileStat(backupPath);
  if(!stat.exists||stat.size<=0||Number(manifest.size||0)!==stat.size)return null;
  if(Number.isFinite(Number(manifest.backupMtimeMs))&&Math.abs(Number(manifest.backupMtimeMs)-stat.mtimeMs)>1)return null;
  if(!['ok','quick-ok'].includes(String(manifest.integrity||'')))return null;
  return {entry,manifest,manifestPath,backupPath,stat};
}
function backupEntries(){return directBackupEntries().slice(0,REUSE_SCAN_LIMIT);}
function findReusableBackup(currentFingerprint){
  for(const entry of backupEntries()){
    const found=verifiedBackupEntry(entry);
    if(!found)continue;
    if(found.manifest.sourceStableDuringBackup!==true||!sameFingerprint(found.manifest.sourceFingerprint,currentFingerprint))continue;
    return found;
  }
  return null;
}
function findRecentVerifiedBackup(){
  const now=Date.now();
  for(const entry of backupEntries()){
    const found=verifiedBackupEntry(entry);if(!found)continue;
    const createdAt=Date.parse(found.manifest.createdAt||'');
    if(Number.isFinite(createdAt)&&now-createdAt>=0&&now-createdAt<=LOW_RISK_BACKUP_MAX_AGE_MS)return found;
  }
  return null;
}
function isDirectChildOfBackupRoot(dir){const parent=path.dirname(path.resolve(dir));return backupRoots.some(rootPath=>path.resolve(rootPath)===parent);}
function safeRemoveBackupDir(dir,label='cleanup'){
  if(!isDirectChildOfBackupRoot(dir)){log('CLEANUP',`Refusing ${label} outside managed pre_update roots: ${dir}`);return 0;}
  let bytes=0;try{for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(item.isFile()){try{bytes+=Number(fs.statSync(path.join(dir,item.name)).size||0);}catch{}}}}catch{}
  try{fs.rmSync(dir,{recursive:true,force:true});log('CLEANUP',`${label}: removed ${dir}${bytes?` (${formatGiB(bytes)})`:''}`);return bytes;}catch(error){log('CLEANUP',`${label} skipped: ${dir}: ${error?.message||error}`);return 0;}
}
function physicalVerifiedBackups(){
  const rows=[];const seen=new Set();
  for(const entry of directBackupEntries()){
    const found=verifiedBackupEntry(entry);if(!found)continue;
    if(path.resolve(path.dirname(found.backupPath))!==path.resolve(entry.dir))continue;
    const key=process.platform==='win32'?path.resolve(found.backupPath).toLowerCase():path.resolve(found.backupPath);
    if(seen.has(key))continue;seen.add(key);
    rows.push({...found,createdAt:Date.parse(found.manifest.createdAt||'')||found.stat.mtimeMs||0});
  }
  return rows.sort((a,b)=>b.createdAt-a.createdAt);
}
function pruneVerifiedPhysicalBackups(protectedPaths=[]){
  const protectedSet=new Set(protectedPaths.filter(Boolean).map(value=>{const full=path.resolve(value);return process.platform==='win32'?full.toLowerCase():full;}));
  const rows=physicalVerifiedBackups();
  const keep=new Set();
  for(const row of rows.slice(0,PHYSICAL_BACKUP_KEEP_COUNT)){const full=path.resolve(row.backupPath);keep.add(process.platform==='win32'?full.toLowerCase():full);}
  for(const value of protectedSet)keep.add(value);
  let reclaimed=0;
  for(const row of rows){const full=path.resolve(row.backupPath),key=process.platform==='win32'?full.toLowerCase():full;if(keep.has(key))continue;reclaimed+=safeRemoveBackupDir(row.entry.dir,'old verified backup retention');}
  if(reclaimed>0)log('CLEANUP',`Verified-backup retention reclaimed ${formatGiB(reclaimed)}; newest ${PHYSICAL_BACKUP_KEEP_COUNT} physical backups plus current rollback proof were retained.`);
  return reclaimed;
}
function cleanupAbandonedBackupArtifacts(protectedDirs=[]){
  const now=Date.now();
  const protectedSet=new Set(protectedDirs.filter(Boolean).map(value=>path.resolve(value)));
  let reclaimed=0;
  for(const entry of directBackupEntries()){
    const dir=path.resolve(entry.dir);if(protectedSet.has(dir))continue;
    const manifest=readJson(path.join(dir,'manifest.json'));
    const directDb=path.join(dir,'ce_qc_monitor.db');
    const stat=fileStat(dir);const age=Math.max(0,now-Number(stat.mtimeMs||0));
    const valid=verifiedBackupEntry(entry);
    if(fs.existsSync(directDb)&&!valid&&age>=ABANDONED_BACKUP_MAX_AGE_MS){reclaimed+=safeRemoveBackupDir(dir,'abandoned/incomplete backup');continue;}
    const metadataOnly=!fs.existsSync(directDb);
    const method=String(manifest?.method||'');
    if(metadataOnly&&age>=METADATA_RETENTION_MS&&(method.includes('reuse')||method.includes('skip')||!manifest)){reclaimed+=safeRemoveBackupDir(dir,'old backup metadata');}
  }
  return reclaimed;
}
function pruneLegacyLooseBackups(){
  const legacyDir=path.join(dataDir,'backups');
  if(!fs.existsSync(legacyDir)||physicalVerifiedBackups().length<PHYSICAL_BACKUP_KEEP_COUNT)return 0;
  let rows=[];
  try{
    rows=fs.readdirSync(legacyDir,{withFileTypes:true})
      .filter(entry=>entry.isFile()&&/^ce_qc_monitor_before_update_\d{8}-\d{6}_[a-f0-9]{7,40}\.db$/i.test(entry.name))
      .map(entry=>{const file=path.join(legacyDir,entry.name),stat=fileStat(file);return{file,stat};})
      .filter(row=>row.stat.exists&&path.resolve(row.file)!==path.resolve(dbFile))
      .sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);
  }catch{return 0;}
  let reclaimed=0;
  for(const row of rows.slice(1)){
    if(Date.now()-row.stat.mtimeMs<ABANDONED_BACKUP_MAX_AGE_MS)continue;
    try{fs.rmSync(row.file,{force:true});reclaimed+=row.stat.size;log('CLEANUP',`legacy loose updater backup removed after two verified manifest backups were retained: ${row.file} (${formatGiB(row.stat.size)})`);}catch(error){log('CLEANUP',`legacy loose updater backup retained: ${row.file}: ${error?.message||error}`);}
  }
  if(reclaimed>0)log('CLEANUP',`Legacy updater backup cleanup reclaimed ${formatGiB(reclaimed)} on ${driveLabel(legacyDir)}.`);
  return reclaimed;
}
function changedFiles(){
  if(!beforeCommit||!targetCommit)return [];
  const git=process.platform==='win32'?'git.exe':'git';
  const result=spawnSync(git,['-C',root,'diff','--name-only',beforeCommit,targetCommit],{encoding:'utf8',windowsHide:true});
  if(result.status!==0)return [];
  return String(result.stdout||'').split(/\r?\n/).map(v=>v.trim().replace(/\\/g,'/')).filter(Boolean);
}
function isHighRiskPath(file=''){
  const value=String(file||'').replace(/\\/g,'/');
  if(value==='scripts/CE_QC_PreUpdate_Backup.mjs')return false;
  return /(^|\/)(db\.js|server\.js)$/i.test(value)
    || /(^|\/).*store\.js$/i.test(value)
    || /(^|\/)v340CcslStorageCheckpoint\.js$/i.test(value)
    || /migration|schema|dataPurge|purgeDeleteWorker|fresh-start-reset|database-repair/i.test(value)
    || /unifiedImportStore|carryoverStore|businessStore|whppStore|authStore/i.test(value);
}
function classifyUpdate(files=[]){const risky=files.filter(isHighRiskPath);return {files,risky,highRisk:risky.length>0};}

function sha256WithProgress(file){
  const total=Math.max(1,Number(fs.statSync(file).size||0));
  const hash=crypto.createHash('sha256');
  const fd=fs.openSync(file,'r');
  let processed=0;
  let nextReport=10;
  try{
    const buffer=Buffer.allocUnsafe(SHA_BUFFER_BYTES);
    for(;;){
      const bytes=fs.readSync(fd,buffer,0,buffer.length,null);
      if(bytes<=0)break;
      hash.update(buffer.subarray(0,bytes));
      processed+=bytes;
      const pct=Math.max(0,Math.min(100,Math.floor((processed/total)*100)));
      if(pct>=nextReport||processed>=total){
        log('4/4',`SHA-256 ${processed>=total?100:pct}%`);
        while(nextReport<=pct)nextReport+=10;
      }
    }
  }finally{fs.closeSync(fd);}
  return hash.digest('hex');
}

function acquireSourceWriteFreeze(){
  const lockDb=new DatabaseSync(dbFile,{timeout:SOURCE_LOCK_TIMEOUT_MS});
  try{
    lockDb.exec(`PRAGMA busy_timeout=${SOURCE_LOCK_TIMEOUT_MS}; BEGIN IMMEDIATE;`);
    return lockDb;
  }catch(error){
    try{lockDb.close();}catch{}
    throw new Error(`SOURCE_WRITE_FREEZE_FAILED:${error?.message||error}`);
  }
}
function releaseSourceWriteFreeze(lockDb){
  if(!lockDb)return;
  try{lockDb.exec('ROLLBACK;');}catch{}
  try{lockDb.close();}catch{}
}

if(!fs.existsSync(dbFile)){
  log('SKIP',`Database not found: ${dbFile}`);
  console.log(JSON.stringify({ok:true,skipped:true,reason:'DATABASE_NOT_FOUND',dbFile,root}));
  process.exit(0);
}
selectedStorage=selectBackupRoot(fileStat(dbFile).size);
backupRoot=selectedStorage.root;
if(!selectedStorage.freeBytes)log('STORAGE',`Free-space probe unavailable for ${backupRoot}; full-copy eligibility will fail closed if a new backup is required.`);
else log('STORAGE',`${V425_BACKUP_STORAGE_POLICY_ID} selected ${driveLabel(backupRoot)} (${formatGiB(selectedStorage.freeBytes)} free) for new pre-update backup metadata/copies; source database stays at ${dbFile}.`);
fs.mkdirSync(backupRoot,{recursive:true});
cleanupAbandonedBackupArtifacts();
const updateRisk=classifyUpdate(changedFiles());
const fingerprintBefore=sourceFingerprint();

// Exact-fingerprint reuse is deliberately a low-risk optimization only. If the
// candidate changes persistence/storage hot-path code, make a fresh online backup
// even when the live DB happens to be byte-identical to a previous verified copy.
// This keeps every high-risk code switch paired with its own frozen source snapshot.
const reusable=updateRisk.highRisk?null:findReusableBackup(fingerprintBefore);
if(reusable){
  log('REUSE',`Database unchanged; reusing verified backup: ${reusable.backupPath}`);
  const reuseDir=path.join(backupRoot,`${stamp()}-reuse`);
  fs.mkdirSync(reuseDir,{recursive:true});
  const reuseManifest={
    createdAt:new Date().toISOString(),reason:'before-automatic-code-update',projectRoot:root,candidateRoot,
    databasePath:dbFile,backupPath:reusable.backupPath,size:reusable.stat.size,backupMtimeMs:reusable.stat.mtimeMs,
    sha256:reusable.manifest.sha256,beforeCommit,targetCommit,sourceQuickCheck:'reused-verified-backup',
    backupQuickCheck:reusable.manifest.backupQuickCheck||'ok',integrity:reusable.manifest.integrity||'quick-ok',
    verificationMode:'exact-source-fingerprint+verified-backup-reuse',method:'verified-backup-reuse',
    sourceFingerprint:fingerprintBefore,sourceFingerprintBefore:fingerprintBefore,sourceFingerprintAfter:fingerprintBefore,
    sourceStableDuringBackup:true,reusedFromManifest:reusable.manifestPath,changedFiles:updateRisk.files,highRiskFiles:[],
    backupStoragePolicy:V425_BACKUP_STORAGE_POLICY_ID,backupRoot,backupDrive:driveLabel(backupRoot),backupFreeBytesBefore:selectedStorage.freeBytes,backupRequiredBytes:selectedStorage.requiredBytes,
    physicalBackupKeepCount:PHYSICAL_BACKUP_KEEP_COUNT
  };
  fs.writeFileSync(path.join(reuseDir,'manifest.json'),JSON.stringify(reuseManifest,null,2),'utf8');
  pruneVerifiedPhysicalBackups([reusable.backupPath]);
  pruneLegacyLooseBackups();
  cleanupAbandonedBackupArtifacts([reuseDir]);
  log('READY','Verified existing backup reused; no database copy was repeated.');
  console.log(JSON.stringify({ok:true,reused:true,...reuseManifest}));
  process.exit(0);
}

const recentBackup=findRecentVerifiedBackup();
if(updateRisk.files.length>0&&!updateRisk.highRisk&&recentBackup){
  const skipDir=path.join(backupRoot,`${stamp()}-low-risk-skip`);fs.mkdirSync(skipDir,{recursive:true});
  const manifest={createdAt:new Date().toISOString(),reason:'before-automatic-code-update',projectRoot:root,candidateRoot,databasePath:dbFile,backupPath:recentBackup.backupPath,size:recentBackup.stat.size,backupMtimeMs:recentBackup.stat.mtimeMs,sha256:recentBackup.manifest.sha256,beforeCommit,targetCommit,sourceQuickCheck:'not-required-low-risk-code-update',backupQuickCheck:recentBackup.manifest.backupQuickCheck||'ok',integrity:recentBackup.manifest.integrity||'quick-ok',verificationMode:'low-risk-code-diff+recent-verified-backup',method:'verified-backup-low-risk-skip',sourceFingerprint:fingerprintBefore,sourceStableDuringBackup:true,reusedFromManifest:recentBackup.manifestPath,changedFiles:updateRisk.files,highRiskFiles:[],lowRiskBackupMaxAgeMs:LOW_RISK_BACKUP_MAX_AGE_MS,backupStoragePolicy:V425_BACKUP_STORAGE_POLICY_ID,backupRoot,backupDrive:driveLabel(backupRoot),backupFreeBytesBefore:selectedStorage.freeBytes,backupRequiredBytes:selectedStorage.requiredBytes,physicalBackupKeepCount:PHYSICAL_BACKUP_KEEP_COUNT};
  fs.writeFileSync(path.join(skipDir,'manifest.json'),JSON.stringify(manifest,null,2),'utf8');
  pruneVerifiedPhysicalBackups([recentBackup.backupPath]);
  pruneLegacyLooseBackups();
  cleanupAbandonedBackupArtifacts([skipDir]);
  log('SKIP',`Low-risk code update; full ${((fileStat(dbFile).size||0)/GIB).toFixed(1)} GiB database copy skipped. Recent verified backup retained: ${recentBackup.backupPath}`);
  console.log(JSON.stringify({ok:true,skipped:true,reason:'LOW_RISK_UPDATE_RECENT_VERIFIED_BACKUP',...manifest}));
  process.exit(0);
}
if(updateRisk.highRisk)log('POLICY',`High-risk update touches persistent-data code; fresh full backup required (reuse disabled): ${updateRisk.risky.join(', ')}`);
else if(!recentBackup)log('POLICY','No recent verified backup is available; full backup required even for low-risk update.');
if(!selectedStorage.eligible)throw new Error(`INSUFFICIENT_BACKUP_SPACE:${driveLabel(backupRoot)} has ${formatGiB(selectedStorage.freeBytes)} free; verified full backup requires at least ${formatGiB(selectedStorage.requiredBytes)} including safety headroom. C/D auto-selection refused an unsafe copy.`);

log('LOCK',`Freezing SQLite writers with BEGIN IMMEDIATE (timeout ${SOURCE_LOCK_TIMEOUT_MS}ms)...`);
const writeFreeze=acquireSourceWriteFreeze();
const sourceLockAcquiredAt=new Date().toISOString();
let finalManifest=null;
let finalDir='';
let copyFile='';
try{
  const lockedFingerprintBefore=sourceFingerprint();
  log('LOCK','Write freeze acquired; source state is now quiescent for verified backup.');
  finalDir=path.join(backupRoot,stamp());
  fs.mkdirSync(finalDir,{recursive:true});
  copyFile=path.join(finalDir,'ce_qc_monitor.db');
  log('1/4',`Opening source SQLite read-only: ${dbFile}`);
  const source=new DatabaseSync(dbFile,{readOnly:true,timeout:10000});
  try{
    source.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=10000');
    log('2/4',`Creating SQLite online backup on ${driveLabel(backupRoot)} in ${BACKUP_RATE_PAGES} page batches...`);
    let nextReport=5;
    let lastPct=-1;
    await backup(source,copyFile,{rate:BACKUP_RATE_PAGES,progress:({totalPages,remainingPages})=>{
      if(!Number.isFinite(totalPages)||totalPages<=0)return;
      const pct=Math.max(0,Math.min(100,Math.floor(((totalPages-remainingPages)/totalPages)*100)));
      if(pct!==lastPct&&(pct>=nextReport||remainingPages===0)){
        lastPct=pct;
        log('2/4',`SQLite backup ${remainingPages===0?100:pct}%`);
        while(nextReport<=pct)nextReport+=5;
      }
    }});
  }finally{source.close();}

  log('3/4','Opening backup read-only and running quick structural check...');
  const verify=new DatabaseSync(copyFile,{readOnly:true,timeout:10000});
  try{
    verify.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=10000');
    const quick=verify.prepare('PRAGMA quick_check(1)').get()?.quick_check||'';
    if(quick!=='ok')throw new Error(`BACKUP_QUICK_CHECK_FAILED:${quick}`);
  }finally{verify.close();}

  const copyStat=fileStat(copyFile);
  if(!copyStat.exists||copyStat.size<=0)throw new Error('BACKUP_EMPTY');
  log('4/4',`Calculating backup SHA-256 for ${(copyStat.size/1024/1024).toFixed(1)} MiB...`);
  const copyHash=sha256WithProgress(copyFile);
  const fingerprintAfter=sourceFingerprint();
  if(!sameFingerprint(lockedFingerprintBefore,fingerprintAfter)){
    const detail=JSON.stringify({before:lockedFingerprintBefore,after:fingerprintAfter});
    throw new Error(`SOURCE_CHANGED_DURING_WRITE_FREEZE:${detail}`);
  }
  finalManifest={
    createdAt:new Date().toISOString(),reason:'before-automatic-code-update',projectRoot:root,candidateRoot,
    databasePath:dbFile,backupPath:copyFile,size:copyStat.size,backupMtimeMs:copyStat.mtimeMs,sha256:copyHash,
    beforeCommit,targetCommit,sourceQuickCheck:'deferred-to-verified-copy',backupQuickCheck:'ok',integrity:'quick-ok',
    verificationMode:'sqlite-write-freeze+online-backup+stable-source-fingerprint+backup-quick-check+sha256',method:'node-sqlite-online-backup-with-begin-immediate-freeze',
    sourceFingerprint:fingerprintAfter,sourceFingerprintBefore:lockedFingerprintBefore,sourceFingerprintAfter:fingerprintAfter,
    sourceStableDuringBackup:true,sourceWriteFreeze:'BEGIN_IMMEDIATE',sourceLockAcquiredAt,sourceLockTimeoutMs:SOURCE_LOCK_TIMEOUT_MS,
    backupRatePages:BACKUP_RATE_PAGES,sourceOpenMode:'read-only-backup-reader+separate-write-freeze-connection',changedFiles:updateRisk.files,highRiskFiles:updateRisk.risky,
    highRiskFreshBackupRequired:updateRisk.highRisk,verifiedBackupReuseAllowed:!updateRisk.highRisk,
    backupStoragePolicy:V425_BACKUP_STORAGE_POLICY_ID,backupRoot,backupDrive:driveLabel(backupRoot),backupFreeBytesBefore:selectedStorage.freeBytes,backupRequiredBytes:selectedStorage.requiredBytes,
    backupCandidates:selectedStorage.candidates,physicalBackupKeepCount:PHYSICAL_BACKUP_KEEP_COUNT
  };
  fs.writeFileSync(path.join(finalDir,'manifest.json'),JSON.stringify(finalManifest,null,2),'utf8');
  log('READY',`Verified backup ready under write freeze: ${copyFile}`);
}finally{
  releaseSourceWriteFreeze(writeFreeze);
  log('LOCK','SQLite write freeze released.');
}
if(finalManifest){
  pruneVerifiedPhysicalBackups([copyFile]);
  pruneLegacyLooseBackups();
  cleanupAbandonedBackupArtifacts([finalDir]);
  console.log(JSON.stringify({ok:true,...finalManifest}));
}
