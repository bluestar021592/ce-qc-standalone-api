import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-final-facade-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'facade.db');

const { analyzeShipment } = await import('../src/analyzer.js');
const { analyzeShopeeShipment } = await import('../src/shopeeAnalyzer.js');
const { closeDb } = await import('../src/db.js');

const ev = (code, time, text = '') => ({ eventCode: String(code), eventTime: time, trackingEventDesc: text, trackingEventDescZh: text });

test('historical track POD followed by newer Pending stays open and trackable in final CCSL facade', () => {
  const result = analyzeShipment({
    waybill: 'CCSL-HIST-POD',
    scanRow: { orderStatus: '70' },
    reportDate: '2026-08-10',
    events: [ev('80', '2026-08-09 10:00:00', 'POD'), ev('150', '2026-08-10 10:00:00', 'Pending')]
  });
  assert.equal(result.是否POD, '否');
  assert.equal(result.currentState, 'PENDING');
  assert.equal(result.carry状态, 'active');
  assert.equal(result.跨日状态, '未闭环');
  assert.equal(result.trackRequired, true);
});

test('latest exact POD closes final CCSL facade', () => {
  const result = analyzeShipment({
    waybill: 'CCSL-POD', scanRow: { orderStatus: '70' }, reportDate: '2026-08-10',
    events: [ev('150', '2026-08-09 10:00:00', 'Pending'), ev('80', '2026-08-10 10:00:00', 'POD')]
  });
  assert.equal(result.是否POD, '是');
  assert.equal(result.carry状态, 'closed_pod');
  assert.equal(result.跨日状态, '已闭环');
  assert.equal(result.trackRequired, false);
});

test('Shopee final facade rebuilds carry flags from scan/latest terminal facts', () => {
  const open = analyzeShopeeShipment({
    waybill: 'SHOPEE-HIST-POD', scanRow: { orderStatus: '70' }, shipmentTrackRow: {}, dailyRow: {},
    reportDate: '2026-08-10', analysisDate: '2026-08-10', exceptions: [],
    events: [ev('80', '2026-08-09 10:00:00', 'POD'), ev('150', '2026-08-10 10:00:00', 'Pending')]
  });
  assert.equal(open.是否POD, '否');
  assert.equal(open.carry状态, 'active');
  assert.equal(open.跨日状态, '未闭环');
  assert.equal(open.trackRequired, true);

  const closed = analyzeShopeeShipment({
    waybill: 'SHOPEE-POD', scanRow: { orderStatus: '70' }, shipmentTrackRow: {}, dailyRow: {},
    reportDate: '2026-08-10', analysisDate: '2026-08-10', exceptions: [],
    events: [ev('150', '2026-08-09 10:00:00', 'Pending'), ev('80', '2026-08-10 10:00:00', 'POD')]
  });
  assert.equal(closed.是否POD, '是');
  assert.equal(closed.carry状态, 'closed_pod');
  assert.equal(closed.trackRequired, false);
});

test.after(() => {
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
