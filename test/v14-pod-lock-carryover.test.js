import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v14-lock-'));
process.env.DATA_DIR = temp;
process.env.DB_FILE = path.join(temp, 'ce_qc_monitor.db');

const { saveUnifiedImport, getUnifiedProcessingQueue } = await import('../src/unifiedImportStore.js');
const { getDb } = await import('../src/db.js');

function parsed(reportDate, fileHash, bills) {
  const rows = bills.map((shipmentCode, index) => ({
    shipmentCode,
    businessType: 'CE',
    regionCode: 'PP',
    recipientRaw: 'NORMAL',
    recipientNormalized: 'NORMAL',
    sheetName: '日报',
    rowNumber: index + 2,
    classificationReason: '默认CE',
    classificationSource: 'DEFAULT',
    classificationMatchedValue: '',
    classificationWarning: '',
    reportDate
  }));
  return {
    reportDate,
    dateDetectionSource: '测试',
    dateCandidates: [{ date: reportDate, count: rows.length }],
    dateWasManuallyCorrected: false,
    containerFormat: 'OOXML_ZIP',
    fileHash,
    classificationCounts: { CE: rows.length, TBKH: 0, ALI1688: 0, SHOPEECN: 0, SHOPEEVN: 0 },
    regionCounts: { PP: rows.length, PV: 0, UNKNOWN: 0 },
    summary: { rawRows: rows.length, validUniqueWaybills: rows.length, duplicateRows: 0, missingWaybillRows: 0, missingRecipientWarnings: 0, classificationConflicts: 0 },
    rows,
    warnings: [],
    sheetDiagnostics: []
  };
}

test('V14 next-day import never reopens an existing POD lock or completed return', () => {
  const d1 = saveUnifiedImport(parsed('2026-08-06', 'hash-d1', ['LOCKPOD01', 'LOCKRET01', 'OPEN00001']), '8-6.xlsx');
  const db = getDb();
  db.prepare("UPDATE shipment_current_state SET state='POD',apiStatus='SUCCESS' WHERE shipmentCode='LOCKPOD01'").run();
  db.prepare("UPDATE carryover_open_items SET status='CLOSED',apiStatus='SUCCESS',closeReason='POD' WHERE shipmentCode='LOCKPOD01'").run();
  db.prepare("UPDATE shipment_current_state SET state='RETURN_COMPLETED',apiStatus='SUCCESS' WHERE shipmentCode='LOCKRET01'").run();
  db.prepare("UPDATE carryover_open_items SET status='CLOSED',apiStatus='SUCCESS',closeReason='RETURNED' WHERE shipmentCode='LOCKRET01'").run();

  const d2 = saveUnifiedImport(parsed('2026-08-07', 'hash-d2', ['LOCKPOD01', 'LOCKRET01', 'OPEN00001']), '8-7.xlsx');
  const podCurrent = db.prepare("SELECT state,apiStatus,reportDate,snapshotId FROM shipment_current_state WHERE shipmentCode='LOCKPOD01'").get();
  const retCurrent = db.prepare("SELECT state,apiStatus FROM shipment_current_state WHERE shipmentCode='LOCKRET01'").get();
  const podCarry = db.prepare("SELECT status,closeReason,lastReportDate,lastSnapshotId FROM carryover_open_items WHERE shipmentCode='LOCKPOD01'").get();
  const retCarry = db.prepare("SELECT status,closeReason FROM carryover_open_items WHERE shipmentCode='LOCKRET01'").get();
  const openCarry = db.prepare("SELECT status,closeReason,lastReportDate FROM carryover_open_items WHERE shipmentCode='OPEN00001'").get();

  assert.equal(podCurrent.state, 'POD');
  assert.equal(podCurrent.apiStatus, 'SUCCESS');
  assert.equal(podCurrent.reportDate, '2026-08-07');
  assert.equal(podCurrent.snapshotId, d2.snapshotId);
  assert.equal(retCurrent.state, 'RETURN_COMPLETED');
  assert.equal(retCurrent.apiStatus, 'SUCCESS');
  assert.equal(podCarry.status, 'CLOSED');
  assert.equal(podCarry.closeReason, 'POD');
  assert.equal(podCarry.lastReportDate, '2026-08-07');
  assert.equal(podCarry.lastSnapshotId, d2.snapshotId);
  assert.equal(retCarry.status, 'CLOSED');
  assert.equal(retCarry.closeReason, 'RETURNED');
  assert.equal(openCarry.status, 'OPEN');
  assert.equal(openCarry.closeReason, '');
  assert.equal(openCarry.lastReportDate, '2026-08-07');

  const queue = getUnifiedProcessingQueue(d2.batchId);
  assert.deepEqual(queue.rows.map(row => row.shipmentCode), ['OPEN00001']);
  assert.equal(d1.reportDate, '2026-08-06');
});