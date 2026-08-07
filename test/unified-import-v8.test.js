import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, '../_codex_v8_20260805/QC监管APP开发4_CODEX执行包_v8_最终总包_UI全页_导入兼容_全功能验收/05_日报解析兼容与测试/测试_真实日报多Sheet_表头别名_自动分类.xlsx');

test('V8 parser merges valid sheets, supports aliases and returns diagnostics', () => {
  const parsed = parseUnifiedDailyExcel(fixture);
  assert.equal(parsed.reportDate, '2026-08-03');
  assert.deepEqual(parsed.classificationCounts, { CE: 2, TBKH: 1, ALI1688: 2, SHOPEECN: 2, SHOPEEVN: 3 });
  assert.deepEqual(parsed.summary, { rawRows: 12, validUniqueWaybills: 10, duplicateRows: 1, missingWaybillRows: 1, missingRecipientWarnings: 1, classificationConflicts: 1 });
  assert.equal(parsed.sheetDiagnostics.filter(row => row.status === 'VALID').length, 2);
  assert.equal(parsed.sheetDiagnostics.find(row => row.sheetName === '中文日报')?.headerRow, 4);
  assert.equal(parsed.sheetDiagnostics.find(row => row.sheetName === 'Daily_EN')?.headerRow, 3);
});
