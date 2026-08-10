import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-pending-facts-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'pending-facts.db');

const { analyzeShipment } = await import('../src/analyzer.js');
const { closeDb } = await import('../src/db.js');

const bill = 'CCPENDINGFACT001';
const scanRow = { shipmentCode: bill, orderStatus: '70' };

function e(code, time, text = '') {
  return { shipmentCode: bill, eventCode: code, eventTime: time, trackingEventDescZh: text };
}

test('same-day duplicate Pending events count once and separated dates are non-continuous', () => {
  const row = analyzeShipment({
    waybill: bill,
    scanRow,
    reportDate: '2026-08-09',
    events: [
      e('150', '2026-08-07 09:00:00', 'Pending A'),
      e('150', '2026-08-07 18:00:00', 'Pending A same day'),
      e('26', '2026-08-08 10:00:00', 'intermediate valid node'),
      e('150', '2026-08-09 10:00:00', 'latest Pending')
    ]
  });

  assert.equal(row.currentState, 'PENDING');
  assert.equal(row.Pending次数, 2);
  assert.equal(row.Pending天数, 2);
  assert.equal(row.Pending日期, '2026-08-07, 2026-08-09');
  assert.equal(row.Pending连续性, '不连续');
  assert.equal(row.pendingDistinctDayCount, 2);
  assert.deepEqual(row.pendingDates, ['2026-08-07', '2026-08-09']);
  assert.equal(row.pendingRawEventCount, 3);
  assert.match(row.primaryCategory, /^Pending2/);
});

test('Pending continuity follows distinct calendar dates even when another event sits between them', () => {
  const row = analyzeShipment({
    waybill: bill,
    scanRow,
    reportDate: '2026-08-08',
    events: [
      e('150', '2026-08-07 09:00:00', 'Pending day 1'),
      e('26', '2026-08-07 12:00:00', 'other valid event same day'),
      e('150', '2026-08-08 10:00:00', 'Pending day 2')
    ]
  });

  assert.equal(row.currentState, 'PENDING');
  assert.equal(row.Pending次数, 2);
  assert.equal(row.Pending连续性, '连续');
  assert.equal(row.Pending日期, '2026-08-07, 2026-08-08');
  assert.match(row.primaryCategory, /^Pending2/);
});

test('historical Pending facts remain available but do not create current Pending after a newer non-Pending node', () => {
  const row = analyzeShipment({
    waybill: bill,
    scanRow,
    reportDate: '2026-08-09',
    events: [
      e('150', '2026-08-07 09:00:00', 'historical Pending'),
      e('26', '2026-08-09 10:00:00', 'latest inbound-no-scan')
    ]
  });

  assert.notEqual(row.currentState, 'PENDING');
  assert.equal(row.currentState, 'INBOUND_NO_SCAN');
  assert.equal(row.Pending次数, 0);
  assert.equal(row.Pending天数, 0);
  assert.equal(row.Pending日期, '');
  assert.equal(row.pendingDistinctDayCount, 1);
  assert.deepEqual(row.pendingDates, ['2026-08-07']);
});

test.after(() => {
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
