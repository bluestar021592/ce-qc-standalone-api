import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyScanTerminal } from '../src/scanTerminal.js';
import { analyzeShopeeShipment } from '../src/shopeeAnalyzerV31.js';
import { analyzeWhppShipment } from '../src/whppAnalyzer.js';

const whppPipeline = fs.readFileSync(new URL('../src/whppPipeline.js', import.meta.url), 'utf8');
const uiUrl = new URL('../public/v85-business-rule-ui.js', import.meta.url);
const metricUrl = new URL('../src/v85ShopeeWhppMetricPatch.js', import.meta.url);
const ui = fs.readFileSync(uiUrl, 'utf8');
const metric = fs.readFileSync(metricUrl, 'utf8');
const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');

function event(code, time, text, extra = {}) {
  return { eventCode: String(code ?? ''), eventTime: time, trackingEventDesc: text, trackingEventDescZh: text, ...extra };
}

test('V85 runtime files are syntax valid', () => {
  for (const url of [uiUrl, metricUrl]) {
    const check = spawnSync(process.execPath, ['--check', fileURLToPath(url)], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr || check.stdout);
  }
});

test('CE/TBKH/ALI1688/CEAF scan terminal gate: 50/60/70 need trajectory; 85 POD and 100 return do not', () => {
  for (const status of ['50', '60', '70']) {
    const row = classifyScanTerminal({ shipmentCode: `OPEN-${status}`, orderStatus: status }, 'success');
    assert.equal(row.trackRequired, true, status);
    assert.equal(row.currentState, 'OPEN_TRACK_REQUIRED', status);
  }
  const pod = classifyScanTerminal({ shipmentCode: 'POD', orderStatus: '85' }, 'success');
  assert.equal(pod.currentState, 'POD');
  assert.equal(pod.trackRequired, false);
  assert.equal(pod.trackSkippedReason, 'POD_COMPLETED');

  const returned = classifyScanTerminal({ shipmentCode: 'RETURN', orderStatus: '100' }, 'success');
  assert.equal(returned.currentState, 'RETURN_COMPLETED');
  assert.equal(returned.trackRequired, false);
  assert.equal(returned.trackSkippedReason, 'RETURN_COMPLETED');
});

test('Shopee CN/VN scan 85 and 100 are terminal and never require trajectory', () => {
  const pod = analyzeShopeeShipment({ waybill: 'S-POD', scanRow: { orderStatus: '85' }, events: [], reportDate: '2026-08-13', analysisDate: '2026-08-13', dailyRow: { recipient_group: 'CN' } });
  assert.equal(pod.是否POD, '是');
  assert.equal(pod.trackRequired, false);
  assert.equal(pod.trackSkippedReason, 'POD_COMPLETED');

  const returned = analyzeShopeeShipment({ waybill: 'S-RET', scanRow: { orderStatus: '100' }, events: [], reportDate: '2026-08-13', analysisDate: '2026-08-13', dailyRow: { recipient_group: 'VN' } });
  assert.equal(returned.退回状态, '已退回');
  assert.equal(returned.trackRequired, false);
  assert.equal(returned.trackSkippedReason, 'RETURN_COMPLETED');
});

test('WHPP scan cancellation, return and POD remain no-track terminal routes', () => {
  const cancelled = analyzeWhppShipment({ waybill: 'W-CANCEL', scanRow: { orderStatus: '10' }, events: [], reportDate: '2026-08-13', analysisDate: '2026-08-13' });
  assert.equal(cancelled.currentState, 'ORDER_CANCELLED');
  assert.equal(cancelled.trackRequired, false);

  const returned = analyzeWhppShipment({ waybill: 'W-RETURN', scanRow: { orderStatus: '100' }, events: [], reportDate: '2026-08-13', analysisDate: '2026-08-13' });
  assert.equal(returned.trackRequired, false);

  const pod = analyzeWhppShipment({ waybill: 'W-POD', scanRow: { orderStatus: '85' }, events: [], reportDate: '2026-08-13', analysisDate: '2026-08-13' });
  assert.equal(pod.trackRequired, false);

  assert.match(whppPipeline, /\['85','100'\]/);
  assert.match(whppPipeline, /orderStatus[^\n]*=== '10'/);
  assert.match(whppPipeline, /!scanTerminal\.has\(bill\)/);
});

