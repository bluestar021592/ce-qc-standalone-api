import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import XLSX from 'xlsx';
import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';
import { analyzeWhppShipment } from '../src/whppAnalyzer.js';
import { buildWhppDashboard } from '../src/whppReporting.js';
import { classifyLatestSpecialNode } from '../src/specialNode.js';

function parseRows(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-whpp-'));
  const file = path.join(dir, '日报2026-08-10.xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['运单号','收件人','收件省份'],
    ...rows
  ]), '日报');
  XLSX.writeFile(wb, file);
  try { return parseUnifiedDailyExcel(file, { reportDate: '2026-08-10', originalName: path.basename(file) }); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('WHPP runtime integration files pass node syntax checks', () => {
  for (const relative of ['src/whppAnalyzer.js','src/whppReporting.js','src/whppStore.js','src/whppPipeline.js','src/v42WhppPatch.js','src/v44WhppUiPatch.js','public/whpp-v42.js','public/whpp-v44.js','public/routing-v48.js']) {
    const file = path.resolve(relative);
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative} syntax failed:\n${result.stderr || result.stdout}`);
  }
});

test('daily import classifies CC as CE and CE as WHPP after explicit business overrides', () => {
  const parsed = parseRows([
    ['CC24081000001','NORMAL','Phnom Penh'],
    ['CE24081000002','NORMAL','Phnom Penh'],
    ['CE24081000003','SHOPEEVN','Kandal'],
    ['TBKH24081000004','TBKH','Kandal']
  ]);
  const byBill = new Map(parsed.rows.map(row => [row.shipmentCode, row.businessType]));
  assert.equal(byBill.get('CC24081000001'), 'CE');
  assert.equal(byBill.get('CE24081000002'), 'WHPP');
  assert.equal(byBill.get('CE24081000003'), 'SHOPEEVN');
  assert.equal(byBill.get('TBKH24081000004'), 'TBKH');
  assert.equal(parsed.classificationCounts.WHPP, 1);
  assert.equal(parsed.sourceReconciliation.balanced, true);
});

test('unmatched prefix is blocked instead of silently falling into CE', () => {
  assert.throws(() => parseRows([['ZZ24081000001','NORMAL','Phnom Penh']]), error => error?.code === 'UNCLASSIFIED_WAYBILL_PREFIX');
});

test('WHPP scan orderStatus 10 is a terminal order cancellation', () => {
  const result = analyzeWhppShipment({
    waybill: 'CE27072600018',
    scanRow: { shipmentCode: 'CE27072600018', orderStatus: '10' },
    events: [], exceptions: [], reportDate: '2026-07-27',
    apiStatus: { shipment: 'success', event: 'success', exception: 'success' }
  });
  assert.equal(result.currentState, 'ORDER_CANCELLED');
  assert.equal(result.订单取消, '是');
  assert.equal(result.是否POD, '否');
  assert.equal(result.退回状态, '未退回');
  assert.equal(result.carry状态, 'closed_cancelled');
  assert.equal(result.trackRequired, false);
});

test('WHPP exception type 20 + status 10 confirms cancellation and preserves reason details', () => {
  const result = analyzeWhppShipment({
    waybill: 'CE27072600018',
    scanRow: { shipmentCode: 'CE27072600018', orderStatus: '50' },
    events: [],
    exceptions: [{ shipmentCode: 'CE27072600018', exceptionType: '20', statusCode: '10', exceptionReasonCode: '3', exceptionChildReasonCode: '302', exceptionReason: 'cancel reason', exceptionChildReason: 'child reason', reportShop: 'xmDS01', reportTime: '2026-07-27 11:49:21' }],
    reportDate: '2026-07-27', apiStatus: { shipment: 'success', event: 'success', exception: 'success' }
  });
  assert.equal(result.currentState, 'ORDER_CANCELLED');
  assert.equal(result.cancellationReasonCode, '3');
  assert.equal(result.cancellationChildReasonCode, '302');
  assert.equal(result.cancellationReportShop, 'xmDS01');
  assert.equal(result.cancellationConfirmedAt, '2026-07-27 11:49:21');
});

test('POD terminal evidence outranks stale WHPP cancellation evidence', () => {
  const result = analyzeWhppShipment({
    waybill: 'CE-POD',
    scanRow: { shipmentCode: 'CE-POD', orderStatus: '85' },
    events: [],
    exceptions: [{ shipmentCode: 'CE-POD', exceptionType: '20', statusCode: '10', reportTime: '2026-07-26 10:00:00' }],
    reportDate: '2026-07-27', apiStatus: { shipment: 'success', event: 'success', exception: 'success' }
  });
  assert.equal(result.是否POD, '是');
  assert.notEqual(result.currentState, 'ORDER_CANCELLED');
});

test('CEL:CCSL580 is the dedicated 580 retention destination', () => {
  const result = classifyLatestSpecialNode([{ shipmentCode: 'CC1', eventTime: '2026-08-10 09:00:00', eventCode: '26', locationCode: 'CEL:CCSL580', trackingEventDescZh: '操作完成，货物到达网点 [CEL:CCSL580]' }]);
  assert.equal(result?.specialState, 'CCSL580_RETENTION');
  assert.equal(result?.label, '580滞留包裹');
  assert.equal(result?.latestNodeCode, 'CCSL580');
});

test('WHPP accounting keeps POD return cancellation special destination shops and unresolved mutually exclusive', () => {
  const rows = [
    { shipmentCode: 'CE1', reportDate: '2026-08-10', 是否POD: '是', currentState: 'POD', regionCode: 'PP' },
    { shipmentCode: 'CE2', reportDate: '2026-08-10', 退回状态: '已退回', currentState: 'RETURN_COMPLETED', regionCode: 'PP' },
    { shipmentCode: 'CE3', reportDate: '2026-08-10', 订单取消: '是', currentState: 'ORDER_CANCELLED', regionCode: 'PV' },
    { shipmentCode: 'CE4', reportDate: '2026-08-10', specialState: 'CCSL580_RETENTION', currentState: 'CCSL580_RETENTION', latestNodeCode: 'CCSL580', regionCode: 'PV' },
    { shipmentCode: 'CE5', reportDate: '2026-08-10', currentState: 'OPEN_TRACK_REQUIRED', regionCode: 'PV', Pending当前次数: 1 }
  ];
  const dashboard = buildWhppDashboard({ reportDate: '2026-08-10', pnhBills: rows.map(row => row.shipmentCode), dailyParseRows: rows, finalRows: rows });
  assert.deepEqual(dashboard.accounting, { total: 5, pod: 1, returned: 1, cancelled: 1, normalDiversion: 1, shops: 0, unresolved: 1, accounted: 5, difference: 0, balanced: true });
  assert.equal(dashboard.metrics.ccsl580Retention, 1);
  assert.equal(dashboard.metrics.ccsl580Diversion, 1, 'legacy alias must point to the same exact 580 set, never a second bucket');
  assert.equal(dashboard.detailTabs.ccsl580Retention.total, 1);
  assert.equal(dashboard.metrics.pending1, 1);
});

test('integrated WHPP dashboard exposes current business labels and empty-database notice', () => {
  const legacy = fs.readFileSync(new URL('../public/whpp-v42.js', import.meta.url), 'utf8');
  const fast = fs.readFileSync(new URL('../public/whpp-v44.js', import.meta.url), 'utf8');
  const routing = fs.readFileSync(new URL('../public/routing-v48.js', import.meta.url), 'utf8');
  for (const text of ['WHPP本土看板','订单取消','CCSLCN分流','CCSLZT分流','金边门店']) {
    assert.match(legacy + fast + routing, new RegExp(text));
  }
  assert.match(routing, /580滞留包裹/);
  assert.match(fast, /当前数据库暂无WHPP本土日报/);
  assert.match(fast, /AbortController/);
});
