import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyScanTerminal } from '../src/scanTerminal.js';
import { analyzeShopeeShipment } from '../src/shopeeAnalyzer.js';

const bill = 'TEST26080900001';
function scan(orderStatus, extra = {}) { return { shipmentCode: bill, orderStatus, ...extra }; }
function event(code, eventTime, extra = {}) { return { shipmentCode: bill, eventCode: String(code), eventTime, ...extra }; }
function analyze({ orderStatus = '70', events = [], exceptions = [], analysisDate = '2026-08-09' } = {}) {
  return analyzeShopeeShipment({
    waybill: bill, scanRow: scan(orderStatus), shipmentTrackRow: {}, events, exceptions,
    reportDate: '2026-08-09', analysisDate,
    dailyRow: { shipmentCode: bill, recipient_group: 'VN' },
    apiStatus: { shipment: 'success', event: 'success', exception: 'success' }
  });
}

test('confirm-query scan gate uses orderStatus only', () => {
  for (const status of ['50', '60', '70']) {
    const result = classifyScanTerminal(scan(status, { statusCode: 'P4008', shipmentStatus: 'R', statusText: 'POD returned 已退回' }), 'success');
    assert.equal(result.currentState, 'OPEN_TRACK_REQUIRED');
    assert.equal(result.trackRequired, true);
  }
  const pod = classifyScanTerminal(scan('85'), 'success');
  assert.equal(pod.currentState, 'POD'); assert.equal(pod.trackRequired, false);
  const returned = classifyScanTerminal(scan('100'), 'success');
  assert.equal(returned.currentState, 'RETURN_COMPLETED'); assert.equal(returned.trackRequired, false);
});

test('tracking 26 latest is pickup success normal flow, not inbound-no-scan', () => {
  const result = analyze({ events: [event('26', '2026-08-09T08:00:00+07:00')] });
  assert.equal(result.currentState, 'PICKUP_SUCCESS');
  assert.equal(result.primaryCategory, '正常流转');
  assert.equal(result.入库无扫描节点, '否');
});

test('tracking 30 or 32 is cycle count and closes prior 26 state', () => {
  for (const code of ['30', '32']) {
    const result = analyze({ events: [event('26', '2026-08-08T08:00:00+07:00'),event(code, '2026-08-09T08:00:00+07:00')] });
    assert.equal(result.currentState, 'CYCLE_COUNT');
    assert.match(result.primaryCategory, /^盘点/);
    assert.equal(result.入库无扫描节点, '否');
    assert.equal(result.Pending当前次数, 0);
  }
});

test('same-day repeated 150 counts as one Pending natural day', () => {
  const result = analyze({ events: [event('150','2026-08-09T08:00:00+07:00'),event('150','2026-08-09T12:00:00+07:00'),event('150','2026-08-09T18:00:00+07:00')] });
  assert.equal(result.currentState, 'PENDING');
  assert.equal(result.Pending当前次数, 1);
  assert.equal(result.pendingRawEventCount, 3);
  assert.equal(result.pendingDistinctDayCount, 1);
  assert.equal(result.primaryCategory, 'Pending1次');
});

test('150 on three distinct dates counts 3 Pending days and detects discontinuity', () => {
  const result = analyze({ events: [event('150','2026-08-05T08:00:00+07:00'),event('150','2026-08-06T08:00:00+07:00'),event('150','2026-08-08T08:00:00+07:00')] });
  assert.equal(result.Pending当前次数, 3);
  assert.equal(result.Pending不连续, '是');
  assert.equal(result.Pending连续, '否');
  assert.equal(result.primaryCategory, 'Pending3次及以上');
});

test('historical Pending is cleared by a newer effective node', () => {
  const result = analyze({ events: [event('150','2026-08-07T08:00:00+07:00'),event('150','2026-08-08T08:00:00+07:00'),event('30','2026-08-09T08:00:00+07:00')] });
  assert.equal(result.currentState, 'CYCLE_COUNT');
  assert.equal(result.Pending当前次数, 0);
  assert.equal(result.Pending状态, '否');
  assert.doesNotMatch(result.primaryCategory, /Pending/);
});

test('tracking 99 latest is work-order current state', () => {
  const result = analyze({ events: [event('26','2026-08-08T08:00:00+07:00'),event('99','2026-08-09T08:00:00+07:00')] });
  assert.equal(result.currentState, 'WORK_ORDER');
  assert.equal(result.primaryCategory, '工单状态');
  assert.equal(result.入库无扫描节点, '否');
});

test('tracking 80 closes POD regardless of historical anomalies', () => {
  const result = analyze({ events: [event('150','2026-08-07T08:00:00+07:00'),event('30','2026-08-08T08:00:00+07:00'),event('80','2026-08-09T08:00:00+07:00')] });
  assert.equal(result.currentState, 'POD');
  assert.equal(result.是否POD, '是');
  assert.equal(result.primaryCategory, 'POD');
  assert.equal(result.carry状态, 'closed_pod');
  assert.equal(result.Pending当前次数, 0);
  assert.equal(result.OC天数, 0);
  assert.equal(result.盘点天数, 0);
  assert.equal(result.入库无扫描节点, '否');
});

test('tracking 84 is return in progress; 86 is normal completed return', () => {
  const inProgress = analyze({ events: [event('150','2026-08-07T08:00:00+07:00'),event('84','2026-08-09T08:00:00+07:00')] });
  assert.equal(inProgress.currentState, 'RETURN_IN_PROGRESS');
  assert.equal(inProgress.退回状态, '退回处理中');
  assert.equal(inProgress.primaryCategory, '退回处理中');
  assert.equal(inProgress.Pending当前次数, 0);
  const completed = analyze({ events: [event('84','2026-08-08T08:00:00+07:00'),event('86','2026-08-09T08:00:00+07:00')] });
  assert.equal(completed.currentState, 'RETURN_COMPLETED');
  assert.equal(completed.退回状态, '已退回');
  assert.equal(completed.primaryCategory, '退回');
  assert.equal(completed.carry状态, 'closed_return');
  assert.equal(completed.Pending当前次数, 0);
});

test('legacy code 81 alone is not treated as the locked completed-return code', () => {
  const result = analyze({ events: [event('81', '2026-08-09T08:00:00+07:00', { trackingEventDescZh: '旧描述退回完成' })] });
  assert.notEqual(result.currentState, 'RETURN_COMPLETED');
  assert.notEqual(result.退回状态, '已退回');
});
