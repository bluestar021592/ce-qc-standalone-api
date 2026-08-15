import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CEClient } from '../src/ceClient.js';
import '../src/v86StrictTrackStatusGate.js';
import { analyzeShipment } from '../src/analyzerFinal.js';
import { analyzeShopeeShipment } from '../src/shopeeAnalyzerV31.js';
import { analyzeWhppShipment } from '../src/whppAnalyzer.js';

const gateUrl = new URL('../src/v86StrictTrackStatusGate.js', import.meta.url);
const gateSource = fs.readFileSync(gateUrl, 'utf8');
const bootstrap = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');

function syntheticHold(bill, status) {
  return {
    shipmentCode: bill,
    eventCode: 'SCAN_STATUS_HOLD',
    trackingEventCode: 'SCAN_STATUS_HOLD',
    syntheticType: 'SCAN_STATUS_HOLD',
    __ceQcSynthetic: 'SCAN_STATUS_HOLD',
    scanOrderStatus: status,
    trackingEventDesc: `orderStatus=${status} local hold`,
    eventTime: ''
  };
}

test('V86 gate is syntax valid and loaded before server', () => {
  const check = spawnSync(process.execPath, ['--check', fileURLToPath(gateUrl)], { encoding:'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(bootstrap, /v86StrictTrackStatusGate/);
  assert.match(gateSource, /OPEN_TRACK_STATUSES = new Set\(\['50', '60', '70'\]\)/);
  assert.match(gateSource, /GLOBAL_TERMINAL_STATUSES = new Set\(\['10', '85', '100'\]\)/);
  assert.doesNotMatch(gateSource, /evidence\.businessType === 'WHPP'/);
});

test('automated track event shipment and exception APIs receive only scan statuses 50 60 70', async () => {
  const client = new CEClient();
  const calls = [];
  client.postJson = async (path, body) => {
    calls.push({ path, body: Array.isArray(body) ? [...body] : JSON.parse(JSON.stringify(body || {})) });
    if (path.includes('confirm-query')) {
      return { data: [
        { shipmentCode: 'A50', orderStatus: '50' },
        { shipmentCode: 'B60', orderStatus: '60' },
        { shipmentCode: 'C70', orderStatus: '70' },
        { shipmentCode: 'D85', orderStatus: '85' },
        { shipmentCode: 'E100', orderStatus: '100' },
        { shipmentCode: 'F99', orderStatus: '99' },
        { shipmentCode: 'G10', orderStatus: '10' }
      ] };
    }
    if (path.includes('tms-shipment-event/query')) return { data: body.map(code => ({ shipmentCode:code, eventCode:'26', eventTime:'2026-08-13 10:00:00' })) };
    if (path.includes('tms-shipment/track')) return { data: body.map(code => ({ shipmentCode:code })) };
    if (path.includes('exception-item/query')) return { data: [] };
    return { data: [] };
  };

  const all = ['A50','B60','C70','D85','E100','F99','G10'];
  await client.confirmQuery(all);
  const events = await client.trackQuery(all);
  await client.shipmentTrack(all);
  await client.exceptionQuery(all);

  const trackCall = calls.find(call => call.path.includes('tms-shipment-event/query'));
  const shipmentCall = calls.find(call => call.path.includes('tms-shipment/track'));
  const exceptionCall = calls.find(call => call.path.includes('exception-item/query'));
  assert.deepEqual(trackCall.body, ['A50','B60','C70']);
  assert.deepEqual(shipmentCall.body, ['A50','B60','C70']);
  assert.deepEqual(exceptionCall.body, ['A50','B60','C70']);
  assert.ok(events.some(row => row.shipmentCode === 'F99' && row.syntheticType === 'SCAN_STATUS_HOLD'));
  assert.ok(!events.some(row => ['D85','E100','G10'].includes(row.shipmentCode)), 'cancel/POD/return terminals remain scan-only closures');
});

test('CE analyzer closes scan cancellation normally without trajectory abnormalities', () => {
  const row = analyzeShipment({ waybill:'CE-CANCEL', scanRow:{ orderStatus:'10' }, events:[], reportDate:'2026-08-13' });
  assert.equal(row.currentState, 'ORDER_CANCELLED');
  assert.equal(row.primaryCategory, '订单取消');
  assert.equal(row.trackRequired, false);
  assert.equal(row.Pending次数, 0);
  assert.equal(row.OC天数, 0);
  assert.equal(row.盘点天数, 0);
});

test('CE analyzer preserves unknown scan status as local hold without inventing trajectory abnormalities', () => {
  const row = analyzeShipment({ waybill:'CE-HOLD', scanRow:{ orderStatus:'99' }, events:[syntheticHold('CE-HOLD','99')], reportDate:'2026-08-13' });
  assert.equal(row.currentState, 'SCAN_STATUS_HOLD');
  assert.equal(row.primaryCategory, '扫描状态待识别');
  assert.equal(row.trackRequired, false);
  assert.equal(row.trackSkippedReason, 'SCAN_STATUS_NOT_TRACKABLE');
  assert.equal(row.Pending次数, 0);
  assert.equal(row.OC天数, 0);
  assert.equal(row.盘点天数, 0);
  assert.equal(row.入库无扫描节点, '否');
  assert.equal(row.轨迹节点数, 0);
});

test('Shopee analyzer preserves unknown scan status as local hold while scan 10 85 100 remain terminal', () => {
  const hold = analyzeShopeeShipment({ waybill:'S-HOLD', scanRow:{ orderStatus:'99' }, events:[syntheticHold('S-HOLD','99')], reportDate:'2026-08-13', analysisDate:'2026-08-13' });
  assert.equal(hold.currentState, 'SCAN_STATUS_HOLD');
  assert.equal(hold.trackRequired, false);
  assert.equal(hold.Pending次数, 0);
  assert.equal(hold.OC天数, 0);

  const cancelled = analyzeShopeeShipment({ waybill:'S-CANCEL', scanRow:{ orderStatus:'10' }, events:[], reportDate:'2026-08-13', analysisDate:'2026-08-13' });
  assert.equal(cancelled.currentState, 'ORDER_CANCELLED');
  assert.equal(cancelled.trackRequired, false);

  const pod = analyzeShopeeShipment({ waybill:'S-POD', scanRow:{ orderStatus:'85' }, events:[], reportDate:'2026-08-13', analysisDate:'2026-08-13' });
  assert.equal(pod.是否POD, '是');
  assert.equal(pod.trackRequired, false);

  const returned = analyzeShopeeShipment({ waybill:'S-RETURN', scanRow:{ orderStatus:'100' }, events:[], reportDate:'2026-08-13', analysisDate:'2026-08-13' });
  assert.equal(returned.退回状态, '已退回');
  assert.equal(returned.trackRequired, false);
});

test('WHPP scan cancellation remains terminal no-track and is never converted into generic scan hold', () => {
  const cancelled = analyzeWhppShipment({ waybill:'W-CANCEL', scanRow:{ orderStatus:'10' }, events:[], reportDate:'2026-08-13', analysisDate:'2026-08-13' });
  assert.equal(cancelled.currentState, 'ORDER_CANCELLED');
  assert.equal(cancelled.trackRequired, false);
  assert.equal(cancelled.trackSkippedReason, 'ORDER_CANCELLED');
});
