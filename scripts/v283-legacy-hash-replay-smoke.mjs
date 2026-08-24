import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import { DatabaseSync } from 'node:sqlite';

process.env.NODE_ENV='test';
const { replayV283LegacyDecoratedHash, canonicalLegacyFileHash } = await import(`../src/v283LegacyDecoratedHashReplay.js?smoke=${Date.now()}`);

const root=await fsp.mkdtemp(path.join(os.tmpdir(),'ce-qc-v283-'));
try {
  const reportDate='2026-08-17';
  const sourceRoot=path.join(root,'evidence_archive','source_uploads');
  const monthRoot=path.join(sourceRoot,'2026-08');
  await fsp.mkdir(monthRoot,{recursive:true});

  const rawFile=path.join(root,'source.xlsx');
  const workbook=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([
    ['运单号','日报日期','备注'],
    ['CC260817000001',reportDate,''],
    ['CE260817000002',reportDate,''],
    ['TBKH260817000003',reportDate,'CC999999999999']
  ]);
  XLSX.utils.book_append_sheet(workbook,sheet,'日报');
  XLSX.writeFile(workbook,rawFile);
  const hash=crypto.createHash('sha256').update(fs.readFileSync(rawFile)).digest('hex');
  const decorated=`${hash}:2026-08-13-v77-ceaf-whpp-source-authority`;
  assert.equal(canonicalLegacyFileHash(decorated),hash);
  await fsp.copyFile(rawFile,path.join(monthRoot,`${hash}.xlsx`));

  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE unified_import_batches(
      batchId TEXT PRIMARY KEY,snapshotId TEXT,reportDate TEXT,sourceName TEXT,fileHash TEXT,status TEXT,
      summaryJson TEXT,warningsJson TEXT,createdAt TEXT,dateDetectionSource TEXT,dateCandidatesJson TEXT,
      dateWasManuallyCorrected INTEGER,regionCountsJson TEXT
    );
    CREATE TABLE unified_import_rows(
      id INTEGER PRIMARY KEY AUTOINCREMENT,batchId TEXT,snapshotId TEXT,reportDate TEXT,businessType TEXT,
      shipmentCode TEXT,regionCode TEXT,recipientRaw TEXT,recipientNormalized TEXT,sheetName TEXT,rowNumber INTEGER,
      classificationReason TEXT,rowJson TEXT,createdAt TEXT,classificationSource TEXT,classificationMatchedValue TEXT,
      classificationWarning TEXT
    );
    CREATE TABLE shipment_daily_snapshots(
      id INTEGER PRIMARY KEY AUTOINCREMENT,snapshotId TEXT,batchId TEXT,reportDate TEXT,businessType TEXT,
      shipmentCode TEXT,regionCode TEXT,classificationSource TEXT,rowJson TEXT,createdAt TEXT
    );
    CREATE TABLE unified_snapshots(snapshotId TEXT PRIMARY KEY,batchId TEXT,reportDate TEXT,status TEXT,payloadJson TEXT,createdAt TEXT);
    CREATE TABLE shipment_current_state(shipmentCode TEXT PRIMARY KEY,businessType TEXT,reportDate TEXT,state TEXT,stateJson TEXT,updatedAt TEXT);
    CREATE TABLE carryover_open_items(shipmentCode TEXT PRIMARY KEY,businessType TEXT,sourceReportDate TEXT,lastReportDate TEXT,status TEXT,stateJson TEXT,updatedAt TEXT);
  `);
  db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt,dateDetectionSource,dateCandidatesJson,dateWasManuallyCorrected,regionCountsJson)
    VALUES(?,?,?,?,?,'VALID','{}','[]',?,'','[]',0,'{}')`)
    .run('BOLD','SOLD',reportDate,'legacy.xlsx',decorated,'2026-08-17T10:00:00Z');
  const insertOld=db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt,classificationSource,classificationMatchedValue,classificationWarning)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertOld.run('BOLD','SOLD',reportDate,'CE','CC260817000001','PP','','','日报',2,'','{}','2026-08-17T10:00:00Z','','','');
  insertOld.run('BOLD','SOLD',reportDate,'WHPP','CE260817000002','PV','','','日报',3,'','{}','2026-08-17T10:00:00Z','','','');
  db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,state,stateJson,updatedAt) VALUES(?,?,?,?,?,?)`)
    .run('CC260817000001','CE','2026-08-21','POD','{"marker":"CURRENT_0821"}','2026-08-21T20:00:00Z');
  db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,status,stateJson,updatedAt) VALUES(?,?,?,?,?,?,?)`)
    .run('CE260817000002','WHPP',reportDate,'2026-08-21','CLOSED','{"marker":"CARRY_0821"}','2026-08-21T20:00:00Z');
  const currentBefore=JSON.stringify(db.prepare('SELECT * FROM shipment_current_state ORDER BY shipmentCode').all());
  const carryBefore=JSON.stringify(db.prepare('SELECT * FROM carryover_open_items ORDER BY shipmentCode').all());

  const logs=[];
  const logger={info:(...args)=>logs.push(['info',...args]),warn:(...args)=>logs.push(['warn',...args]),error:(...args)=>logs.push(['error',...args])};
  const result=await replayV283LegacyDecoratedHash(reportDate,{db,sourceRoot,logger});
  assert.equal(result.ok,true);
  assert.equal(result.repaired,true);
  assert.equal(result.previousCount,2);
  assert.equal(result.newCount,3);
  assert.equal(result.recovered,1);
  assert.equal(result.canonicalFileHash,hash);
  assert.equal(result.currentStatePreserved,true);
  assert.equal(Number(result.ignoredOffColumnCount||0),1,'off-column waybill-looking note must remain diagnostic only');
  const valid=db.prepare("SELECT batchId,fileHash,status FROM unified_import_batches WHERE reportDate=? AND status='VALID'").all(reportDate);
  assert.equal(valid.length,1,'V283 repair must leave exactly one VALID historical batch');
  assert.equal(valid[0].fileHash,hash,'new repaired batch must store the canonical SHA-256');
  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM unified_import_rows WHERE batchId=?').get(valid[0].batchId)?.count||0),3);
  assert.match(String(db.prepare('SELECT status FROM unified_import_batches WHERE batchId=?').get('BOLD')?.status||''),/^SUPERSEDED_V283:/);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM shipment_current_state ORDER BY shipmentCode').all()),currentBefore);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM carryover_open_items ORDER BY shipmentCode').all()),carryBefore);
  assert.ok(logs.some(row=>String(row.join(' ')).includes('V283_LEGACY_HASH_REPLAY_REPAIRED')));
  db.close();
  console.log('[V283] decorated legacy hash full archive replay smoke passed · 2->3 · off-column diagnostic ignored · current/carry unchanged');
} finally {
  await fsp.rm(root,{recursive:true,force:true});
}
