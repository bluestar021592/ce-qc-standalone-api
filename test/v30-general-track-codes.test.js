import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeShipment } from '../src/analyzer.js';

const bill = 'CE26080900001';
const scanRow = { shipmentCode: bill, orderStatus: 70 };
const reportDate = '2026-08-09';

function event(eventCode, eventTime, extra = {}) {
  return { shipmentCode: bill, eventCode: String(eventCode), eventTime, ...extra };
}
function analyze(events, extra = {}) {
  return analyzeShipment({ waybill: bill, scanRow, events, reportDate, ...extra });
}

test('general track 26 latest means pickup success normal flow, not CCSL inbound-no-scan', () => {
  const row = analyze([event('26', '2026-08-09 08:00:00')]);
  assert.equal(row.currentState, 'PICKUP_SUCCESS');
  assert.equal(row.primaryCategory, '正常流转');
  assert.equal(row.入库无扫描节点, '否');
});

test('general track 30/32 latest means cycle count and clears prior 26', () => {
  for (const code of ['30', '32']) {
    const row = analyze([event('26', '2026-08-08 08:00:00'), event(code, '2026-08-09 08:00:00')]);
    assert.equal(row.currentState, 'CYCLE_COUNT');
    assert.match(row.primaryCategory, /^盘点/);
    assert.equal(row.入库无扫描节点, '否');
    assert.equal(row.Pending次数, 0);
  }
});

test('general same-day repeated 150 is exactly one Pending natural day', () => {
  const row = analyze([event('150', '2026-08-09 08:00:00'), event('150', '2026-08-09 12:00:00'), event('150', '2026-08-09 18:00:00')]);
  assert.equal(row.currentState, 'PENDING');
  assert.equal(row.Pending次数, 1);
  assert.equal(row.pendingRawEventCount, 3);
  assert.equal(row.pendingDistinctDayCount, 1);
  assert.equal(row.primaryCategory, 'Pending1次');
});

test('general Pending count uses actual 150 dates, not elapsed days', () => {
  const row = analyzeShipment({ waybill: bill, scanRow, events: [event('150', '2026-08-05 08:00:00')], reportDate: '2026-08-09' });
  assert.equal(row.Pending次数, 1);
  assert.equal(row.primaryCategory, 'Pending1次');
});

test('general newer 99 work order clears historical Pending current-state anomaly', () => {
  const row = analyze([event('150', '2026-08-07 08:00:00'), event('150', '2026-08-08 08:00:00'), event('99', '2026-08-09 08:00:00')]);
  assert.equal(row.currentState, 'WORK_ORDER');
  assert.equal(row.primaryCategory, '工单未处理');
  assert.equal(row.Pending次数, 0);
  assert.doesNotMatch(row.primaryCategory, /Pending/);
});

test('general track 80 is POD terminal and clears ordinary anomaly counters', () => {
  const row = analyze([event('150', '2026-08-07 08:00:00'), event('30', '2026-08-08 08:00:00'), event('80', '2026-08-09 08:00:00')]);
  assert.equal(row.currentState, 'POD');
  assert.equal(row.是否POD, '是');
  assert.equal(row.primaryCategory, 'POD闭环');
  assert.equal(row.Pending次数, 0);
  assert.equal(row.OC天数, 0);
  assert.equal(row.盘点天数, 0);
  assert.equal(row.入库无扫描节点, '否');
  assert.equal(row.carry状态, 'closed_pod');
});

test('general 84 is return-in-progress and 86 is normal completed return', () => {
  const progress = analyze([event('150', '2026-08-07 08:00:00'), event('84', '2026-08-09 08:00:00')]);
  assert.equal(progress.currentState, 'RETURN_IN_PROGRESS');
  assert.equal(progress.退回状态, '退回处理中');
  assert.equal(progress.primaryCategory, '退回处理中');
  assert.equal(progress.Pending次数, 0);
  const completed = analyze([event('84', '2026-08-08 08:00:00'), event('86', '2026-08-09 08:00:00')]);
  assert.equal(completed.currentState, 'RETURN_COMPLETED');
  assert.equal(completed.退回状态, '已退回');
  assert.equal(completed.primaryCategory, '退回');
  assert.equal(completed.carry状态, 'closed_return');
});

test('general broad signed text without code 80 does not fabricate POD terminal', () => {
  const row = analyze([event('', '2026-08-09 08:00:00', { trackingEventDescZh: '已签收测试文字但没有状态码80' })]);
  assert.equal(row.是否POD, '否');
  assert.notEqual(row.currentState, 'POD');
  assert.notEqual(row.primaryCategory, 'POD闭环');
});
