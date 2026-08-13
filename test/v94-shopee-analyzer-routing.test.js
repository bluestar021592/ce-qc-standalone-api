import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v94-shopee-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'v94.db');

const { analyzeShopeeShipment, SHOPEE_ANALYSIS_RULE_VERSION } = await import('../src/shopeeAnalyzer.js');
const { closeDb } = await import('../src/db.js');

const ev = (code, time, text, extra = {}) => ({
  eventCode: String(code ?? ''),
  eventTime: time,
  trackingEventDesc: text,
  trackingEventDescZh: text,
  ...extra
});

function analyze({ waybill, orderStatus = '70', events = [] }) {
  return analyzeShopeeShipment({
    waybill,
    scanRow: { shipmentCode: waybill, orderStatus },
    shipmentTrackRow: {},
    dailyRow: { recipient_group: 'VN', regionCode: 'PP' },
    reportDate: '2026-08-13',
    analysisDate: '2026-08-13',
    exceptions: [],
    events
  });
}

test('facade uses V32/V94 rule version', () => {
  assert.match(SHOPEE_ANALYSIS_RULE_VERSION, /v94-shopee-whpp-terminal-location-v32/);
});

test('real latest arrival/current location WHPP remains the WHPP retention bucket', () => {
  const row = analyze({
    waybill: 'V94-WHPP-IN',
    events: [ev('26', '2026-08-13 10:00:00', '货物到达网点【CE:WHPP】', { locationCode: 'CE:WHPP' })]
  });
  assert.equal(row.currentState, 'SHOPEE_WHPP_RETENTION');
  assert.equal(row.primaryCategory, 'WHPP滞留包裹');
  assert.equal(row.WHPP滞留, '是');
});

test('return wording mentioning CE:WHPP is restored to ordinary state and never WHPP retention', () => {
  const row = analyze({
    waybill: 'V94-WHPP-RETURN-TEXT',
    events: [ev('26', '2026-08-13 10:00:00', '包裹从 CE:WHPP 退回处理中')]
  });
  assert.notEqual(row.currentState, 'SHOPEE_WHPP_RETENTION');
  assert.notEqual(row.primaryCategory, 'WHPP滞留包裹');
  assert.equal(row.WHPP滞留, '否');
  assert.ok(!(row.tags || []).includes('SHOPEE_WHPP_RETENTION'));
});

test('outbound from CE:WHPP with no later WHPP-arrival evidence is never WHPP retention', () => {
  const row = analyze({
    waybill: 'V94-WHPP-OUT',
    events: [ev('26', '2026-08-13 10:00:00', '货物离开网点【CE:WHPP】')]
  });
  assert.notEqual(row.currentState, 'SHOPEE_WHPP_RETENTION');
  assert.notEqual(row.primaryCategory, 'WHPP滞留包裹');
  assert.equal(row.WHPP滞留, '否');
});

test('POD and completed return remain terminal even if an older event arrived WHPP', () => {
  const inbound = ev('26', '2026-08-13 09:00:00', '货物到达网点【CE:WHPP】', { locationCode: 'CE:WHPP' });
  const pod = analyze({ waybill: 'V94-POD', orderStatus: '85', events: [inbound] });
  assert.equal(pod.是否POD, '是');
  assert.notEqual(pod.primaryCategory, 'WHPP滞留包裹');

  const returned = analyze({ waybill: 'V94-RETURN', orderStatus: '100', events: [inbound] });
  assert.equal(returned.退回状态, '已退回');
  assert.notEqual(returned.primaryCategory, 'WHPP滞留包裹');
});

test.after(() => {
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
