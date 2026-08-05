import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, '../_codex_dev4v7_20260805/QC监管APP开发4_CODEX执行包_v7_统一日报真实改造_强制执行/04_测试资料/测试_日报表一次上传自动分类.xlsx');

test('V7 unified workbook classifies five businesses with priority and deduplication', () => {
  const parsed = parseUnifiedDailyExcel(fixture);
  assert.equal(parsed.reportDate, '2026-08-05');
  assert.deepEqual(parsed.classificationCounts, { CE: 2, TBKH: 1, ALI1688: 1, SHOPEECN: 1, SHOPEEVN: 3 });
  assert.deepEqual(parsed.summary, {
    rawRows: 10,
    validUniqueWaybills: 8,
    duplicateRows: 1,
    missingWaybillRows: 1,
    missingRecipientWarnings: 1,
    classificationConflicts: 1
  });
  assert.equal(parsed.rows.find(row => row.shipmentCode === 'TEST000007')?.businessType, 'SHOPEEVN');
});
