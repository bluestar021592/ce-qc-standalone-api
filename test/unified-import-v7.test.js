import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import XLSX from 'xlsx';

import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

test('unified workbook exposes seven-business counts with priority and deduplication', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-unified-'));
  const file = path.join(dir, '日报表_2026-08-05.xlsx');
  try {
    const rows = [
      ['日报表'],
      ['运单编号', '收件人', '客户名称', '省份标识'],
      ['CC000001', 'CE10001', 'CCSL', 'PP'],
      ['CC000002', '', 'CCSL', 'PP'],
      ['TBKH000003', 'TBKH', 'CCSL', 'PV'],
      ['CC000004', 'ALI1688', 'CCSL', 'PP'],
      ['CC000005', 'SHOPEECN', 'Shopee', 'PP'],
      ['CC000006', 'SHOPEEVN', 'Shopee', 'PV'],
      ['CC000007', 'SHOPEEVN SHOPEECN', 'Shopee', 'PV'],
      ['CC000008', 'SHOPEEVN', 'Shopee', 'PV'],
      ['CC000008', 'SHOPEEVN', 'Shopee', 'PV'],
      ['CE000009', '', 'CCSL', 'PV'],
      ['', 'CE99999', 'CCSL', 'PP']
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'sheet');
    XLSX.writeFile(workbook, file);

    const parsed = parseUnifiedDailyExcel(file, { reportDate: '2026-08-05' });
    assert.equal(parsed.reportDate, '2026-08-05');
    assert.deepEqual(parsed.classificationCounts, { CE: 2, CEAF: 0, TBKH: 1, ALI1688: 1, SHOPEECN: 1, SHOPEEVN: 3, WHPP: 1 });
    assert.deepEqual(parsed.sourceReconciliation, {
      businessTypes: ['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN', 'WHPP'],
      validUniqueWaybills: 9,
      classifiedWaybills: 9,
      difference: 0,
      balanced: true
    });
    assert.deepEqual(parsed.summary, {
      rawRows: 11,
      validUniqueWaybills: 9,
      duplicateRows: 1,
      duplicateRegionEnrichments: 0,
      missingWaybillRows: 1,
      missingRecipientWarnings: 2,
      classificationConflicts: 1,
      parseElapsedMs: parsed.summary.parseElapsedMs
    });
    assert.equal(parsed.rows.find(row => row.shipmentCode === 'CC000007')?.businessType, 'SHOPEEVN');
    assert.equal(parsed.rows.find(row => row.shipmentCode === 'CE000009')?.businessType, 'WHPP');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
