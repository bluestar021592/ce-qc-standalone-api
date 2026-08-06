import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShopeeDashboard } from '../src/shopeeReporting.js';

const row = (shipmentCode, currentState, extra = {}) => ({
  shipmentCode,
  reportDate: '2026-07-01',
  recipient_group: 'VN',
  regionCode: 'PP',
  currentState,
  POD状态: currentState === 'POD' ? 'POD' : '未POD',
  是否POD: currentState === 'POD' ? '是' : '否',
  退回状态: currentState === 'RETURN_COMPLETED' ? '已退回' : '',
  finalRowAvailable: true,
  ...extra
});

test('Shopee accounting explicitly balances POD, returned and unresolved bills', () => {
  const rows = [row('SPE-POD', 'POD', { lastCheckedAt: '2026-07-01 20:00:00' }), row('SPE-RETURN', 'RETURN_COMPLETED'), row('SPE-OPEN', 'OPEN_TRACK_REQUIRED')];
  const view = buildShopeeDashboard({ reportDate: '2026-07-01', pnhBills: rows.map(item => item.shipmentCode), finalRows: rows });
  assert.deepEqual({ total: view.recipientGroups.VN.metrics.total, pod: view.recipientGroups.VN.metrics.pod, returned: view.recipientGroups.VN.metrics.returned, unresolved: view.recipientGroups.VN.metrics.unresolved, difference: view.recipientGroups.VN.metrics.accountingDifference }, { total: 3, pod: 1, returned: 1, unresolved: 1, difference: 0 });
});

test('dispatch day increments at Phnom Penh midnight and only counts POD closures', () => {
  const rows = [
    row('SPE-D1', 'POD', { POD时间: '2026-07-01 23:59:00' }),
    row('SPE-D2', 'POD', { POD时间: '2026-07-02 00:01:00' }),
    row('SPE-D3', 'POD', { POD时间: '2026-07-03 08:00:00' }),
    row('SPE-OPEN', 'OPEN_TRACK_REQUIRED', { analysisDate: '2026-07-03' })
  ];
  const view = buildShopeeDashboard({ reportDate: '2026-07-01', pnhBills: rows.map(item => item.shipmentCode), finalRows: rows });
  const pp = view.regions.PP;
  assert.deepEqual([pp.dispatchAttempt1Count, pp.dispatchAttempt2Count, pp.dispatchAttempt3Count, pp.dispatchAttemptDenominator], [1, 1, 1, 4]);
  assert.deepEqual([pp.dispatchAttempt1Rate, pp.dispatchAttempt2Rate, pp.dispatchAttempt3Rate], [25, 25, 25]);
  assert.deepEqual([
    view.recipientGroups.VN.metrics.dispatchAttempt1,
    view.recipientGroups.VN.metrics.dispatchAttempt2,
    view.recipientGroups.VN.metrics.dispatchAttempt3,
    view.recipientGroups.VN.metrics.dispatchAttemptDenominator
  ], [1, 1, 1, 4]);
});

test('588 tickets reconcile without losing the three unresolved shipments', () => {
  const rows = [
    ...Array.from({ length: 542 }, (_, index) => row(`POD-${index}`, 'POD', { POD时间: '2026-07-01 18:00:00' })),
    ...Array.from({ length: 43 }, (_, index) => row(`RETURN-${index}`, 'RETURN_COMPLETED')),
    row('SPE260628000304', 'OPEN_TRACK_REQUIRED', { primaryCategory: '严重超时未更新' }),
    row('SPE260625000338', 'OPEN_TRACK_REQUIRED', { primaryCategory: '严重超时未更新' }),
    row('SPE260626000322', 'OPEN_TRACK_REQUIRED', { primaryCategory: '盘点1天' })
  ];
  const view = buildShopeeDashboard({ reportDate: '2026-07-01', pnhBills: rows.map(item => item.shipmentCode), finalRows: rows });
  const metrics = view.recipientGroups.VN.metrics;
  assert.deepEqual({ total: metrics.total, pod: metrics.pod, returned: metrics.returned, unresolved: metrics.unresolved, difference: metrics.accountingDifference }, { total: 588, pod: 542, returned: 43, unresolved: 3, difference: 0 });
});

test('dispatch attempts are isolated to CN/VN and PP/PV dimensions', () => {
  const rows = [
    row('CN-PP-D1', 'POD', { recipient_group: 'CN', regionCode: 'PP', POD时间: '2026-07-01 18:00:00' }),
    row('CN-PV-D2', 'POD', { recipient_group: 'CN', regionCode: 'PV', POD时间: '2026-07-02 08:00:00' }),
    row('VN-PP-D3', 'POD', { recipient_group: 'VN', regionCode: 'PP', POD时间: '2026-07-03 08:00:00' }),
    row('VN-PV-OPEN', 'OPEN_TRACK_REQUIRED', { recipient_group: 'VN', regionCode: 'PV' }),
    row('CE-NOT-SHOPEE', 'POD', { recipient_group: 'CE', regionCode: 'PP', POD时间: '2026-07-01 10:00:00' })
  ];
  const view = buildShopeeDashboard({ reportDate: '2026-07-01', pnhBills: rows.map(item => item.shipmentCode), finalRows: rows });

  assert.deepEqual([
    view.recipientGroups.CN.regions.PP.dispatchAttempt1Count,
    view.recipientGroups.CN.regions.PV.dispatchAttempt2Count,
    view.recipientGroups.VN.regions.PP.dispatchAttempt3Count,
    view.recipientGroups.VN.regions.PV.dispatchAttemptDenominator
  ], [1, 1, 1, 1]);
  assert.equal(view.recipientGroups.CN.metrics.total, 2);
  assert.equal(view.recipientGroups.VN.metrics.total, 2);
  assert.equal(view.recipientGroups.ALL.metrics.total, 4);
});
