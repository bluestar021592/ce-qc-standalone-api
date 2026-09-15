import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

function decodePayload(raw=''){
  try{return JSON.parse(Buffer.from(String(raw||''),'base64url').toString('utf8'));}
  catch{return {};}
}
function statFingerprint(file){
  try{const stat=fs.statSync(file);return {exists:true,size:Number(stat.size||0),mtimeMs:Number(stat.mtimeMs||0)};}
  catch{return {exists:false,size:0,mtimeMs:0};}
}
function databaseFingerprint(dbFile){return {db:statFingerprint(dbFile),wal:statFingerprint(`${dbFile}-wal`)};}
function sameStat(a={},b={}){return Boolean(a.exists)===Boolean(b.exists)&&Number(a.size||0)===Number(b.size||0)&&Math.abs(Number(a.mtimeMs||0)-Number(b.mtimeMs||0))<=1;}
function sameFingerprint(a={},b={}){return sameStat(a.db,b.db)&&sameStat(a.wal,b.wal);}
function hashFile(file){
  return new Promise((resolve,reject)=>{
    const hash=crypto.createHash('sha256');
    const input=fs.createReadStream(file,{highWaterMark:1024*1024});
    input.on('error',reject);input.on('data',chunk=>hash.update(chunk));input.on('end',()=>resolve(hash.digest('hex')));
  });
}

const payload=decodePayload(process.argv[2]||'');
const dbFile=String(payload.dbFile||'').trim();
const filePath=String(payload.filePath||'').trim();
const timeoutMs=Math.max(10_000,Math.min(120_000,Number(payload.lockTimeoutMs||30_000)));
// V545 deliberately caps the SQLite backup step to 512 pages (~2 MiB at 4 KiB/page).
// The backup remains full + quick_check + SHA verified, but Windows can interleave
// normal browser/auth/database reads instead of letting one 25+ GiB copy monopolize IO.
const ratePages=Math.max(128,Math.min(512,Number(payload.ratePages||512)));
if(!dbFile||!filePath){
  process.stdout.write(`${JSON.stringify({ok:false,error:'V504_DB_OR_BACKUP_PATH_REQUIRED',worker:'V504'})}\n`);
  process.exit(2);
}

let lockDb=null;let sourceDb=null;let verifyDb=null;let locked=false;
try{
  if(!fs.existsSync(dbFile))throw new Error('V504_SOURCE_DATABASE_MISSING');
  const sourceStat=fs.statSync(dbFile);
  if(!sourceStat.isFile()||Number(sourceStat.size||0)<=0)throw new Error('V504_SOURCE_DATABASE_INVALID');
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  try{fs.rmSync(filePath,{force:true});}catch{}
  lockDb=new DatabaseSync(dbFile,{timeout:timeoutMs});
  lockDb.exec(`PRAGMA busy_timeout=${timeoutMs}; BEGIN IMMEDIATE;`);
  locked=true;
  const sourceFingerprintBefore=databaseFingerprint(dbFile);

  sourceDb=new DatabaseSync(dbFile,{readOnly:true,timeout:timeoutMs});
  sourceDb.exec(`PRAGMA query_only=ON; PRAGMA busy_timeout=${timeoutMs}`);
  await backup(sourceDb,filePath,{rate:ratePages});
  sourceDb.close();sourceDb=null;

  const sourceFingerprintAfterBackup=databaseFingerprint(dbFile);
  if(!sameFingerprint(sourceFingerprintBefore,sourceFingerprintAfterBackup))throw new Error('V504_SOURCE_CHANGED_DURING_BACKUP');
  const backupStat=fs.statSync(filePath);
  if(Number(backupStat.size||0)<=0)throw new Error('V504_BACKUP_EMPTY');

  verifyDb=new DatabaseSync(filePath,{readOnly:true,timeout:timeoutMs});
  verifyDb.exec(`PRAGMA query_only=ON; PRAGMA busy_timeout=${timeoutMs}`);
  const quick=String(verifyDb.prepare('PRAGMA quick_check(1)').get()?.quick_check||'');
  verifyDb.close();verifyDb=null;
  if(quick!=='ok')throw new Error(`V504_BACKUP_QUICK_CHECK_FAILED:${quick||'empty'}`);

  const sha256=await hashFile(filePath);
  const sourceFingerprintAfterVerification=databaseFingerprint(dbFile);
  if(!sameFingerprint(sourceFingerprintAfterBackup,sourceFingerprintAfterVerification))throw new Error('V504_SOURCE_CHANGED_DURING_VERIFICATION');
  const finalStat=fs.statSync(filePath);
  process.stdout.write(`${JSON.stringify({ok:true,worker:'V504',integrity:'quick-ok',quickCheck:'ok',sha256,size:Number(finalStat.size||0),mtimeMs:Number(finalStat.mtimeMs||0),method:'node-sqlite-online-backup-isolated-write-freeze-v545-io-throttled',ratePages,sourceFingerprintBefore,sourceFingerprintAfter:sourceFingerprintAfterVerification})}\n`);
}catch(error){
  try{fs.rmSync(filePath,{force:true});}catch{}
  process.stdout.write(`${JSON.stringify({ok:false,error:error?.message||String(error),worker:'V504'})}\n`);
  process.exitCode=3;
}finally{
  try{verifyDb?.close();}catch{}
  try{sourceDb?.close();}catch{}
  if(locked){try{lockDb?.exec('ROLLBACK');}catch{}}
  try{lockDb?.close();}catch{}
}
