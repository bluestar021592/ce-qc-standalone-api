import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyScanTerminal } from '../src/scanTerminal.js';
import { runQcPipeline } from '../src/pipeline.js';
import { buildShopeeDashboard } from '../src/shopeeReporting.js';
import { analyzeShipment } from '../src/analyzer.js';

test('V11 scan mapping follows locked confirm-query orderStatus only', () => {
  assert.deepEqual(classifyScanTerminal({ shipmentCode: 'A', orderStatus: 85 }).currentState, 'POD');
  assert.deepEqual(classifyScanTerminal({ shipmentCode: 'B', orderStatus: 100 }).currentState, 'RETURN_COMPLETED');
  assert.deepEqual(classifyScanTerminal({ shipmentCode: 'C', orderStatus: 70, statusCode: 'P4007' }).currentState, 'OPEN_TRACK_REQUIRED');
  assert.equal(classifyScanTerminal({ shipmentCode: 'B', orderStatus: 100 }).trackRequired, false);
  assert.equal(classifyScanTerminal({ shipmentCode: 'C', orderStatus: 70, statusCode: 'P4007' }).trackRequired, true);
});

test('V11 scan 85/100 make zero track calls while 50/60/70 still track', async () => {
  const bills = ['POD001', 'RET001', 'OPEN001'];
  const tracked = [];
  const state = {
    businessType: 'SHOPEE', reportDate: '2026-08-04', pnhBills: bills,
    dailyParseRows: bills.map(shipmentCode => ({ shipmentCode, recipient_group: 'VN', importStatus: 'ACCEPTED' })),
    currentRun: { runId: 'v11-terminal' }, carryBills: [], podLocks: []
  };
  await runQcPipeline({ state, client: {
    confirmQuery: async () => [
      { shipmentCode: 'POD001', orderStatus: 85 },
      { shipmentCode: 'RET001', orderStatus: 100 },
      { shipmentCode: 'OPEN001', orderStatus: 70, statusCode: 'P4007', statusText: '退回中' }
    ],
    trackQuery: async codes => { tracked.push(...codes); return []; },
    exceptionQuery: async () => []
  }});
  assert.deepEqual(tracked, ['OPEN001']);
  assert.equal(state.needTrackBills.includes('POD001'), false);
  assert.equal(state.needTrackBills.includes('RET001'), false);
  assert.equal(state.needTrackBills.includes('OPEN001'), true);
  assert.notEqual(state.finalRows.find(row => row.运单号 === 'POD001')?.入库无扫描节点, '是');
  assert.equal(state.finalRows.find(row => row.运单号 === 'RET001')?.入库无扫描节点, '否');
});

test('V11 Shopee return metrics keep completed and in-progress sets mutually exclusive', () => {
  const dailyParseRows = [
    { shipmentCode: 'R1', recipient_group: 'VN', regionCode: 'PP' },
    { shipmentCode: 'R2', recipient_group: 'VN', regionCode: 'PV' }
  ];
  const state = {
    businessType: 'SHOPEE', reportDate: '2026-08-04', pnhBills: ['R1', 'R2'], dailyParseRows,
    finalRows: [
      { shipmentCode: 'R1', recipient_group: 'VN', regionCode: 'PP', 退回状态: '已退回', currentState: 'RETURN_COMPLETED', primaryCategory: '退回' },
      { shipmentCode: 'R2', recipient_group: 'VN', regionCode: 'PV', 退回状态: '退回处理中', currentState: 'RETURN_IN_PROGRESS' }
    ], carryBills: ['R2']
  };
  const dashboard = buildShopeeDashboard(state);
  const metrics = dashboard.recipientGroups.VN.metrics;
  assert.equal(metrics.returned, 1);
  assert.equal(metrics.returnInProgress, 1);
  assert.equal(metrics.returnRate, 50);
  assert.equal(dashboard.regions.PP.returned, 1);
  assert.equal(dashboard.regions.PV.returnInProgress, 1);
});

test('V11 a delivery assignment after first inbound excludes inbound-no-scan even after duplicate inbound', () => {
  const row = analyzeShipment({ waybill: 'CC27072603239', reportDate: '2026-08-05', events: [
    { shipmentCode: 'CC27072603239', eventCode: '26', eventTime: '2026-08-04 14:36:48', trackingEventDescZh: '揽件完成，货物到达网点【CEL:CCSL】' },
    { shipmentCode: 'CC27072603239', eventCode: '60', eventTime: '2026-08-05 11:55:41', trackingEventDescZh: '快递员即将为您派送货物' },
    { shipmentCode: 'CC27072603239', eventCode: '30', eventTime: '2026-08-05 11:59:05', trackingEventDescZh: '货物到达网点【CEL:CCSL】' }
  ] });
  assert.notEqual(row.primaryCategory, '入库无扫描');
  assert.notEqual(row.matchedRule, 'INBOUND_WITHOUT_DELIVERY_SCAN');
});

test('V11 resume keeps a POD-locked daily bill without repeating CE API calls', async () => {
  const calls = { confirm: 0, track: 0, exception: 0 };
  const state = {
    businessType: 'SHOPEE', reportDate: '2026-08-04', pnhBills: ['PODLOCK', 'OPEN001'],
    dailyParseRows: [
      { shipmentCode: 'PODLOCK', recipient_group: 'VN', importStatus: 'ACCEPTED' },
      { shipmentCode: 'OPEN001', recipient_group: 'VN', importStatus: 'ACCEPTED' }
    ],
    currentRun: { runId: 'v11-resume' }, carryBills: [], podLocks: ['PODLOCK'],
    scanResults: [{ shipmentCode: 'OPEN001', orderStatus: 50 }],
    scanQueryStatus: [{ shipmentCode: 'OPEN001', reportDate: '2026-08-04', status: 'success' }],
    trackEvents: [], eventQueryStatus: [{ shipmentCode: 'OPEN001', reportDate: '2026-08-04', status: 'success' }],
    exceptionItems: [], exceptionQueryStatus: [{ shipmentCode: 'OPEN001', reportDate: '2026-08-04', status: 'success' }]
  };
  await runQcPipeline({ state, client: {
    confirmQuery: async () => { calls.confirm += 1; return []; },
    trackQuery: async () => { calls.track += 1; return []; },
    exceptionQuery: async () => { calls.exception += 1; return []; }
  }});
  assert.deepEqual(calls, { confirm: 0, track: 0, exception: 0 });
  assert.equal(state.finalRows.length, 2);
  assert.equal(state.finalRows.find(row => row.shipmentCode === 'PODLOCK')?.currentState, 'POD');
  assert.equal(state.finalRows.find(row => row.shipmentCode === 'PODLOCK')?.trackRequired, false);
});
