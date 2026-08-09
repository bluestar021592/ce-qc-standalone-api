import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-pending-gap-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'pending-gap.db');

const { analyzeShipment } = await import('../src/analyzer.js');
const { analyzeShopeeShipment } = await import('../src/shopeeAnalyzer.js');
const { buildDashboardData } = await import('../src/reporting.js');
const { closeDb } = await import('../src/db.js');

const ceBill = 'CCPENDINGGAP001';
const shopeeBill = 'SPEPENDINGGAP001';

function ev(shipmentCode, code, time, text = '') {
  return { shipmentCode, eventCode: String(code || ''), eventTime: time, trackingEventDescZh: text };
}

function ceAnalyze(events, scanRow = { shipmentCode: ceBill, orderStatus: '70' }) {
  return analyzeShipment({
    waybill: ceBill,
    scanRow,
    events,
    reportDate: '2026-08-10'
  });
}

function shopeeAnalyze(events, scanRow = { shipmentCode: shopeeBill, orderStatus: '70' }) {
  return analyzeShopeeShipment({
    waybill: shopeeBill,
    scanRow,
    events,
    reportDate: '2026-08-10',
    analysisDate: '2026-08-10',
    dailyRow: { recipient_group: 'VN', regionCode: 'PP' },
    apiStatus: { shipment: 'success', event: 'success', exception: 'success' }
  });
}

function gapEvents(bill) {
  return [
    ev(bill, '150', '2026-08-07 09:00:00', 'Pending 无法联系'),
    ev(bill, '150', '2026-08-07 18:00:00', 'Pending 同一天再次更新'),
    ev(bill, '60', '2026-08-08 10:00:00', '中间出现新的派件动作'),
    ev(bill, '150', '2026-08-09 09:00:00', 'Pending 再次发生')
  ];
}

test('CE same-day duplicate Pending counts one day and date gap is independently non-continuous', () => {
  const row = ceAnalyze(gapEvents(ceBill));
  assert.deepEqual(row.pendingDates, ['2026-08-07', '2026-08-09']);
  assert.equal(row.pendingDistinctDayCount, 2);
  assert.equal(row.pendingRawEventCount, 3);
  assert.equal(row.Pending次数, 1, 'current Pending episode remains one day after the intervening action');
  assert.equal(row.primaryCategory, 'Pending1次');
  assert.equal(row.Pending不连续, '是', 'gap history is an independent unresolved QC fact');
  assert.equal(row.Pending事实连续性, '不连续');
});

test('CE terminal and special latest nodes suppress ordinary Pending non-continuity', () => {
  const pod = ceAnalyze([...gapEvents(ceBill), ev(ceBill, '80', '2026-08-10 09:00:00', 'POD')]);
  assert.equal(pod.是否POD, '是');
  assert.equal(pod.Pending不连续, '否');

  const returned = ceAnalyze([...gapEvents(ceBill), ev(ceBill, '86', '2026-08-10 09:00:00', '退回完成')]);
  assert.equal(returned.退回状态, '已退回');
  assert.equal(returned.Pending不连续, '否');

  const retention580 = ceAnalyze([...gapEvents(ceBill), ev(ceBill, '26', '2026-08-10 09:00:00', '货物到达网点【CEL:CCSL580】')]);
  assert.equal(retention580.specialState, 'CCSL580_RETENTION');
  assert.equal(retention580.Pending不连续, '否');
});

test('Shopee uses the same Phnom Penh day-gap rule for Pending non-continuity', () => {
  const row = shopeeAnalyze(gapEvents(shopeeBill));
  assert.deepEqual(row.pendingDates, ['2026-08-07', '2026-08-09']);
  assert.equal(row.pendingDistinctDayCount, 2);
  assert.equal(row.pendingRawEventCount, 3);
  assert.equal(row.Pending当前次数, 1);
  assert.equal(row.Pending不连续, '是');
  assert.equal(row.Pending事实连续性, '不连续');
});

test('Shopee historical track POD/return do not override a later valid Pending event', () => {
  const historicalPod = shopeeAnalyze([
    ev(shopeeBill, '80', '2026-08-07 09:00:00', '历史POD'),
    ev(shopeeBill, '150', '2026-08-09 09:00:00', '更晚Pending')
  ]);
  assert.equal(historicalPod.是否POD, '否');
  assert.equal(historicalPod.currentState, 'PENDING');
  assert.match(historicalPod.primaryCategory, /^Pending/);
  assert.equal(historicalPod.latestEffectiveEventCode, '150');

  const historicalReturn = shopeeAnalyze([
    ev(shopeeBill, '86', '2026-08-07 09:00:00', '历史退回完成'),
    ev(shopeeBill, '150', '2026-08-09 09:00:00', '更晚Pending')
  ]);
  assert.notEqual(historicalReturn.退回状态, '已退回');
  assert.equal(historicalReturn.currentState, 'PENDING');
  assert.equal(historicalReturn.latestEffectiveEventCode, '150');
});

test('Shopee scan orderStatus 85 remains POD lock regardless of later track text', () => {
  const row = shopeeAnalyze(
    [ev(shopeeBill, '150', '2026-08-09 09:00:00', 'Pending')],
    { shipmentCode: shopeeBill, orderStatus: '85' }
  );
  assert.equal(row.是否POD, '是');
  assert.equal(row.currentState, 'POD');
  assert.equal(row.Pending不连续, '否');
});

test('reporting counts the independent Pending non-continuity flag even when current Pending episode is one day', () => {
  const row = ceAnalyze(gapEvents(ceBill));
  const dashboard = buildDashboardData({
    reportDate: '2026-08-10',
    pnhBills: [ceBill],
    scanPool: [ceBill],
    scanResults: [{ 运单号: ceBill, shipmentCode: ceBill, 是否POD: '否' }],
    trackResults: [row],
    finalRows: [row],
    carryBills: [ceBill],
    nextCarryBills: [ceBill],
    podLocks: []
  });
  assert.equal(dashboard.categories.pending1, 1);
  assert.equal(dashboard.categories.pendingNonContinuous, 1);
});

test.after(() => {
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
