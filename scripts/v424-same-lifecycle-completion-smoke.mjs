import './v426-ccsl-terminal-closure-smoke.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v424-lifecycle-'));
Object.assign(process.env,{
  NODE_ENV:'test',
  ACCESS_MODE:'LOCAL',
  DATA_DIR:root,
  DB_FILE:path.join(root,'unused-v424.db'),
  SQLITE_MMAP_BYTES:'0',
  SQLITE_CACHE_KIB:'8192',
  CE_QC_DISABLE_V246_TRACKING:'1'
});

// Project modules are deliberately imported only after the isolated test environment
// exists. Both readers below receive the explicit in-memory db fixture, so this smoke
// can never consult or mutate the production database as a side effect of test setup.
const { readV322SevenBusinessStatus }=await import('../src/v322WebAvailabilityPatch.js');
const { readV415CurrentProcessingProof }=await import('../src/v415RetroactiveCompletionGuard.js');

const db=new DatabaseSync(':memory:');
try{
  db.exec(`
  CREATE TABLE unified_import_batches(batchId TEXT,snapshotId TEXT,reportDate TEXT,status TEXT,createdAt TEXT);
  CREATE TABLE unified_import_rows(snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT);
  CREATE TABLE unified_snapshots(snapshotId TEXT,reportDate TEXT,status TEXT);
  CREATE TABLE run_locks(reportDate TEXT,runId TEXT,status TEXT,currentStage TEXT,batchIndex INTEGER,totalBatches INTEGER,errorMessage TEXT,lockedAt TEXT,updatedAt TEXT,completedAt TEXT);
  CREATE TABLE export_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,snapshotId TEXT,runId TEXT,reportDate TEXT,snapshotType TEXT,status TEXT,reconciliationStatus TEXT,generatedAt TEXT);
  CREATE TABLE scan_results(reportDate TEXT,shipmentCode TEXT,updatedAt TEXT,scanCategory TEXT,orderStatus TEXT,isPod INTEGER);
  CREATE TABLE final_rows(reportDate TEXT,shipmentCode TEXT,updatedAt TEXT,primaryCategory TEXT,category TEXT,qcConclusion TEXT);
  CREATE TABLE pod_locks(shipmentCode TEXT);
  CREATE TABLE business_run_locks(businessType TEXT,reportDate TEXT,runId TEXT,status TEXT,currentStage TEXT,batchIndex INTEGER,totalBatches INTEGER,errorMessage TEXT,lockedAt TEXT,updatedAt TEXT,completedAt TEXT);
  CREATE TABLE business_export_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,snapshotId TEXT,businessType TEXT,reportDate TEXT,runId TEXT,status TEXT,reconciliationStatus TEXT,generatedAt TEXT);
  CREATE TABLE business_final_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,apiStatus TEXT,updatedAt TEXT,isPod INTEGER DEFAULT 0,primaryCategory TEXT DEFAULT '');
  CREATE TABLE business_daily_reports(businessType TEXT,reportDate TEXT,totalCount INTEGER);
  CREATE TABLE business_daily_parse_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,businessType TEXT,reportDate TEXT,shipmentCode TEXT);
  `);

  const date='2026-09-01';
  const boundary1='2026-09-01T01:00:00.000Z';
  const completedAt='2026-09-01T02:00:00.000Z';
  const reopenedAt='2026-09-01T03:00:00.000Z';
  const boundary2='2026-09-01T04:00:00.000Z';

  db.prepare('INSERT INTO unified_import_batches VALUES(?,?,?,?,?)').run('B1','S1',date,'VALID',boundary1);
  db.prepare('INSERT INTO unified_import_rows VALUES(?,?,?,?)').run('S1',date,'CE','CE1');
  db.prepare('INSERT INTO run_locks VALUES(?,?,?,?,?,?,?,?,?,?)').run(date,'R_DONE','finished','完成',1,1,'',completedAt,completedAt,completedAt);
  db.prepare("INSERT INTO export_snapshots(snapshotId,runId,reportDate,snapshotType,status,reconciliationStatus,generatedAt) VALUES(?,?,?,?,?,?,?)").run('X_DONE','R_DONE',date,'dashboard','VALID','COMPLETED',completedAt);
  db.prepare('INSERT INTO scan_results VALUES(?,?,?,?,?,?)').run(date,'CE1',completedAt,'NORMAL','60',0);
  db.prepare('INSERT INTO final_rows VALUES(?,?,?,?,?,?)').run(date,'CE1',completedAt,'派送中','派送中','正常处理');

  const baseline322=readV322SevenBusinessStatus({db,reportDate:date,force:true});
  const baseline415=readV415CurrentProcessingProof({db,reportDate:date,force:true});
  assert.equal(baseline322.stages.CCSL.complete,true,'baseline V322 CCSL completion must be visible before a later run pointer appears');
  assert.equal(baseline322.stages.CCSL.completionClaimSource,'CURRENT_RUN_ID');
  assert.equal(baseline415.stages.CCSL.complete,true,'baseline V415 CCSL completion proof must be visible before a later run pointer appears');
  assert.equal(baseline415.stages.CCSL.completionClaimSource,'CURRENT_RUN_ID');

  // Reproduce the production failure: the already-completed lifecycle is followed by
  // an accidental new CCSL running pointer with no completion snapshot for that runId.
  db.prepare(`UPDATE run_locks SET runId=?,status='running',currentStage='订单扫描',batchIndex=1,totalBatches=1,errorMessage='',lockedAt=?,updatedAt=?,completedAt='' WHERE reportDate=?`)
    .run('R_REOPENED',reopenedAt,reopenedAt,date);

  const recovered322=readV322SevenBusinessStatus({db,reportDate:date,force:true});
  const recovered415=readV415CurrentProcessingProof({db,reportDate:date,force:true});
  assert.equal(recovered322.stages.CCSL.complete,true,'V322 must not let a later accidental runId hide same-lifecycle completion');
  assert.equal(recovered322.stages.CCSL.completionClaimSource,'SAME_VALID_IMPORT_LIFECYCLE');
  assert.equal(recovered322.stages.CCSL.running,false,'V322 completed stage must close the visible false-running state after proof succeeds');
  assert.equal(recovered415.stages.CCSL.complete,true,'V415 must keep the same-lifecycle completion accepted after exact current-member proof');
  assert.equal(recovered415.stages.CCSL.completionClaimSource,'SAME_VALID_IMPORT_LIFECYCLE');
  assert.equal(recovered415.stages.CCSL.covered,1);
  assert.equal(recovered415.stages.CCSL.missing,0);

  // A newer VALID import is a hard lifecycle boundary. Even when the shipment member
  // happens to be identical, the old completion snapshot and old processing evidence
  // are before the new boundary and must not be reused.
  db.prepare('INSERT INTO unified_import_batches VALUES(?,?,?,?,?)').run('B2','S2',date,'VALID',boundary2);
  db.prepare('INSERT INTO unified_import_rows VALUES(?,?,?,?)').run('S2',date,'CE','CE1');

  const newer322=readV322SevenBusinessStatus({db,reportDate:date,force:true});
  const newer415=readV415CurrentProcessingProof({db,reportDate:date,force:true});
  assert.equal(newer322.sourceSnapshotId,'S2');
  assert.equal(newer322.stages.CCSL.complete,false,'V322 must never carry an old completion snapshot across a newer VALID import boundary');
  assert.notEqual(newer322.stages.CCSL.completionClaimSource,'SAME_VALID_IMPORT_LIFECYCLE');
  assert.equal(newer415.batch.snapshotId,'S2');
  assert.equal(newer415.stages.CCSL.complete,false,'V415 must never carry old member-processing proof across a newer VALID import boundary');
  assert.notEqual(newer415.stages.CCSL.completionClaimSource,'SAME_VALID_IMPORT_LIFECYCLE');

  console.log('[V424] same-lifecycle completion smoke passed · accidental later CCSL runId cannot hide a proven completion · current-member proof remains mandatory · newer VALID import boundary invalidates old completion even with identical shipment membership · fixture is isolated from production storage');
} finally {
  try{db.close();}catch{}
  fs.rmSync(root,{recursive:true,force:true});
}
