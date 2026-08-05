import crypto from 'crypto';
import { getDb, nowIso } from './db.js';

export function saveUnifiedImport(parsed, sourceName) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM unified_import_batches WHERE reportDate=? AND fileHash=? AND status=? ORDER BY createdAt DESC LIMIT 1').get(parsed.reportDate, parsed.fileHash, 'VALID');
  if (existing) return hydrateBatch(existing, true);
  const batchId = `BATCH-${crypto.randomUUID()}`;
  const snapshotId = `SNAP-${crypto.randomUUID()}`;
  const createdAt = nowIso();
  const payload = { reportDate: parsed.reportDate, classificationCounts: parsed.classificationCounts, summary: parsed.summary, rows: parsed.rows };
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,'VALID',?,?,?)`)
      .run(batchId, snapshotId, parsed.reportDate, sourceName, parsed.fileHash, JSON.stringify(parsed.summary), JSON.stringify(parsed.warnings), createdAt);
    const insertRow = db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of parsed.rows) insertRow.run(batchId, snapshotId, parsed.reportDate, row.businessType, row.shipmentCode, row.regionCode, row.recipientRaw, row.recipientNormalized, row.sheetName, row.rowNumber, row.classificationReason, JSON.stringify(row), createdAt);
    db.prepare(`INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,'IMPORTED',?,?)`).run(snapshotId, batchId, parsed.reportDate, JSON.stringify(payload), createdAt);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { batchId, snapshotId, reportDate: parsed.reportDate, fileHash: parsed.fileHash, classificationCounts: parsed.classificationCounts, summary: parsed.summary, warnings: parsed.warnings, duplicateFile: false };
}

export function getLatestUnifiedImport() {
  const row = getDb().prepare("SELECT * FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC LIMIT 1").get();
  return row ? hydrateBatch(row, false) : null;
}

function hydrateBatch(row, duplicateFile) {
  const counts = getDb().prepare('SELECT businessType, COUNT(*) count FROM unified_import_rows WHERE batchId=? GROUP BY businessType').all(row.batchId);
  return {
    batchId: row.batchId, snapshotId: row.snapshotId, reportDate: row.reportDate, fileHash: row.fileHash,
    classificationCounts: Object.assign({ CE: 0, TBKH: 0, ALI1688: 0, SHOPEECN: 0, SHOPEEVN: 0 }, Object.fromEntries(counts.map(item => [item.businessType, Number(item.count)]))),
    summary: JSON.parse(row.summaryJson || '{}'), warnings: JSON.parse(row.warningsJson || '[]'), duplicateFile
  };
}
