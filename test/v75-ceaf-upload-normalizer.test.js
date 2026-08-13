import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import XLSX from 'xlsx';

import { __test as v75 } from '../src/v75CeafUploadNormalizerPatch.js';
import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

test('V75 normalizes an unrecognized CCAF source column before unified parsing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v75-'));
  const file = path.join(dir, '日报表_2026-08-01.xlsx');
  try {
    const rows = [['运单编号', '收件人', '业务客户标识', '省份标识']];
    for (let index = 1; index <= 80; index += 1) {
      rows.push([`CEAIR${String(index).padStart(4, '0')}`, `AIR-${index}`, 'CCAF', 'PP']);
    }
    for (let index = 1; index <= 196; index += 1) {
      rows.push([`CELOCAL${String(index).padStart(4, '0')}`, `LOCAL-${index}`, 'CCSL', 'PP']);
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '日报');
    XLSX.writeFile(workbook, file);

    const normalized = v75.normalizeUploadedWorkbook(file);
    assert.equal(normalized.changed, true);
    assert.equal(normalized.airRows, 80);

    const parsed = parseUnifiedDailyExcel(file, { reportDate: '2026-08-01', originalName: '日报表_2026-08-01.xlsx' });
    assert.equal(parsed.summary.validUniqueWaybills, 276);
    assert.equal(parsed.classificationCounts.CEAF, 80);
    assert.equal(parsed.classificationCounts.WHPP, 196);
    assert.equal(parsed.classificationCounts.CE, 0);
    assert.equal(parsed.sourceReconciliation.classifiedWaybills, 276);
    assert.equal(parsed.sourceReconciliation.balanced, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('V75 is loaded before V42 so V42 cannot discard the upload guard', () => {
  const bootstrap = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
  const v75Index = bootstrap.indexOf('v75CeafUploadNormalizerPatch');
  const v42Index = bootstrap.indexOf('v42WhppPatch');
  const serverIndex = bootstrap.indexOf("importPhase('server', './server.js')");
  assert.ok(v75Index >= 0);
  assert.ok(v42Index > v75Index);
  assert.ok(serverIndex > v42Index);
});
