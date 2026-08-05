import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

const packageRoot = path.resolve('_codex_v9_20260805/QC监管APP开发4_CODEX执行包_v9_真实日报_自动日期_跨日复核_周月报_580最终总包');
const reportRoot = path.join(packageRoot, '09_真实日报_8月3日_8月4日');

test('V9 real 8-3 report detects OOXML content, date and exact classifications', () => {
  const parsed = parseUnifiedDailyExcel(path.join(reportRoot, '真实日报_2026-08-03.xls'));
  assert.equal(parsed.reportDate, '2026-08-03');
  assert.equal(parsed.dateDetectionSource, '下单时间列');
  assert.equal(parsed.containerFormat, 'OOXML_ZIP');
  assert.equal(parsed.summary.validUniqueWaybills, 6009);
  assert.deepEqual(parsed.classificationCounts, { CE: 258, TBKH: 1961, ALI1688: 1, SHOPEECN: 722, SHOPEEVN: 3067 });
  assert.deepEqual(parsed.regionCounts, { PP: 3122, PV: 2887 });
  assert.equal(parsed.summary.missingRecipientWarnings, 10);
  assert.deepEqual(parsed.dateCandidates, [{ date: '2026-08-03', count: 6009 }]);
  const prefixCase = parsed.rows.find(row => row.shipmentCode === 'TBKH000798496');
  assert.equal(prefixCase?.businessType, 'TBKH');
  assert.equal(prefixCase?.classificationSource, 'SHIPMENT_PREFIX');
});

test('V9 real 8-4 report detects OOXML content, date and exact classifications', () => {
  const parsed = parseUnifiedDailyExcel(path.join(reportRoot, '真实日报_2026-08-04.xls'));
  assert.equal(parsed.reportDate, '2026-08-04');
  assert.equal(parsed.dateDetectionSource, '下单时间列');
  assert.equal(parsed.containerFormat, 'OOXML_ZIP');
  assert.equal(parsed.summary.validUniqueWaybills, 9418);
  assert.deepEqual(parsed.classificationCounts, { CE: 6345, TBKH: 1, ALI1688: 695, SHOPEECN: 0, SHOPEEVN: 2377 });
  assert.deepEqual(parsed.regionCounts, { PP: 6472, PV: 2946 });
  assert.equal(parsed.summary.missingRecipientWarnings, 23);
  assert.deepEqual(parsed.dateCandidates, [{ date: '2026-08-04', count: 9418 }]);
});
