import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v792-whpp-trend-'));
process.env.DATA_DIR=root;
process.env.DB_FILE=path.join(root,'isolated-whpp-chart.db');
const blank=new DatabaseSync(process.env.DB_FILE);
blank.close();
let closeDb;
try {
  const dbModule=await import('../src/db.js');
  closeDb=dbModule.closeDb;
  const db=dbModule.getDb();
  const {loadWhppCanonicalTruth}=await import('../src/whppCanonicalTruth.js');
  const created='2026-10-28T00:00:00.000Z';
  db.prepare("INSERT INTO unified_import_batches (batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES('B1','S1','2026-07-01','fixture','fixture','VALID','{}','[]',?)").run(created);
  const addUnified=db.prepare("INSERT INTO unified_import_rows (batchId,snapshotId,reportDate,businessType,shipmentCode,rowNumber,rowJson,createdAt) VALUES('B1','S1','2026-07-01','WHPP',?,?,?,?)");
  const addIndependent=db.prepare("INSERT INTO business_daily_parse_rows (businessType,reportDate,shipmentCode,rowNumber,rowJson,createdAt) VALUES('WHPP','2026-07-02',?,?,?,?)");
  const addFinal=db.prepare("INSERT INTO business_final_rows (businessType,shipmentCode,reportDate,isPod,primaryCategory,rawJson,createdAt,updatedAt) VALUES('WHPP',?,?,?,?,?,?,?)");
  for(const [index,bill,pod] of [[1,'WHPPTEST001',true],[2,'WHPPTEST002',true],[3,'WHPPTEST003',false]]){
    addUnified.run(bill,index,JSON.stringify({shipmentCode:bill}),created);
    addFinal.run(bill,'2026-07-01',pod?1:0,pod?'POD':'RETURNED',
      JSON.stringify({shipmentCode:bill,退回状态:pod?'':'已退回'}),created,created);
  }
  for(const [index,bill] of [[1,'WHPPTEST101'],[2,'WHPPTEST102']])
    addIndependent.run(bill,index,JSON.stringify({shipmentCode:bill}),created);
  const unified=loadWhppCanonicalTruth('2026-07-01','',db);
  assert.equal(unified.total,3);
  assert.equal(unified.evidence.finalRows,3);
  assert.equal(unified.evidence.podRows,2);
  assert.equal(unified.evidence.returnedRows,1);
  const independent=loadWhppCanonicalTruth('2026-07-02','',db);
  assert.equal(independent.total,2,'independent WHPP daily must be a valid fallback');
  assert.equal(independent.evidence.podRows,0);
  assert.equal(independent.rows.filter(row=>row.finalRowAvailable).length,0,
    'without TMS evidence, WHPP trend POD must stay null rather than 0');
  console.log('[V792] isolated WHPP unified and independent daily source + terminal evidence PASS');
} finally {
  try { closeDb?.() } catch {}
  fs.rmSync(root,{recursive:true,force:true});
}
