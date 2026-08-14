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
const backupRoot=path.join(dataDir,'backups','pre_update');
const BACKUP_RATE_PAGES=Math.max(1024,Math.min(32768,Number(process.env.CE_QC_UPDATE_BACKUP_RATE_PAGES||8192)));
const REUSE_SCAN_LIMIT=Math.max(1,Math.min(100,Number(process.env.CE_QC_UPDATE_BACKUP_REUSE_SCAN_LIMIT||30)));
const LOW_RISK_BACKUP_MAX_AGE_MS=Math.max(60*60*1000,Math.min(7*24*60*60*1000,Number(process.env.CE_QC_LOW_RISK_BACKUP_MAX_AGE_MS||24*60*60*1000)));
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
  return {manifest,manifestPath,backupPath,stat};
}
function backupEntries(){
  if(!fs.existsSync(backupRoot))return [];
  return fs.readdirSync(backupRoot,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>({name:entry.name,dir:path.join(backupRoot,entry.name)})).sort((a,b)=>b.name.localeCompare(a.name)).slice(0,REUSE_SCAN_LIMIT);
}
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

if(!fs.existsSync(dbFile)){
  log('SKIP',`Database not found: ${dbFile}`);
  console.log(JSON.stringify({ok:true,skipped:true,reason:'DATABASE_NOT_FOUND',dbFile,root}));
  process.exit(0);
}
fs.mkdirSync(backupRoot,{recursive:true});
const fingerprintBefore=sourceFingerprint();
const reusable=findReusableBackup(fingerprintBefore);
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
    sourceStableDuringBackup:true,reusedFromManifest:reusable.manifestPath
  };
  fs.writeFileSync(path.join(reuseDir,'manifest.json'),JSON.stringify(reuseManifest,null,2),'utf8');
  log('READY','Verified existing backup reused; no database copy was repeated.');
  console.log(JSON.stringify({ok:true,reused:true,...reuseManifest}));
  process.exit(0);
}

const updateRisk=classifyUpdate(changedFiles());
const recentBackup=findRecentVerifiedBackup();
if(updateRisk.files.length>0&&!updateRisk.highRisk&&recentBackup){
  const skipDir=path.join(backupRoot,`${stamp()}-low-risk-skip`);fs.mkdirSync(skipDir,{recursive:true});
  const manifest={createdAt:new Date().toISOString(),reason:'before-automatic-code-update',projectRoot:root,candidateRoot,databasePath:dbFile,backupPath:recentBackup.backupPath,size:recentBackup.stat.size,backupMtimeMs:recentBackup.stat.mtimeMs,sha256:recentBackup.manifest.sha256,beforeCommit,targetCommit,sourceQuickCheck:'not-required-low-risk-code-update',backupQuickCheck:recentBackup.manifest.backupQuickCheck||'ok',integrity:recentBackup.manifest.integrity||'quick-ok',verificationMode:'low-risk-code-diff+recent-verified-backup',method:'verified-backup-low-risk-skip',sourceFingerprint:fingerprintBefore,sourceStableDuringBackup:true,reusedFromManifest:recentBackup.manifestPath,changedFiles:updateRisk.files,highRiskFiles:[],lowRiskBackupMaxAgeMs:LOW_RISK_BACKUP_MAX_AGE_MS};
  fs.writeFileSync(path.join(skipDir,'manifest.json'),JSON.stringify(manifest,null,2),'utf8');
  log('SKIP',`Low-risk code update; full ${((fileStat(dbFile).size||0)/1024/1024/1024).toFixed(1)} GiB database copy skipped. Recent verified backup retained: ${recentBackup.backupPath}`);
  console.log(JSON.stringify({ok:true,skipped:true,reason:'LOW_RISK_UPDATE_RECENT_VERIFIED_BACKUP',...manifest}));
  process.exit(0);
}
if(updateRisk.highRisk)log('POLICY',`High-risk update touches persistent-data code; full backup required: ${updateRisk.risky.join(', ')}`);
else if(!recentBackup)log('POLICY','No recent verified backup is available; full backup required even for low-risk update.');

const dir=path.join(backupRoot,stamp());
fs.mkdirSync(dir,{recursive:true});
const copyFile=path.join(dir,'ce_qc_monitor.db');
log('1/4',`Opening source SQLite read-only: ${dbFile}`);
const source=new DatabaseSync(dbFile,{readOnly:true,timeout:10000});
try{
  source.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=10000');
  log('2/4',`Creating SQLite online backup in ${BACKUP_RATE_PAGES} page batches...`);
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
if(!sameFingerprint(fingerprintBefore,fingerprintAfter)){
  throw new Error('SOURCE_CHANGED_DURING_UPDATE_BACKUP');
}
const manifest={
  createdAt:new Date().toISOString(),reason:'before-automatic-code-update',projectRoot:root,candidateRoot,
  databasePath:dbFile,backupPath:copyFile,size:copyStat.size,backupMtimeMs:copyStat.mtimeMs,sha256:copyHash,
  beforeCommit,targetCommit,sourceQuickCheck:'deferred-to-verified-copy',backupQuickCheck:'ok',integrity:'quick-ok',
  verificationMode:'online-backup+stable-source-fingerprint+backup-quick-check+sha256',method:'node-sqlite-online-backup',
  sourceFingerprint:fingerprintAfter,sourceFingerprintBefore:fingerprintBefore,sourceFingerprintAfter:fingerprintAfter,
  sourceStableDuringBackup:true,backupRatePages:BACKUP_RATE_PAGES,sourceOpenMode:'read-only',changedFiles:updateRisk.files,highRiskFiles:updateRisk.risky
};
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2),'utf8');
log('READY',`Verified backup ready: ${copyFile}`);
console.log(JSON.stringify({ok:true,...manifest}));