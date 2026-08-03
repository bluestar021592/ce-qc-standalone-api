import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeShopeeShipment } from '../src/shopeeAnalyzer.js';

const success = { shipment: 'success', event: 'success', exception: 'success' };
const samples = [];

samples.push(run('SPE260706000157', '2026-07-20', {
  shipmentTrackRow: { shipmentCode: 'SPE260706000157', statusCode: 81, statusName: 'Returned' },
  events: [event('SPE260706000157', '2026-07-20 09:00:00', '81', 'Return 退回', [])], apiStatus: success
}, row => row.退回状态 === '已退回' && row.退回照片状态 === '无照片' && row.carry状态 === 'closed_return'));

samples.push(run('SPE260705000370', '2026-07-20', {
  dailyRow: { regionCode: 'PV013' },
  events: [
    event('SPE260705000370', '2026-07-18 10:00:00', '150', 'Pending 客户无人接听'),
    event('SPE260705000370', '2026-07-19 10:00:00', '150', 'Pending 地址错误'),
    event('SPE260705000370', '2026-07-20 10:00:00', '150', 'Pending 无法联系')
  ], apiStatus: success
}, row => row.regionCode === 'PV013' && row.Pending最大次数 === 3 && row.returnRequired === true && row.carry状态 === 'active'));

samples.push(run('SPE260706000491', '2026-07-20', {
  events: [
    event('SPE260706000491', '2026-07-17 10:00:00', '150', 'Pending 客户无人接听'),
    event('SPE260706000491', '2026-07-18 10:00:00', '30', 'Delivery Assign 派件分配'),
    event('SPE260706000491', '2026-07-19 10:00:00', '150', 'Pending 再次派送失败')
  ], apiStatus: success
}, row => row.primaryCategory === 'Pending1次' && row.Pending当前次数 === 1 && row.Pending最大次数 === 1 && row.carry状态 === 'active'));

samples.push(run('SPE260714000975', '2026-07-20', {
  exceptions: [{ shipmentCode: 'SPE260714000975', exceptionDesc: 'OC', exceptionType: 'OC', reportTime: '2026-07-20 08:30:00' }],
  events: [event('SPE260714000975', '2026-07-20 09:00:00', 'Inbound', 'Inbound 入库')], apiStatus: success
}, row => row.primaryCategory === 'OC1天' && row.OC天数 === 1 && row.carry状态 === 'active'));

const podBill = 'SPE260713000655';
const ocItem = [{ shipmentCode: podBill, exceptionDesc: 'OC', exceptionType: 'OC', reportTime: '2026-07-19 20:27:16' }];
const day1Events = [
  event(podBill, '2026-07-19 20:35:00', 'Inbound', 'Inbound 入库'),
  event(podBill, '2026-07-19 21:00:00', '30', 'Delivery Assign 派件分配'),
  event(podBill, '2026-07-19 21:30:00', '70', 'Delivery 派送中')
];
const day1 = analyzeShopeeShipment({ waybill: podBill, events: day1Events, exceptions: ocItem, reportDate: '2026-07-19', apiStatus: success });
const day2 = analyzeShopeeShipment({ waybill: podBill, events: [...day1Events, event(podBill, '2026-07-20 13:02:07', '85', 'POD 签收成功')], exceptions: ocItem, reportDate: '2026-07-20', priorRow: day1, apiStatus: success });
assert.equal(day1.primaryCategory, 'OC1天');
assert.equal(day1.carry状态, 'active');
assert.equal(day2.primaryCategory, 'POD');
assert.equal(day2.carry状态, 'closed_pod');
samples.push({ shipmentCode: podBill, ok: true, reportDate: '2026-07-20', category: day2.primaryCategory, carryStatus: day2.carry状态, podStatus: day2.POD状态, day1Category: day1.primaryCategory, day1CarryStatus: day1.carry状态 });

const result = { ok: samples.every(row => row.ok), total: samples.length, passed: samples.filter(row => row.ok).length, samples };
const out = path.resolve('data/codex_ui_track_crossday/shopee_five_sample_results.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, reportFile: out }, null, 2));

function run(shipmentCode, reportDate, input, verify) {
  const row = analyzeShopeeShipment({ waybill: shipmentCode, reportDate, ...input });
  assert.equal(verify(row), true, `${shipmentCode} evidence replay failed`);
  return { shipmentCode, ok: true, reportDate, category: row.primaryCategory, regionCode: row.regionCode, pendingCurrent: row.Pending当前次数, pendingMax: row.Pending最大次数, ocDays: row.OC天数, returnStatus: row.退回状态, returnPhotoStatus: row.退回照片状态, podStatus: row.POD状态, carryStatus: row.carry状态 };
}

function event(shipmentCode, eventTime, eventCode, desc, pictureUrls = []) {
  return { shipmentCode, eventTime, eventCode, trackingEventCode: eventCode, trackingEventDescZh: desc, trackingEventDesc: desc, pictureUrls };
}
