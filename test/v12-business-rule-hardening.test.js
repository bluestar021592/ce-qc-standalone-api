import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyScanTerminal } from '../src/scanTerminal.js';
import { analyzeShipment } from '../src/analyzer.js';
import { analyzeShopeeShipment } from '../src/shopeeAnalyzer.js';
import { buildDashboardData } from '../src/reporting.js';
import { runQcPipeline } from '../src/pipeline.js';

test('V12 scan layer uses only confirm-query orderStatus; track-layer labels never close scan', () => {
  for (const orderStatus of [50, 60, 70]) {
    const result = classifyScanTerminal({
      shipmentCode: `OPEN${orderStatus}`,
      orderStatus,
      statusCode: 'P4008',
      shipmentStatus: 'Y',
      statusText: '已退回 POD'
    }, 'success');
    assert.equal(result.currentState, 'OPEN_TRACK_REQUIRED');
    assert.equal(result.trackRequired, true);
  }

  const pod = classifyScanTerminal({ shipmentCode: 'POD85', orderStatus: 85 }, 'success');
  assert.equal(pod.currentState, 'POD');
  assert.equal(pod.trackRequired, false);

  const returned = classifyScanTerminal({ shipmentCode: 'RET100', orderStatus: 100 }, 'success');
  assert.equal(returned.currentState, 'RETURN_COMPLETED');
  assert.equal(returned.trackRequired, false);

  const p4008 = classifyScanTerminal({ shipmentCode: 'P4008', orderStatus: 70, statusCode: 'P4008' }, 'success');
  const p4007 = classifyScanTerminal({ shipmentCode: 'P4007', orderStatus: 70, statusCode: 'P4007' }, 'success');
  assert.equal(p4008.trackRequired, true);
  assert.equal(p4007.trackRequired, true);
});

test('V12 unresolved explicit work order is classified as 工单未处理', () => {
  const row = analyzeShipment({ waybill: 'CCWORK12', reportDate: '2026-08-07', events: [
    { shipmentCode: 'CCWORK12', eventCode: '99', eventTime: '2026-08-07 10:00:00', trackingEventDescZh: '备注:Work order:客户投诉待处理' }
  ] });
  assert.equal(row.primaryCategory, '工单未处理');
  assert.equal(row.matchedRule, 'WORK_ORDER_UNPROCESSED');
});

test('V12 special latest nodes are not abnormalities and are removed from dashboard next carry', () => {
  const finalRows = [
    { 运单号: 'SP1', 是否POD: '否', specialState: 'SELF_PICKUP', primaryCategory: 'SELF_PICKUP' },
    { 运单号: 'SP2', 是否POD: '否', specialState: 'CECN_RETENTION', primaryCategory: 'CECN_RETENTION' },
    { 运单号: 'SP3', 是否POD: '否', specialState: 'CEZT_RETENTION', primaryCategory: 'CEZT_RETENTION' },
    { 运单号: 'SP4', 是否POD: '否', specialState: 'CCSL580_RETENTION', primaryCategory: 'CCSL580_RETENTION' }
  ];
  const dashboard = buildDashboardData({ pnhBills: ['SP1','SP2','SP3','SP4'], scanPool: ['SP1','SP2','SP3','SP4'], finalRows, nextCarryBills: ['SP1','SP2','SP3','SP4'] });
  assert.equal(dashboard.abnormalCount, 0);
  assert.equal(dashboard.nextCarry, 0);
  assert.equal(dashboard.categories.selfPickup, 1);
  assert.equal(dashboard.categories.cecnRetention, 1);
  assert.equal(dashboard.categories.ceztRetention, 1);
  assert.equal(dashboard.categories.ccsl580Retention, 1);
});

test('V12 Shopee special latest nodes are closed instead of active carry', () => {
  for (const place of ['CE:CECN', 'CEL:CEZT', 'CE:580']) {
    const row = analyzeShopeeShipment({
      waybill: 'SPEV12', reportDate: '2026-08-07', analysisDate: '2026-08-07',
      scanRow: { shipmentCode: 'SPEV12', statusCode: 'P' },
      events: [{ shipmentCode: 'SPEV12', eventTime: '2026-08-07 10:00:00', place }],
      exceptions: [], apiStatus: { shipment: 'success', event: 'success', exception: 'success' }
    });
    assert.equal(row.跨日状态, '已闭环');
    assert.match(String(row.carry状态), /^closed_/);
  }
});

test('V12 generic pipeline excludes CECN/CEZT/580/self-pickup from next-day carry', async () => {
  const bills = ['CECN12', 'CEZT12', 'M58012', 'PICK12'];
  const eventByBill = {
    CECN12: { shipmentCode: 'CECN12', eventTime: '2026-08-07 10:00:00', place: 'CE:CECN' },
    CEZT12: { shipmentCode: 'CEZT12', eventTime: '2026-08-07 10:00:00', place: 'CEL:CEZT' },
    M58012: { shipmentCode: 'M58012', eventTime: '2026-08-07 10:00:00', place: 'CE:580' },
    PICK12: { shipmentCode: 'PICK12', eventTime: '2026-08-07 10:00:00', trackingEventDescZh: '备注:Work order:仓库自提' }
  };
  const state = { businessType: 'CCSL', reportDate: '2026-08-07', pnhBills: bills, carryBills: [], podLocks: [], currentRun: { runId: 'v12-special' } };
  await runQcPipeline({ state, client: {
    confirmQuery: async codes => codes.map(shipmentCode => ({ shipmentCode, statusCode: 'P' })),
    trackQuery: async codes => codes.map(code => eventByBill[code]).filter(Boolean)
  }});
  assert.deepEqual(state.nextCarryBills, []);
});