import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { __test } from '../src/v226LatestReportDateQueryPatch.js';

const raw="SELECT * FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC LIMIT 1";
const rewritten=__test.rewriteLatestValidUnifiedQuery(raw);
assert.match(rewritten,/ORDER BY reportDate DESC, createdAt DESC LIMIT 1/i);

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v226-'));
const file=path.join(dir,'date-order.db');
const db=new DatabaseSync(file);
try{
  db.exec("CREATE TABLE unified_import_batches(batchId TEXT PRIMARY KEY,snapshotId TEXT,reportDate TEXT,sourceName TEXT,fileHash TEXT,status TEXT,summaryJson TEXT,warningsJson TEXT,createdAt TEXT)");
  const insert=db.prepare('INSERT INTO unified_import_batches VALUES(?,?,?,?,?,?,?,?,?)');
  insert.run('NEWEST-DATE','S16','2026-08-16','8-16.xls','a','VALID','{}','[]','2026-08-16T12:00:00Z');
  insert.run('OLDER-REIMPORTED-LATER','S02','2026-08-02','8-2-reimport.xls','b','VALID','{}','[]','2026-08-19T12:00:00Z');
  const row=db.prepare(raw).get();
  assert.equal(row.reportDate,'2026-08-16');
  assert.equal(row.snapshotId,'S16');
  console.log('[V226] latest report-date regression passed: 2026-08-16 remains current even when 2026-08-02 was reimported later.');
}finally{
  try{db.close();}catch{}
  try{fs.rmSync(dir,{recursive:true,force:true});}catch{}
}
