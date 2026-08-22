import test from 'node:test';
import assert from 'node:assert/strict';
import { isShopeePending1203ReturnEvent } from '../src/shopeeReturnTruth.js';
import { analyzeShopeeShipment } from '../src/shopeeAnalyzer.js';

test('SHOPEE Pending 1203 marker is recognized with tab/Chinese description', () => {
  const event = {
    shipmentCode: 'SPE260802000239',
    eventCode: '150',
    trackingEventDescZh: 'Pending\t异常滞留:1203--派送异常:',
    eventTime: '2026-08-20 10:58:14'
  };
  assert.equal(isShopeePending1203ReturnEvent(event), true);
});

test('SHOPEE Pending 1203 marker closes return even when it is in the middle of trajectory history', () => {
  const events = [
    {
      shipmentCode: 'SPE260802000239',
      eventCode: '150',
      trackingEventDescZh: 'Pending\t异常滞留:1203--派送异常:',
      eventTime: '2026-08-20 10:58:14'
    },
    {
      shipmentCode: 'SPE260802000239',
      eventCode: '30',
      trackingEventDescZh: '后续系统轨迹',
      eventTime: '2026-08-21 09:00:00'
    }
  ];
  const result = analyzeShopeeShipment({
    waybill: 'SPE260802000239',
    scanRow: { shipmentCode: 'SPE260802000239', orderStatus: '70' },
    events,
    exceptions: [],
    reportDate: '2026-08-20',
    analysisDate: '2026-08-22'
  });
  assert.equal(result.currentState, 'RETURN_COMPLETED');
  assert.equal(result.退回状态, '已退回');
  assert.equal(result.primaryCategory, '退回');
  assert.equal(result.pending1203ReturnEvidence, true);
  assert.equal(result.pending1203ReturnTime, '2026-08-20 10:58:14');
});
