import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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

function findReusableBackup(currentFingerprint){
  if(!fs.existsSync(backupRoot))return null;
  const entries=fs.readdirSync(backupRoot,{withFileTypes:true})
    .filter(entry=>entry.isDirectory())
    .map(entry=>({name:entry.name,dir:path.join(backupRoot,entry.name)}))
    .sort((a,b)=>b.name.localeCompare(a.name))
    .slice(0,REUSE_SCAN_LIMIT);
  for(const entry of entries){
    const manifestPath=path.join(entry.dir,'manifest.json');
    const manifest=readJson(manifestPath);
    if(!manifest||manifest.reason!=='before-automatic-code-update')continue;
    if(manifest.sourceStableDuringBackup!==true||!sameFingerprint(manifest.sourceFingerprint,currentFingerprint))continue;
    const backupPath=String(manifest.backupPath||'');
    if(!backupPath||!fs.existsSync(backupPath)||!validSha(manifest.sha256))continue;
    const stat=fileStat(backupPath);
    if(!stat.exists||stat.size<=0||Number(manifest.size||0)!==stat.size)continue;
    if(Number.isFinite(Number(manifest.backupMtimeMs))&&Math.abs(Number(manifest.backupMtimeMs)-stat.mtimeMs)>1)continue;
    if(!['ok','quick-ok'].includes(String(manifest.integrity||'')))continue;
    return {manifest,manifestPath,backupPath,stat};
  }
  return null;
}

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

const dir=path.join(backupRoot,stamp());
fs.mkdirSync(dir,{recursive:true});
const copyFile=path.join(dir,'ce_qc_monitor.db');
log('1/4',`Opening source SQLite: ${dbFile}`);
const source=new DatabaseSync(dbFile,{timeout:10000});
try{
  source.exec('PRAGMA busy_timeout=10000');
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
  sourceStableDuringBackup:true,backupRatePages:BACKUP_RATE_PAGES
};
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2),'utf8');
log('READY',`Verified backup ready: ${copyFile}`);
console.log(JSON.stringify({ok:true,...manifest}));
