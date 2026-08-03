import assert from 'node:assert/strict';
import { analyzeShopeeShipment, classifyShopeeRegion } from '../src/shopeeAnalyzer.js';

const results = [];
const test = (id, fn) => {
  try { fn(); results.push({ id, ok: true }); }
  catch (error) { results.push({ id, ok: false, error: error.message }); }
};
const event = (bill, time, desc, extra = {}) => ({ shipmentCode: bill, eventTime: time, trackingEventDescZh: desc, ...extra });
const analyze = (bill, reportDate, events = [], exceptions = [], extra = {}) => analyzeShopeeShipment({
  waybill: bill, reportDate, events, exceptions,
  scanRow: { shipmentCode: bill, 运单号: bill, 来源类型: extra.sourceType || '今日日报' },
  shipmentTrackRow: extra.shipmentTrackRow || {},
  dailyRow: extra.dailyRow || {}, priorRow: extra.priorRow || {},
  apiStatus: extra.apiStatus || { shipment: 'success', event: 'success', exception: 'success' }
});

test('SHP-PEN-01', () => {
  const row = analyze('SPE1', '2026-07-19', [event('SPE1', '2026-07-19 08:00:00', 'Pending'), event('SPE1', '2026-07-19 15:00:00', 'Pending')]);
  assert.equal(row.Pending次数, 1);
});
test('SHP-PEN-02', () => {
  const row = analyze('SPE2', '2026-07-20', [event('SPE2', '2026-07-19 08:00:00', 'Pending'), event('SPE2', '2026-07-19 12:00:00', 'Cycle Count'), event('SPE2', '2026-07-20 08:00:00', 'Pending')]);
  assert.equal(row.Pending次数, 2); assert.equal(row.Pending连续性, '连续');
});
test('SHP-PEN-04', () => {
  const row = analyze('SPE3', '2026-07-20', [event('SPE3', '2026-07-18 08:00:00', 'Pending'), event('SPE3', '2026-07-19 08:00:00', 'Pending'), event('SPE3', '2026-07-20 08:00:00', 'Pending')]);
  assert.equal(row.returnRequired, true); assert.equal(row.退回待处理时间, '2026-07-20');
});
test('SHP-PEN-06', () => {
  const row = analyze('SPE4', '2026-07-20', [event('SPE4', '2026-07-17 08:00:00', 'Pending'), event('SPE4', '2026-07-18 08:00:00', 'Pending'), event('SPE4', '2026-07-19 08:00:00', 'Pending'), event('SPE4', '2026-07-20 08:00:00', 'Delivery')]);
  assert.equal(row.primaryCategory, '三次Pending后继续派送'); assert.equal(row.carry状态, 'active');
});
test('SHP-OC-05', () => {
  const row = analyze('SPE5', '2026-07-20', [event('SPE5', '2026-07-19 21:00:00', 'Inbound')], [{ shipmentCode: 'SPE5', exceptionDesc: 'oc', reportTime: '2026-07-19 20:00:00' }]);
  assert.equal(row.OC天数, 2); assert.equal(row.OC状态, '是');
});
test('SHP-OC-06', () => {
  const row = analyze('SPE6', '2026-07-20', [event('SPE6', '2026-07-20 08:00:00', 'Delivery Assign'), event('SPE6', '2026-07-20 09:00:00', 'Delivery')], [{ shipmentCode: 'SPE6', exceptionDesc: 'OC', reportTime: '2026-07-19 20:00:00' }]);
  assert.equal(row.OC状态, '是'); assert.equal(row.carry状态, 'active');
});
test('SHP-OC-07', () => {
  const row = analyze('SPE7', '2026-07-20', [event('SPE7', '2026-07-20 09:00:00', 'Pending')], [{ shipmentCode: 'SPE7', exceptionDesc: 'OC', reportTime: '2026-07-19 20:00:00' }]);
  assert.equal(row.OC结束原因, 'STATE_CHANGED_TO_PENDING'); assert.equal(row.Pending次数, 1);
});
test('SHP-POD-01-04', () => {
  const bill = 'SPE260713000655';
  const events = [
    event(bill, '2026-07-19 20:27:16', 'Pending OC'),
    event(bill, '2026-07-19 20:44:08', 'Inbound'),
    event(bill, '2026-07-20 08:32:51', 'Delivery Assign'),
    event(bill, '2026-07-20 08:57:14', 'Delivery'),
    event(bill, '2026-07-20 13:02:07', 'POD')
  ];
  const exceptions = [{ shipmentCode: bill, exceptionDesc: 'oc', reportTime: '2026-07-19 20:27:16' }];
  const day1 = analyze(bill, '2026-07-19', events, exceptions);
  const day2 = analyze(bill, '2026-07-20', events, exceptions, { sourceType: '旧跨日' });
  assert.equal(day1.primaryCategory, 'OC1天'); assert.equal(day1.carry状态, 'active');
  assert.equal(day2.是否POD, '是'); assert.equal(day2.carry状态, 'closed_pod');
});
test('SHP-RET-01-02', () => {
  const noPhoto = analyze('SPE260706000157', '2026-07-20', [event('SPE260706000157', '2026-07-20 08:00:00', 'Return')]);
  const withPhoto = analyze('SPE8', '2026-07-20', [event('SPE8', '2026-07-20 08:00:00', 'Return', { pictureUrls: ['a.jpg'] })]);
  assert.equal(noPhoto.退回照片状态, '无照片'); assert.equal(withPhoto.退回照片状态, '有照片');
});
test('SHP-RET-03', () => {
  const row = analyze('SPE9', '2026-07-20', [event('SPE9', '2026-07-20 08:00:00', 'Return')], [], { apiStatus: { shipment: 'success', event: 'failed', exception: 'success' } });
  assert.equal(row.退回照片状态, '待核验');
});
test('SHP-REG-01-05', () => {
  assert.equal(classifyShopeeRegion({ dailyRow: { raw: { deliveryShop: 'PV013' } } }).regionType, 'PROVINCE');
  assert.equal(classifyShopeeRegion({ dailyRow: { raw: { deliveryShop: 'PP021' } } }).regionType, 'PHNOM_PENH');
  assert.equal(classifyShopeeRegion({ dailyRow: { raw: { destProvince: 'PNH' } } }).regionCode, 'PP');
  assert.equal(classifyShopeeRegion({ dailyRow: { raw: { value: 'no region' } } }).regionCode, 'UNKNOWN');
});
test('SHP-API-FAIL-CARRY', () => {
  const row = analyze('SPE10', '2026-07-20', [], [], { priorRow: { primaryCategory: 'OC2天', OC天数: 2 }, apiStatus: { shipment: 'failed', event: 'failed', exception: 'failed' } });
  assert.equal(row.primaryCategory, 'OC2天'); assert.equal(row.carry状态, 'active'); assert.equal(row.查询状态, 'refresh_failed'); assert.equal(row.入库无扫描节点, '否');
});

const failed = results.filter(row => !row.ok);
console.log(JSON.stringify({ ok: failed.length === 0, total: results.length, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exitCode = 1;
