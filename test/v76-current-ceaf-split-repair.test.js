import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { repairLatestCeafSplit } from '../src/v76CurrentCeafSplitRepair.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE unified_import_batches(batchId TEXT PRIMARY KEY,snapshotId TEXT,reportDate TEXT,sourceName TEXT,fileHash TEXT,status TEXT,summaryJson TEXT,warningsJson TEXT,createdAt TEXT);
    CREATE TABLE unified_import_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,batchId TEXT,snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT,regionCode TEXT,recipientRaw TEXT,recipientNormalized TEXT,sheetName TEXT,rowNumber INTEGER,classificationReason TEXT,rowJson TEXT,createdAt TEXT,classificationSource TEXT,classificationMatchedValue TEXT,classificationWarning TEXT,UNIQUE(batchId,shipmentCode));
    CREATE TABLE unified_snapshots(snapshotId TEXT PRIMARY KEY,batchId TEXT,reportDate TEXT,status TEXT,payloadJson TEXT,createdAt TEXT);
    CREATE TABLE shipment_daily_snapshots(snapshotId TEXT,batchId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT,regionCode TEXT,classificationSource TEXT,rowJson TEXT,createdAt TEXT,PRIMARY KEY(snapshotId,shipmentCode));
    CREATE TABLE shipment_current_state(shipmentCode TEXT PRIMARY KEY,businessType TEXT,reportDate TEXT,snapshotId TEXT,state TEXT,apiStatus TEXT,lastEventTime TEXT,stateJson TEXT,updatedAt TEXT);
    CREATE TABLE carryover_open_items(shipmentCode TEXT PRIMARY KEY,businessType TEXT,sourceReportDate TEXT,lastReportDate TEXT,sourceSnapshotId TEXT,lastSnapshotId TEXT,status TEXT,apiStatus TEXT,closeReason TEXT,stateJson TEXT,createdAt TEXT,updatedAt TEXT);
    CREATE TABLE business_daily_parse_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,businessType TEXT,reportDate TEXT,shipmentCode TEXT,sheetName TEXT,rowNumber INTEGER,source_row_number INTEGER,recipient_raw TEXT,recipient_normalized TEXT,recipient_group TEXT,recipient_group_reason TEXT,rawText TEXT,rowJson TEXT,createdAt TEXT);
    CREATE TABLE business_daily_reports(businessType TEXT,reportDate TEXT,sourceFile TEXT,totalCount INTEGER,summaryJson TEXT,createdAt TEXT,updatedAt TEXT,PRIMARY KEY(businessType,reportDate));
    CREATE TABLE business_states(businessType TEXT PRIMARY KEY,valueJson TEXT,updatedAt TEXT);
    CREATE TABLE app_state(key TEXT PRIMARY KEY,valueJson TEXT,updatedAt TEXT);
    CREATE TABLE daily_reports(reportDate TEXT PRIMARY KEY,pnhCount INTEGER,totalUniqueCount INTEGER,summaryJson TEXT,updatedAt TEXT);
    CREATE TABLE daily_parse_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,reportDate TEXT,sheetName TEXT,rowNumber INTEGER,shipmentCode TEXT,result TEXT,reason TEXT,rawText TEXT,rowJson TEXT,createdAt TEXT);
    CREATE TABLE run_locks(reportDate TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE business_run_locks(businessType TEXT,reportDate TEXT,status TEXT,PRIMARY KEY(businessType,reportDate));
    CREATE TABLE business_history_summary(businessType TEXT,reportDate TEXT,summaryJson TEXT,PRIMARY KEY(businessType,reportDate));
    CREATE TABLE business_export_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,snapshotId TEXT,businessType TEXT,reportDate TEXT,payloadJson TEXT);
    CREATE TABLE business_scan_results(businessType TEXT,shipmentCode TEXT,reportDate TEXT);
    CREATE TABLE business_final_rows(businessType TEXT,shipmentCode TEXT,reportDate TEXT);
    CREATE TABLE business_track_events(businessType TEXT,shipmentCode TEXT,reportDate TEXT);
    CREATE TABLE business_exception_items(businessType TEXT,shipmentCode TEXT,reportDate TEXT);
  `);
  return db;
}

test('V76 repairs persisted current source split from WHPP 276 to CEAF 80 + WHPP 196 without reupload', () => {
  const db = makeDb();
  const date = '2026-08-01';
  const batchId = 'BATCH-1';
  const snapshotId = 'SNAP-1';
  const createdAt = '2026-08-01T00:00:00.000Z';

  db.prepare("INSERT INTO unified_import_batches VALUES(?,?,?,?,?,'VALID',?,?,?)")
    .run(batchId, snapshotId, date, '日报表.xlsx', 'hash:v42', JSON.stringify({ rawRows: 276, validUniqueWaybills: 0 }), '[]', createdAt);
  db.prepare("INSERT INTO unified_snapshots VALUES(?,?,?,'IMPORTED',?,?)")
    .run(snapshotId, batchId, date, JSON.stringify({ rows: [], summary: { rawRows: 276, validUniqueWaybills: 0 }, classificationCounts: {} }), createdAt);

  const pnhBills = [];
  const dailyParseRows = [];
  const insertWhpp = db.prepare(`INSERT INTO business_daily_parse_rows(businessType,reportDate,shipmentCode,sheetName,rowNumber,source_row_number,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,rawText,rowJson,createdAt)
    VALUES('WHPP',?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertCurrent = db.prepare("INSERT INTO shipment_current_state VALUES(?,'WHPP',?,?,'PENDING_SCAN','PENDING_SCAN','',?,?)");
  const insertCarry = db.prepare("INSERT INTO carryover_open_items VALUES(?,'WHPP',?,?,?,?,'OPEN','PENDING_SCAN','',?,?,?)");

  for (let index = 1; index <= 276; index += 1) {
    const bill = `CE${String(index).padStart(6, '0')}`;
    const isAir = index <= 80;
    const row = {
      shipmentCode: bill,
      businessType: 'WHPP',
      reportDate: date,
      regionCode: 'PP',
      recipientRaw: `LOCAL-${index}`,
      recipientNormalized: `LOCAL${index}`,
      sheetName: '日报',
      rowNumber: index + 1,
      classificationSource: 'SHIPMENT_PREFIX',
      classificationMatchedValue: 'CE',
      classificationReason: '运单号CE开头，归类WHPP本土',
      raw: { 运单编号: bill, 收件人: `LOCAL-${index}`, 业务客户标识: isAir ? 'CCAF' : 'CCSL' }
    };
    const rowJson = JSON.stringify(row);
    insertWhpp.run(date, bill, '日报', index + 1, index + 1, row.recipientRaw, row.recipientNormalized, 'WHPP', 'SHIPMENT_PREFIX_CE', '', rowJson, createdAt);
    insertCurrent.run(bill, date, snapshotId, rowJson, createdAt);
    insertCarry.run(bill, date, date, snapshotId, snapshotId, rowJson, createdAt, createdAt);
    pnhBills.push(bill);
    dailyParseRows.push(row);
  }

  db.prepare("INSERT INTO business_daily_reports VALUES('WHPP',?,?,276,?,?,?)")
    .run(date, '日报表.xlsx', JSON.stringify({ total: 276, totalRecognized: 276 }), createdAt, createdAt);
  db.prepare("INSERT INTO business_states VALUES('WHPP',?,?)")
    .run(JSON.stringify({ businessType: 'WHPP', reportDate: date, pnhBills, dailyParseRows, dailyParseSummary: { totalRecognized: 276 } }), createdAt);
  db.prepare("INSERT INTO app_state VALUES('current',?,?)")
    .run(JSON.stringify({ reportDate: date, pnhBills: [], dailyParseRows: [], dailyParseSummary: { totalRecognized: 0, pnh: 0 } }), createdAt);
  db.prepare("INSERT INTO daily_reports VALUES(?,0,0,?,?)").run(date, JSON.stringify({ totalRecognized: 0, pnh: 0 }), createdAt);

  const result = repairLatestCeafSplit(db);
  assert.equal(result.repaired, true);
  assert.equal(result.moved, 80);
  assert.equal(result.ceaf, 80);
  assert.equal(result.whpp, 196);

  assert.equal(db.prepare("SELECT COUNT(*) count FROM unified_import_rows WHERE batchId=? AND businessType='CEAF'").get(batchId).count, 80);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?").get(date).count, 196);
  assert.equal(db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=?").get(date).totalCount, 196);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM shipment_current_state WHERE businessType='CEAF'").get().count, 80);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM carryover_open_items WHERE businessType='CEAF'").get().count, 80);

  const whppState = JSON.parse(db.prepare("SELECT valueJson FROM business_states WHERE businessType='WHPP'").get().valueJson);
  assert.equal(whppState.pnhBills.length, 196);
  assert.equal(whppState.dailyParseRows.length, 196);

  const ccslState = JSON.parse(db.prepare("SELECT valueJson FROM app_state WHERE key='current'").get().valueJson);
  assert.equal(ccslState.pnhBills.length, 80);
  assert.equal(ccslState.dailyParseRows.length, 80);
  assert.equal(ccslState.dailyParseSummary.totalRecognized, 80);

  const batchSummary = JSON.parse(db.prepare('SELECT summaryJson FROM unified_import_batches WHERE batchId=?').get(batchId).summaryJson);
  assert.equal(batchSummary.validUniqueWaybills, 80);
  const payload = JSON.parse(db.prepare('SELECT payloadJson FROM unified_snapshots WHERE snapshotId=?').get(snapshotId).payloadJson);
  assert.equal(payload.classificationCounts.CEAF, 80);
  assert.equal(payload.rows.length, 80);
});

test('V76 refuses to mutate completed snapshots', () => {
  const db = makeDb();
  db.prepare("INSERT INTO unified_import_batches VALUES('B','S','2026-08-01','x','h','VALID','{}','[]','2026-08-01')").run();
  db.prepare("INSERT INTO unified_snapshots VALUES('S','B','2026-08-01','COMPLETED','{}','2026-08-01')").run();
  const result = repairLatestCeafSplit(db);
  assert.equal(result.repaired, false);
  assert.equal(result.reason, 'IMMUTABLE_COMPLETED_SNAPSHOT');
});
