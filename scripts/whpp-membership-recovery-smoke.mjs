import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.NODE_ENV = 'test';
const { recoverWhppMembershipFromVerifiedBackups, inspectVerifiedWhppBackup } = await import('../src/whppMembershipRecovery.js');

function createCurrentDb(filePath, reportDate, expectedTotal = 236) {
  const db = new DatabaseSync(filePath);
  db.exec(`
    CREATE TABLE unified_import_batches(
      batchId TEXT PRIMARY KEY,
      snapshotId TEXT,
      reportDate TEXT,
      sourceName TEXT,
      status TEXT,
      createdAt TEXT
    );
    CREATE TABLE unified_import_rows(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batchId TEXT,
      businessType TEXT,
      shipmentCode TEXT
    );
    CREATE TABLE business_daily_reports(
      businessType TEXT,
      reportDate TEXT,
      sourceFile TEXT,
      totalCount INTEGER,
      summaryJson TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY(businessType,reportDate)
    );
    CREATE TABLE business_daily_parse_rows(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      businessType TEXT,
      reportDate TEXT,
      shipmentCode TEXT,
      sheetName TEXT,
      rowNumber INTEGER,
      source_row_number INTEGER,
      recipient_raw TEXT,
      recipient_normalized TEXT,
      recipient_group TEXT,
      recipient_group_reason TEXT,
      rawText TEXT,
      rowJson TEXT,
      createdAt TEXT
    );
    CREATE TABLE business_history_summary(
      businessType TEXT,
      reportDate TEXT,
      summaryJson TEXT,
      PRIMARY KEY(businessType,reportDate)
    );
    CREATE TABLE business_final_rows(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      businessType TEXT,
      reportDate TEXT,
      shipmentCode TEXT,
      rawJson TEXT
    );
  `);
  db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,status,createdAt)
    VALUES(?,?,?,?,?,?)`).run('B-CURRENT', 'S-CURRENT', reportDate, '2026-08-14.xlsx', 'VALID', '2026-08-14T23:00:00Z');
  db.prepare(`INSERT INTO business_history_summary(businessType,reportDate,summaryJson) VALUES('WHPP',?,?)`)
    .run(reportDate, JSON.stringify({ total: expectedTotal, today: expectedTotal }));
  return db;
}

function createBackupDb(filePath, reportDate, total = 236) {
  const db = new DatabaseSync(filePath);
  db.exec(`
    CREATE TABLE business_daily_reports(
      businessType TEXT,
      reportDate TEXT,
      sourceFile TEXT,
      totalCount INTEGER,
      summaryJson TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      PRIMARY KEY(businessType,reportDate)
    );
    CREATE TABLE business_daily_parse_rows(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      businessType TEXT,
      reportDate TEXT,
      shipmentCode TEXT,
      sheetName TEXT,
      rowNumber INTEGER,
      source_row_number INTEGER,
      recipient_raw TEXT,
      recipient_normalized TEXT,
      recipient_group TEXT,
      recipient_group_reason TEXT,
      rawText TEXT,
      rowJson TEXT,
      createdAt TEXT
    );
  `);
  db.prepare(`INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt)
    VALUES('WHPP',?,?,?,?,?,?)`).run(reportDate, 'WHPP_2026-08-14.xlsx', total, JSON.stringify({ total }), '2026-08-14T10:00:00Z', '2026-08-14T10:00:00Z');
  const insert = db.prepare(`INSERT INTO business_daily_parse_rows(
    businessType,reportDate,shipmentCode,sheetName,rowNumber,source_row_number,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,rawText,rowJson,createdAt
  ) VALUES('WHPP',?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (let i = 1; i <= total; i += 1) {
    const bill = `CE260814${String(i).padStart(6, '0')}`;
    const regionCode = i <= total / 2 ? 'PP' : 'PV';
    const raw = { shipmentCode: bill, 运单号: bill, businessType: 'WHPP', reportDate, regionCode, sheetName: '日报', rowNumber: i + 1 };
    insert.run(reportDate, bill, '日报', i + 1, i + 1, '', '', 'WHPP', 'SHIPMENT_PREFIX_CE', '', JSON.stringify(raw), '2026-08-14T10:00:00Z');
  }
  db.close();
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-whpp-recovery-'));
try {
  const reportDate = '2026-08-14';
  const currentPath = path.join(temp, 'current.db');
  const backupPath = path.join(temp, 'backup.db');
  createBackupDb(backupPath, reportDate, 236);
  const db = createCurrentDb(currentPath, reportDate, 236);

  // Production-shaped damage: normalized WHPP membership is zero, unified batch
  // also has zero WHPP rows, while only a partial final-fact subset survived.
  const insertFact = db.prepare(`INSERT INTO business_final_rows(businessType,reportDate,shipmentCode,rawJson) VALUES('WHPP',?,?,?)`);
  for (let i = 1; i <= 173; i += 1) {
    const bill = `CE260814${String(i).padStart(6, '0')}`;
    insertFact.run(reportDate, bill, JSON.stringify({ shipmentCode: bill }));
  }

  const inspected = inspectVerifiedWhppBackup(backupPath, reportDate, { currentDb: db });
  assert.equal(inspected.ok, true, 'verified backup must be accepted');
  assert.equal(inspected.rowCount, 236);
  assert.equal(inspected.expectedHistoryTotal, 236);
  assert.equal(inspected.residualFactCount, 173);
  assert.deepEqual(inspected.regionCounts, { PP: 118, PV: 118, UNKNOWN: 0 });

  const result = recoverWhppMembershipFromVerifiedBackups(reportDate, {
    db,
    candidates: [{ backupPath, name: '20260828-215500', manifest: { backupQuickCheck: 'ok', sourceStableDuringBackup: true } }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.repaired, true);
  assert.equal(result.total, 236);
  assert.deepEqual(result.regionCounts, { PP: 118, PV: 118, UNKNOWN: 0 });

  const restoredHeader = db.prepare(`SELECT totalCount,summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=?`).get(reportDate);
  assert.equal(Number(restoredHeader.totalCount || 0), 236);
  const restoredRows = Number(db.prepare(`SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?`).get(reportDate)?.count || 0);
  assert.equal(restoredRows, 236);
  const restoredPp = Number(db.prepare(`SELECT COUNT(*) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND json_extract(rowJson,'$.regionCode')='PP'`).get(reportDate)?.count || 0);
  const restoredPv = Number(db.prepare(`SELECT COUNT(*) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND json_extract(rowJson,'$.regionCode')='PV'`).get(reportDate)?.count || 0);
  assert.equal(restoredPp, 118);
  assert.equal(restoredPv, 118);

  // Repair is idempotent: once 236 members exist, another run must not rewrite them.
  const second = recoverWhppMembershipFromVerifiedBackups(reportDate, {
    db,
    candidates: [{ backupPath, name: '20260828-215500' }]
  });
  assert.equal(second.repaired, false);
  assert.equal(second.reason, 'STANDARD_WHPP_MEMBERSHIP_PRESENT');
  assert.equal(second.total, 236);

  db.close();

  // Safety gate: a backup with 236 members must be rejected if preserved history
  // says the real completed WHPP total was different.
  const mismatchPath = path.join(temp, 'mismatch.db');
  const mismatchDb = createCurrentDb(mismatchPath, reportDate, 235);
  const mismatch = inspectVerifiedWhppBackup(backupPath, reportDate, { currentDb: mismatchDb });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'WHPP_BACKUP_HISTORY_TOTAL_MISMATCH');
  mismatchDb.close();

  console.log('[WHPP_RECOVERY_SMOKE] PASS production-zero-membership -> restored 236 exact members · PP=118 PV=118 · partial final facts preserved · mismatch safety gate PASS');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
