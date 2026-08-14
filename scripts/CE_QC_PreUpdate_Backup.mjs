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

function log(step,text){console.log(`[BACKUP ${step}] ${text}`);}
function stamp(){const d=new Date();const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;}
function fileStat(file){try{const s=fs.statSync(file);return {exists:true,size:Number(s.size||0),mtimeMs:Number(s.mtimeMs||0)};}catch{return {exists:false,size:0,mtimeMs:0};}}
function sourceFingerprint(){return {db:fileStat(dbFile),wal:fileStat(`${dbFile}-wal`)};}
function sameStat(a={},b={}){return Boolean(a.exists)===Boolean(b.exists)&&Number(a.size||0)===Number(b.size||0)&&Math.abs(Number(a.mtimeMs||0)-Number(b.mtimeMs||0))<=1;}
function sameFingerprint(a={},b={}){return sameStat(a.db,b.db)&&sameStat(a.wal,b.wal);}
function sha256(file){const hash=crypto.createHash('sha256');const fd=fs.openSync(file,'r');try{const buffer=Buffer.allocUnsafe(8*1024*1024);let bytes=0;do{bytes=fs.readSync(fd,buffer,0,buffer.length,null);if(bytes>0)hash.update(buffer.subarray(0,bytes));}while(bytes>0);}finally{fs.closeSync(fd);}return hash.digest('hex');}

if(!fs.existsSync(dbFile)){log('SKIP',`Database not found: ${dbFile}`);console.log(JSON.stringify({ok:true,skipped:true,reason:'DATABASE_NOT_FOUND',dbFile,root}));process.exit(0);}
fs.mkdirSync(path.join(dataDir,'backups','pre_update'),{recursive:true});
const dir=path.join(dataDir,'backups','pre_update',stamp());fs.mkdirSync(dir,{recursive:true});
const copyFile=path.join(dir,'ce_qc_monitor.db');
const fingerprintBefore=sourceFingerprint();

log('1/4',`Opening source SQLite: ${dbFile}`);
const source=new DatabaseSync(dbFile,{timeout:10000});
try{
  source.exec('PRAGMA busy_timeout=10000');
  // Do not scan the whole source database here. The online backup is verified on
  // the copy below; if the source has structural corruption the backup quick_check
  // fails and the updater refuses to install the candidate. This removes one full
  // database pass from every safe update without weakening the acceptance gate.
  log('2/4','Creating SQLite online backup...');
  let nextReport=10;
  await backup(source,copyFile,{rate:1024,progress:({totalPages,remainingPages})=>{if(!Number.isFinite(totalPages)||totalPages<=0)return;const pct=Math.max(0,Math.min(100,Math.floor(((totalPages-remainingPages)/totalPages)*100)));if(pct>=nextReport||remainingPages===0){log('2/4',`SQLite backup ${remainingPages===0?100:pct}%`);while(nextReport<=pct)nextReport+=10;}}});
}finally{source.close();}

log('3/4','Opening backup read-only and running quick structural check...');
const verify=new DatabaseSync(copyFile,{readOnly:true,timeout:10000});
try{verify.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=10000');const quick=verify.prepare('PRAGMA quick_check(1)').get()?.quick_check||'';if(quick!=='ok')throw new Error(`BACKUP_QUICK_CHECK_FAILED:${quick}`);}finally{verify.close();}

log('4/4','Calculating backup SHA-256...');
const copyStat=fileStat(copyFile);if(!copyStat.exists||copyStat.size<=0)throw new Error('BACKUP_EMPTY');
const copyHash=sha256(copyFile);
const fingerprintAfter=sourceFingerprint();
const manifest={createdAt:new Date().toISOString(),reason:'before-automatic-code-update',projectRoot:root,candidateRoot,databasePath:dbFile,backupPath:copyFile,size:copyStat.size,backupMtimeMs:copyStat.mtimeMs,sha256:copyHash,beforeCommit,targetCommit,sourceQuickCheck:'deferred-to-verified-copy',backupQuickCheck:'ok',integrity:'quick-ok',verificationMode:'online-backup+backup-quick-check+sha256',method:'node-sqlite-online-backup',sourceFingerprint:fingerprintAfter,sourceFingerprintBefore:fingerprintBefore,sourceFingerprintAfter:fingerprintAfter,sourceStableDuringBackup:sameFingerprint(fingerprintBefore,fingerprintAfter)};
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2),'utf8');
log('READY',`Verified backup ready: ${copyFile}`);
console.log(JSON.stringify({ok:true,...manifest}));
