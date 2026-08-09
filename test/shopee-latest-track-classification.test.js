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

test('old source date alone never makes a parcel severe when latest node is fresh', () => {
  const row = analyzeShopeeShipment({
    ...base,
    events: [
      { eventTime: '2026-08-01 09:00:00', trackingEventDescZh: '货物入库' },
      { eventTime: '2026-08-03 10:00:00', trackingEventDescZh: '货物到达网点【CE:WHPP】' }
    ]
  });
  assert.equal(row.入库无扫描节点, '否');
  assert.equal(row.中转节点停留, '是');
  assert.equal(row.严重超时, '否');
  assert.equal(row.primaryCategory, '中转节点停留');
  assert.equal(row.latestEventTime, '2026-08-03 10:00:00');
});

test('a later inbound node closes the previous Pending episode', () => {
  const row = analyzeShopeeShipment({
    ...base,
    events: [
      { eventTime: '2026-08-01 09:00:00', trackingEventDescZh: 'Pending 无法联系客户' },
      { eventTime: '2026-08-02 09:00:00', trackingEventDescZh: 'Pending 客户改约' },
      { eventTime: '2026-08-03 09:00:00', trackingEventDescZh: 'Inbound 货物到达网点' }
    ]
  });
  assert.equal(row.Pending当前次数, 0);
  assert.equal(row.Pending状态, '否');
  assert.equal(row.Pending不连续, '否');
  assert.equal(/Pending/.test(row.primaryCategory), false);
});

test('only Pending after the latest progress node remains active', () => {
  const row = analyzeShopeeShipment({
    ...base,
    events: [
      { eventTime: '2026-08-01 09:00:00', trackingEventDescZh: 'Pending 无法联系客户' },
      { eventTime: '2026-08-02 09:00:00', trackingEventDescZh: 'Outbound 发往外省门店' },
      { eventTime: '2026-08-04 09:00:00', trackingEventDescZh: 'Pending 客户改约' }
    ]
  });
  assert.equal(row.Pending当前次数, 1);
  assert.equal(row.Pending状态, '是');
  assert.equal(row.primaryCategory, 'Pending1次');
});

test('OC closes when a newer effective track node appears', () => {
  const row = analyzeShopeeShipment({
    ...base,
    events: [
      { eventTime: '2026-08-02 09:00:00', trackingEventDescZh: 'Inbound 货物到达网点' },
      { eventTime: '2026-08-04 09:00:00', trackingEventDescZh: 'Outbound 发往下一个网点' }
    ],
    exceptions: [{ exceptionType: '20', reportTime: '2026-08-03 08:00:00' }]
  });
  assert.equal(row.OC状态, '否');
  assert.equal(row.OC天数, 0);
  assert.equal(row.OC结束原因, 'STATE_CHANGED_BY_NEW_NODE');
  assert.equal(/^OC/.test(row.primaryCategory), false);
});

test('OC remains active only when it is newer than the latest progress node', () => {
  for (const exceptionType of ['20', '30', '40']) {
    const row = analyzeShopeeShipment({
      waybill: `SPE-OC-${exceptionType}`,
      reportDate: '2026-08-01',
      analysisDate: '2026-08-05',
      events: [{ shipmentCode: `SPE-OC-${exceptionType}`, eventCode: '30', eventTime: '2026-08-04 09:00:00', trackingEventDesc: 'Inbound' }],
      exceptions: [{ shipmentCode: `SPE-OC-${exceptionType}`, exceptionType, reportTime: '2026-08-05 08:00:00' }],
      apiStatus: { shipment: 'success', event: 'success', exception: 'success' }
    });
    assert.equal(row.OC天数, 1);
    assert.match(row.primaryCategory, /OC1/);
    assert.equal(row.入库无扫描节点, '否');
  }
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

test('POD and completed return are normal closed states', () => {
  const pod = analyzeShopeeShipment({
    ...base,
    events: [
      { eventTime: '2026-08-01 09:00:00', trackingEventDescZh: 'Pending 无法联系客户' },
      { eventTime: '2026-08-04 11:00:00', trackingEventDescZh: 'POD 已签收' }
    ]
  });
  assert.equal(pod.是否POD, '是');
  assert.equal(pod.primaryCategory, 'POD');
  assert.equal(pod.carry状态, 'closed_pod');

  const returned = analyzeShopeeShipment({
    ...base,
    waybill: 'SPE-RETURN-001',
    events: [
      { eventTime: '2026-08-01 09:00:00', trackingEventDescZh: 'Pending 无法联系客户' },
      { eventTime: '2026-08-04 11:00:00', eventCode: '81', trackingEventDescZh: '退回完成' }
    ]
  });
  assert.equal(returned.退回状态, '已退回');
  assert.equal(returned.primaryCategory, '退回');
  assert.equal(returned.carry状态, 'closed_return');
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
