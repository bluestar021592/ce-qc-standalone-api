import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getDb, getRuntimeConfig, nowIso } from './db.js';
import { BUSINESS_DATA_TABLES } from './store.js';

export const V209_RAW_IMPORT_ARCHIVE_VERSION='2026-08-19-v209-immutable-source-workbook-archive-v1';
const ROUTE='/api/import/unified-daily-report';
const WRAPPED=Symbol.for('ce-qc.v209-source-archive');
let routesInstalled=false;

function safeJson(value,fallback={}){if(value&&typeof value==='object')return value;try{return JSON.parse(String(value||''))||fallback;}catch{return fallback;}}
function dateKey(value=''){const m=String(value||'').match(/(20\d{2})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';}
function safeName(value=''){return String(value||'daily.xlsx').normalize('NFKC').replace(/[\\/:*?"<>|\x00-\x1F]/g,'_').replace(/\s+/g,' ').trim().slice(0,180)||'daily.xlsx';}
function sha256File(file){const h=createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(4*1024*1024);try{let n=0;do{n=fs.readSync(fd,buffer,0,buffer.length,null);if(n>0)h.update(buffer.subarray(0,n));}while(n>0);}finally{fs.closeSync(fd);}return h.digest('hex');}
function archiveRoot(){return path.join(getRuntimeConfig().importsDir,'source_archive_v209');}

export function ensureV209RawImportArchiveSchema(db=getDb()){
  db.exec(`CREATE TABLE IF NOT EXISTS v209_import_source_archive(
    archiveId TEXT PRIMARY KEY,
    reportDate TEXT NOT NULL,
    sourceName TEXT NOT NULL,
    sourceFileSha256 TEXT NOT NULL,
    archivePath TEXT NOT NULL,
    fileSize INTEGER NOT NULL,
    parsedUnique INTEGER NOT NULL DEFAULT 0,
    sourceWaybillCount INTEGER NOT NULL DEFAULT 0,
    classificationJson TEXT,
    status TEXT NOT NULL DEFAULT 'PREPARED',
    batchId TEXT,
    snapshotId TEXT,
    canonicalUnique INTEGER NOT NULL DEFAULT 0,
    errorMessage TEXT,
    createdAt TEXT NOT NULL,
    completedAt TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_v209_source_date_status ON v209_import_source_archive(reportDate,status,createdAt);
  CREATE INDEX IF NOT EXISTS idx_v209_source_hash ON v209_import_source_archive(sourceFileSha256,reportDate,status);`);
  if(!BUSINESS_DATA_TABLES.includes('v209_import_source_archive'))BUSINESS_DATA_TABLES.push('v209_import_source_archive');
  return true;
}

function verifiedExisting(reportDate,sha){
  const db=getDb();ensureV209RawImportArchiveSchema(db);
  const rows=db.prepare("SELECT * FROM v209_import_source_archive WHERE reportDate=? AND sourceFileSha256=? AND status='ACCEPTED' ORDER BY createdAt DESC").all(reportDate,sha);
  for(const row of rows){try{if(fs.existsSync(row.archivePath)&&Number(fs.statSync(row.archivePath).size)===Number(row.fileSize)&&sha256File(row.archivePath)===sha)return row;}catch{}}
  return null;
}

export function prepareV209SourceArchive(req={}){
  const source=String(req.file?.path||'');
  if(!source||!fs.existsSync(source)){const e=new Error('V209无法读取原始日报临时文件，已停止导入，避免出现数据库有数据但原始日报无法恢复。');e.code='SOURCE_ARCHIVE_INPUT_MISSING';throw e;}
  const parsed=req.ceQcParsedUnified||{};
  const reportDate=dateKey(parsed.reportDate||req.body?.reportDate||req.ceQcUnifiedImportDate?.reportDate||'');
  if(!reportDate){const e=new Error('V209原始日报归档缺少明确日报日期，已停止导入。');e.code='SOURCE_ARCHIVE_DATE_MISSING';throw e;}
  const sourceHash=sha256File(source),stat=fs.statSync(source),existing=verifiedExisting(reportDate,sourceHash);
  if(existing)return{archiveId:existing.archiveId,reportDate,sourceName:existing.sourceName,sourceFileSha256:sourceHash,archivePath:existing.archivePath,fileSize:Number(existing.fileSize),reused:true,status:'ACCEPTED'};
  const dir=path.join(archiveRoot(),reportDate);fs.mkdirSync(dir,{recursive:true});
  const archiveId=randomUUID(),stamp=new Date().toISOString().replace(/[:.]/g,'-'),name=safeName(req.file?.originalname||'daily.xlsx');
  const dest=path.join(dir,`${stamp}_${sourceHash.slice(0,12)}_${name}`);
  fs.copyFileSync(source,dest,fs.constants.COPYFILE_EXCL);
  const copiedSize=fs.statSync(dest).size,copiedHash=sha256File(dest);
  if(copiedSize!==stat.size||copiedHash!==sourceHash){try{fs.unlinkSync(dest);}catch{}const e=new Error('原始日报归档SHA-256校验失败，已停止导入；不会写入不完整数据。');e.code='SOURCE_ARCHIVE_HASH_MISMATCH';throw e;}
  const safety=req.ceQcImportSafety?.sourceWaybillReconciliation||{};
  const now=nowIso();ensureV209RawImportArchiveSchema();
  getDb().prepare(`INSERT INTO v209_import_source_archive(archiveId,reportDate,sourceName,sourceFileSha256,archivePath,fileSize,parsedUnique,sourceWaybillCount,classificationJson,status,createdAt)
    VALUES(?,?,?,?,?,?,?,?,?,'PREPARED',?)`).run(archiveId,reportDate,name,sourceHash,dest,stat.size,Number(parsed.summary?.validUniqueWaybills||parsed.rows?.length||0),Number(safety.sourceWaybillCount||parsed.rows?.length||0),JSON.stringify(parsed.classificationCounts||{}),now);
  return{archiveId,reportDate,sourceName:name,sourceFileSha256:sourceHash,archivePath:dest,fileSize:stat.size,reused:false,status:'PREPARED'};
}

function finishArchive(archive,payload={}){
  if(!archive?.archiveId||archive.reused)return archive;
  const ok=payload?.ok!==false;
  const canonical=Number(payload?.importIntegrity?.canonicalUnique||payload?.summary?.canonicalUniqueWaybills||0);
  const status=ok?'ACCEPTED':'REJECTED';
  getDb().prepare('UPDATE v209_import_source_archive SET status=?,batchId=?,snapshotId=?,canonicalUnique=?,errorMessage=?,completedAt=? WHERE archiveId=?')
    .run(status,String(payload?.batchId||''),String(payload?.snapshotId||''),canonical,ok?'':String(payload?.error||payload?.message||'IMPORT_REJECTED').slice(0,1500),nowIso(),archive.archiveId);
  return{...archive,status,canonicalUnique:canonical};
}

function verifyRecord(row){
  try{
    if(!fs.existsSync(row.archivePath))return{...row,archiveHealth:'MISSING_FILE'};
    const size=fs.statSync(row.archivePath).size;if(Number(size)!==Number(row.fileSize))return{...row,archiveHealth:'SIZE_MISMATCH'};
    if(sha256File(row.archivePath)!==row.sourceFileSha256)return{...row,archiveHealth:'HASH_MISMATCH'};
    return{...row,archiveHealth:'VERIFIED'};
  }catch(error){return{...row,archiveHealth:'VERIFY_ERROR',verifyError:error?.message||String(error)};}
}

export function getV209ArchiveStatus({fromDate='',toDate=''}={}){
  ensureV209RawImportArchiveSchema();const params=[];let where="status='ACCEPTED'";
  const from=dateKey(fromDate),to=dateKey(toDate);if(from&&to){where+=' AND reportDate BETWEEN ? AND ?';params.push(from,to);}else if(from){where+=' AND reportDate>=?';params.push(from);}else if(to){where+=' AND reportDate<=?';params.push(to);}
  const raw=getDb().prepare(`SELECT * FROM v209_import_source_archive WHERE ${where} ORDER BY reportDate DESC,createdAt DESC`).all(...params);
  const rows=raw.map(verifyRecord),healthy=rows.filter(r=>r.archiveHealth==='VERIFIED').length,broken=rows.length-healthy;
  const dates=[...new Set(rows.map(r=>r.reportDate))];
  return{ok:true,version:V209_RAW_IMPORT_ARCHIVE_VERSION,archiveRoot:archiveRoot(),acceptedFiles:rows.length,archivedDates:dates.length,verifiedFiles:healthy,brokenFiles:broken,allVerified:broken===0,rows:rows.map(r=>({archiveId:r.archiveId,reportDate:r.reportDate,sourceName:r.sourceName,sourceFileSha256:r.sourceFileSha256,fileSize:Number(r.fileSize||0),parsedUnique:Number(r.parsedUnique||0),sourceWaybillCount:Number(r.sourceWaybillCount||0),canonicalUnique:Number(r.canonicalUnique||0),classification:safeJson(r.classificationJson,{}),archiveHealth:r.archiveHealth,createdAt:r.createdAt,completedAt:r.completedAt}))};
}

function wrapHandler(handler){
  if(typeof handler!=='function'||handler[WRAPPED])return handler;
  const wrapped=async function v209SourceArchiveBeforePersistence(req,res,next){
    let archive;
    try{archive=prepareV209SourceArchive(req);req.ceQcSourceArchive=archive;}
    catch(error){console.error('[CE-QC][V209_SOURCE_ARCHIVE_BLOCKED]',error?.code||'',error?.message||error);return res.status(500).json({ok:false,code:error?.code||'SOURCE_ARCHIVE_FAILED',error:error?.message||String(error),archiveVersion:V209_RAW_IMPORT_ARCHIVE_VERSION});}
    const originalJson=res.json.bind(res);let finalized=false;
    res.json=function v209ArchiveResult(payload){if(!finalized){finalized=true;try{const finished=finishArchive(archive,payload);if(payload&&typeof payload==='object')payload={...payload,sourceArchive:{archiveId:finished.archiveId,reportDate:finished.reportDate,sourceFileSha256:finished.sourceFileSha256,status:finished.status,reused:Boolean(finished.reused),verified:true,version:V209_RAW_IMPORT_ARCHIVE_VERSION}};}catch(error){console.error('[CE-QC][V209_SOURCE_ARCHIVE_FINALIZE_FAILED]',error?.stack||error);if(payload&&typeof payload==='object')payload={...payload,sourceArchive:{archiveId:archive?.archiveId||'',status:'FINALIZE_ERROR',error:error?.message||String(error),version:V209_RAW_IMPORT_ARCHIVE_VERSION}};}}return originalJson(payload);};
    return handler.call(this,req,res,next);
  };
  Object.defineProperty(wrapped,WRAPPED,{value:true});return wrapped;
}

const previousPost=express.application.post;
express.application.post=function v209RawImportArchivePost(pathValue,...handlers){
  if(String(pathValue||'')===ROUTE&&handlers.length)return previousPost.call(this,pathValue,...handlers.slice(0,-1),wrapHandler(handlers.at(-1)));
  return previousPost.call(this,pathValue,...handlers);
};

const previousListen=express.application.listen;
express.application.listen=function v209RawImportArchiveListen(...args){
  if(!routesInstalled){routesInstalled=true;this.get('/api/v209/source-archive/status',(req,res)=>{try{res.setHeader('Cache-Control','no-store');res.json(getV209ArchiveStatus({fromDate:req.query.fromDate,toDate:req.query.toDate}));}catch(error){res.status(500).json({ok:false,error:error.message,version:V209_RAW_IMPORT_ARCHIVE_VERSION});}});}
  return previousListen.apply(this,args);
};

ensureV209RawImportArchiveSchema();
export const __test={safeName,sha256File,verifyRecord};
