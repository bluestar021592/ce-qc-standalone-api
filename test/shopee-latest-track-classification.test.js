import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeShopeeShipment } from '../src/shopeeAnalyzer.js';

const base = {
  waybill: 'SPE-TRACK-001',
  reportDate: '2026-08-01',
  analysisDate: '2026-08-05',
  dailyRow: { recipient_group: 'VN' },
  apiStatus: { shipment: 'success', event: 'success', exception: 'success' }
};

test('events after reportDate participate in the current classification', () => {
  const row = analyzeShopeeShipment({
    ...base,
    events: [
      { eventTime: '2026-08-01 09:00:00', trackingEventDescZh: '货物入库' },
      { eventTime: '2026-08-03 10:00:00', trackingEventDescZh: '货物到达网点【CE:WHPP】' }
    ]
  });
  assert.equal(row.入库无扫描节点, '否');
  assert.equal(row.中转节点停留, '是');
  assert.equal(row.严重超时, '是');
  assert.equal(row.primaryCategory, '严重超时未更新');
  assert.equal(row.latestEventTime, '2026-08-03 10:00:00');
});

test('cycle count closes after a later transit action', () => {
  const row = analyzeShopeeShipment({
    ...base,
    events: [
      { eventTime: '2026-08-01 09:00:00', trackingEventDescZh: '盘点' },
      { eventTime: '2026-08-02 09:00:00', trackingEventDescZh: 'Cycle Count' },
      { eventTime: '2026-08-04 09:00:00', trackingEventDescZh: '货物离开网点【CE:WHJT】' }
    ]
  });
  assert.equal(row.盘点天数, 0);
  assert.equal(/盘点/.test(row.primaryCategory), false);
  assert.equal(row.入库无扫描节点, '否');
});

test('a POD event after reportDate closes the shipment', () => {
  const row = analyzeShopeeShipment({
    ...base,
    events: [
      { eventTime: '2026-08-01 09:00:00', trackingEventDescZh: '货物入库' },
      { eventTime: '2026-08-04 11:00:00', trackingEventDescZh: 'POD 已签收' }
    ]
  });
  assert.equal(row.是否POD, '是');
  assert.equal(row.primaryCategory, 'POD');
  assert.equal(row.入库无扫描节点, '否');
});

test('delivery attempts are counted once per Cambodia natural day', () => {
  const row = analyzeShopeeShipment({
    ...base,
    events: [
      { eventTime: '2026-08-02 08:00:00', trackingEventDescZh: '派件分配' },
      { eventTime: '2026-08-02 10:00:00', trackingEventDescZh: '派送中' },
      { eventTime: '2026-08-03 09:00:00', trackingEventDescZh: 'Delivery Assign' }
    ]
  });
  assert.equal(row.currentAttemptNo, 2);
  assert.deepEqual(row.attemptHistory, ['2026-08-02', '2026-08-03']);
  assert.equal(row.attemptStatus, 'CALCULATED_FROM_TRACK');
});
