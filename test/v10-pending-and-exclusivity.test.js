import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeShipment } from '../src/analyzer.js';
import { summarizePendingEvents } from '../src/pendingDays.js';

const pending = (time, reason = 'Pending customer unavailable') => ({ shipmentCode: 'CCV10', eventCode: '150', eventTime: time, trackingEventDesc: reason });
const isPending = event => String(event.eventCode) === '150';

test('V10 same Phnom Penh day keeps all raw events but counts one Pending day', () => {
  const events = [pending('2026-08-03 08:00:00'), pending('2026-08-03 12:00:00'), pending('2026-08-03 19:00:00', 'Pending final reason')];
  const summary = summarizePendingEvents(events, isPending);
  const row = analyzeShipment({ waybill: 'CCV10', events, reportDate: '2026-08-03' });
  assert.equal(summary.rawEventCount, 3);
  assert.equal(summary.distinctDayCount, 1);
  assert.deepEqual(summary.dates, ['2026-08-03']);
  assert.equal(summary.latestReason, 'Pending final reason');
  assert.equal(row.pendingRawEventCount, 3);
  assert.equal(row.pendingDistinctDayCount, 1);
  assert.equal(row.Pending次数, 1);
  assert.doesNotMatch(String(row.primaryCategory), /3/);
});

test('V10 Pending continuity uses deduplicated natural dates', () => {
  const continuous = summarizePendingEvents([pending('2026-08-01 10:00:00'), pending('2026-08-02 10:00:00'), pending('2026-08-03 10:00:00')], isPending);
  const discontinuous = summarizePendingEvents([pending('2026-08-01 10:00:00'), pending('2026-08-03 10:00:00'), pending('2026-08-04 10:00:00')], isPending);
  assert.equal(continuous.continuity, '连续');
  assert.equal(discontinuous.continuity, '不连续');
  assert.equal(continuous.distinctDayCount, 3);
  assert.equal(discontinuous.distinctDayCount, 3);
});

test('V10 POD overrides current Pending category while preserving history statistics', () => {
  const events = [pending('2026-08-01 10:00:00'), pending('2026-08-02 10:00:00'), { shipmentCode: 'CCV10', eventCode: '80', eventTime: '2026-08-03 10:00:00', trackingEventDesc: 'POD delivered' }];
  const row = analyzeShipment({ waybill: 'CCV10', events, reportDate: '2026-08-03' });
  assert.equal(row.是否POD, '是');
  assert.equal(row.pendingRawEventCount, 2);
  assert.equal(row.pendingDistinctDayCount, 2);
});

test('V10 inbound no scan is excluded when any later recognized action exists', () => {
  const events = [
    { shipmentCode: 'CC27072603239', eventTime: '2026-08-03 08:00:00', trackingEventDesc: 'Inbound cargo arrived at CEL:CCSL', place: 'CEL:CCSL' },
    { shipmentCode: 'CC27072603239', eventTime: '2026-08-03 12:00:00', trackingEventDesc: 'Cycle Count', eventCode: '32' }
  ];
  const row = analyzeShipment({ waybill: 'CC27072603239', events, reportDate: '2026-08-03' });
  assert.doesNotMatch(String(row.primaryCategory), /入库无扫描/);
  assert.match(String(row.primaryCategory), /盘点|Cycle/i);
});
