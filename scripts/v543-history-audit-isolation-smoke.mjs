import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const patchSource=read('src/v142SevenBusinessExportPatch.js');
const auditSource=read('src/v142SevenBusinessHistoryAudit.js');
const uiSource=read('public/v142-history-integrity-audit.js');
const workerPath=path.join(root,'scripts','CE_QC_HistoryIntegrityAuditWorker.mjs');

assert.match(patchSource,/2026-09-15-v543-history-audit-isolated-job-v1/);
assert.match(patchSource,/spawn\(process\.execPath,\[AUDIT_WORKER\]/,'browser audit must run in a child process');
assert.match(patchSource,/history-integrity-job\/:jobId/,'browser must poll a fast job-status endpoint');
assert.doesNotMatch(patchSource,/function auditHandler\([\s\S]*?auditSevenBusinessHistory\(/,'5177 audit handler must not execute synchronous SQLite history audit');
assert.match(auditSource,/auditSevenBusinessHistoryWithDb/,'audit core must accept the worker read-only connection');
assert.match(auditSource,/INDEXED BY idx_business_daily_rows/,'CEAF marker proof must stay inside the known WHPP business/date index');
assert.match(uiSource,/V543_BACKGROUND_READONLY_HISTORY_AUDIT_POLL|v543-background-readonly-history-audit-poll/i);
assert.match(uiSource,/history-integrity-job/,'UI must poll the isolated job rather than wait on a blocking request');
assert.doesNotMatch(uiSource,/AUDIT_TIMEOUT_MS=60000/,'legacy 60s abort must not own the isolated audit lifecycle');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v543-history-audit-'));
const dbFile=path.join(dir,'audit.db');
try{
  const db=new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE unified_import_batches(batchId TEXT,snapshotId TEXT,reportDate TEXT,sourceName TEXT,createdAt TEXT,status TEXT);
    CREATE TABLE unified_snapshots(snapshotId TEXT,reportDate TEXT,status TEXT);
    CREATE TABLE unified_import_rows(snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT);
    CREATE INDEX idx_unified_import_rows_snapshot ON unified_import_rows(snapshotId,businessType,reportDate,shipmentCode);
  `);
  db.prepare("INSERT INTO unified_import_batches VALUES(?,?,?,?,?,?)").run('B1','S1','2026-09-15','fixture','2026-09-15T00:00:00.000Z','VALID');
  db.prepare("INSERT INTO unified_snapshots VALUES(?,?,?)").run('S1','2026-09-15','COMPLETED');
  db.prepare("INSERT INTO unified_import_rows VALUES(?,?,?,?)").run('S1','2026-09-15','SHOPEECN','TEST001');
  db.close();
  const before=fs.statSync(dbFile);
  const result=await new Promise((resolve,reject)=>{
    const child=fork(workerPath,[],{
      cwd:root,silent:true,
      env:{...process.env,CE_QC_HISTORY_AUDIT_DB_FILE:dbFile,CE_QC_HISTORY_AUDIT_FROM_DATE:'2026-09-15',CE_QC_HISTORY_AUDIT_TO_DATE:'2026-09-15'}
    });
    let message=null,stderr='';
    child.on('message',value=>{message=value;});
    child.stderr?.on('data',chunk=>{stderr+=String(chunk||'');});
    child.once('error',reject);
    child.once('exit',(code)=>{if(!message)return reject(new Error(`worker exited ${code}: ${stderr}`));resolve(message);});
  });
  assert.equal(result.ok,true,`isolated worker failed: ${result.error||''}`);
  assert.equal(result.result?.readOnly,true);
  assert.equal(result.result?.workerIsolation,'2026-09-15-v543-history-audit-worker-v1');
  assert.equal(result.result?.fromDate,'2026-09-15');
  assert.equal(result.result?.toDate,'2026-09-15');
  const after=fs.statSync(dbFile);
  assert.equal(after.size,before.size,'read-only worker must not change database size');
  assert.equal(after.mtimeMs,before.mtimeMs,'read-only worker must not modify database mtime');
  assert.equal(fs.existsSync(`${dbFile}-wal`),false,'read-only worker must not create a WAL file');
  assert.equal(fs.existsSync(`${dbFile}-journal`),false,'read-only worker must not create a rollback journal');
}finally{
  fs.rmSync(dir,{recursive:true,force:true});
}

console.log('[V543] isolated history audit smoke passed · 5177 does not run the synchronous audit · child DB connection is read-only · UI polls job state · no business-data mutation');
