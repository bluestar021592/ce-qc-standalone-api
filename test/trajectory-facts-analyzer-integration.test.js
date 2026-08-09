import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-trajectory-analyzer-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'analyzer.db');

const { analyzeShipment } = await import('../src/analyzer.js');
const { closeDb } = await import('../src/db.js');

const bill = 'CCFACTINT001';
const scanRow = { shipmentCode: bill, orderStatus: '70' };

function e(code, time, text = '') {
  return { shipmentCode: bill, eventCode: code, eventTime: time, trackingEventDescZh: text };
}

test('analyzer does not let historical POD override a later Pending node', () => {
  const row = analyzeShipment({
    waybill: bill,
    scanRow,
    reportDate: '2026-08-09',
    events: [
      e('80', '2026-08-07 10:00:00', '历史POD'),
      e('150', '2026-08-09 10:00:00', '最新Pending')
    ]
  });

  assert.equal(row.是否POD, '否');
  assert.equal(row.currentState, 'PENDING');
  assert.match(row.primaryCategory, /^Pending/);
  assert.equal(row.latestEffectiveEventCode, '150');
});

test('analyzer does not let historical completed return override a later Pending node', () => {
  const row = analyzeShipment({
    waybill: bill,
    scanRow,
    reportDate: '2026-08-09',
    events: [
      e('86', '2026-08-07 10:00:00', '历史退回完成'),
      e('150', '2026-08-09 10:00:00', '最新Pending')
    ]
  });

  assert.notEqual(row.currentState, 'RETURN_COMPLETED');
  assert.notEqual(row.退回状态, '已退回');
  assert.equal(row.currentState, 'PENDING');
  assert.equal(row.latestEffectiveEventCode, '150');
});

test('analyzer suppresses historical 580 once a newer valid node exists', () => {
  const row = analyzeShipment({
    waybill: bill,
    scanRow,
    reportDate: '2026-08-09',
    events: [
      e('26', '2026-08-08 10:00:00', '货物到达网点【CE:580】'),
      e('150', '2026-08-09 10:00:00', '最新Pending')
    ]
  });

  assert.notEqual(row.currentState, 'CCSL580_RETENTION');
  assert.notEqual(row.primaryCategory, 'CCSL580_RETENTION');
  assert.equal(row.currentState, 'PENDING');
});

test('analyzer preserves scan POD lock even when track evidence is newer', () => {
  const row = analyzeShipment({
    waybill: bill,
    scanRow: { shipmentCode: bill, orderStatus: '85' },
    reportDate: '2026-08-09',
    events: [e('150', '2026-08-09 10:00:00', '轨迹Pending')]
  });

  assert.equal(row.是否POD, '是');
  assert.equal(row.currentState, 'POD');
  assert.equal(row.trajectoryTerminalSource, 'SCAN_ORDER_STATUS_85');
});

test.after(() => {
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