test('latest effective CE:WHPP becomes one Shopee WHPP responsibility retention bucket and no ordinary anomaly', () => {
  const result = analyzeShopeeShipment({
    waybill: 'S-WHPP',
    scanRow: { orderStatus: '70' },
    dailyRow: { recipient_group: 'CN', regionCode: 'PP' },
    reportDate: '2026-08-13',
    analysisDate: '2026-08-13',
    events: [event('', '2026-08-13 10:00:00', '货物到达网点【CE:WHPP】', { locationCode: 'WHPP' })]
  });
  assert.equal(result.currentState, 'SHOPEE_WHPP_RETENTION');
  assert.equal(result.primaryCategory, 'WHPP滞留包裹');
  assert.equal(result.WHPP滞留, '是');
  assert.equal(result.responsibilityHub, 'WHPP');
  assert.equal(result.trackRequired, true, 'WHPP is an open responsibility location and keeps future tracking until terminal closure');
  assert.equal(result.Pending次数, 0);
  assert.equal(result.Pending不连续, '否');
  assert.equal(result.OC天数, 0);
  assert.equal(result.盘点天数, 0);
  assert.equal(result.入库无扫描节点, '否');
  assert.equal(result.pvOpenDisposition, '', 'WHPP is independent from PP/PV unresolved buckets');
});

test('historical CE:WHPP does not win over a newer node and terminal scan still outranks WHPP', () => {
  const laterPending = analyzeShopeeShipment({
    waybill: 'S-WHPP-HISTORY', scanRow: { orderStatus: '70' }, reportDate: '2026-08-13', analysisDate: '2026-08-13',
    events: [
      event('', '2026-08-12 10:00:00', '货物到达网点【CE:WHPP】', { locationCode: 'WHPP' }),
      event('150', '2026-08-13 10:00:00', 'Pending: recipient unavailable', { locationCode: 'CCSL' })
    ]
  });
  assert.notEqual(laterPending.currentState, 'SHOPEE_WHPP_RETENTION');
  assert.notEqual(laterPending.primaryCategory, 'WHPP滞留包裹');

  const pod = analyzeShopeeShipment({
    waybill: 'S-WHPP-POD', scanRow: { orderStatus: '85' }, reportDate: '2026-08-13', analysisDate: '2026-08-13',
    events: [event('', '2026-08-13 10:00:00', '货物到达网点【CE:WHPP】', { locationCode: 'WHPP' })]
  });
  assert.equal(pod.currentState, 'POD');
  assert.equal(pod.是否POD, '是');
  assert.notEqual(pod.primaryCategory, 'WHPP滞留包裹');
});

test('Shopee WHPP metric uses normalized SQLite and stays independent from PP/PV', () => {
  assert.match(metric, /ROUTE = '\/api\/v85\/shopee-whpp-retention'/);
  assert.match(metric, /business_final_rows f/);
  assert.match(metric, /unified_import_rows u/);
  assert.match(metric, /u\.businessType=\?/);
  assert.match(metric, /latestNode/);
  assert.match(metric, /latestEventDesc/);
  assert.match(metric, /WHPP滞留包裹/);
  assert.match(metric, /splitByRegion: false/);
  assert.match(metric, /pageSize = Math\.max\(1, Math\.min\(1000/);
  assert.doesNotMatch(metric, /DELETE FROM|UPDATE business_|INSERT INTO|DROP TABLE/i);
  assert.match(bootstrap, /v85ShopeeWhppMetricPatch/);
});

test('business UI hides impossible special nodes and shows one combined range-safe Shopee WHPP metric', () => {
  assert.match(ui, /removeMetricCards\(\['CCSLCN分流', 'CCSLZT分流', '580滞留包裹', 'CECN滞留包裹', 'CEZT滞留包裹'\]\)/);
  assert.match(ui, /removeMetricCards\(\['580滞留包裹', 'CCSLCN分流', 'CECN滞留包裹'\]\)/);
  assert.match(ui, /WHPP滞留包裹/);
  assert.match(ui, /WHPP责任 · PP\/PV合并/);
  assert.match(ui, /\/api\/v85\/shopee-whpp-retention/);
  assert.doesNotMatch(ui, /\/api\/business-state\//);
  assert.match(ui, /selectedRange/);
  assert.match(ui, /node && node\.textContent !== text/);
  assert.match(ui, /setText\(card\.querySelector\('b'\), fmt\(payload\.total\)\)/);
  assert.match(injector, /v85-business-rule-ui\.js\?v=20260813-1/);
});
