import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import XLSX from 'xlsx';

import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

test('unified workbook exposes six-business counts with priority and deduplication', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-unified-'));
  const file = path.join(dir, '日报表_2026-08-05.xlsx');
  try {
    const rows = [
      ['日报表'],
      ['运单编号', '收件人', '客户名称', '省份标识'],
      ['TEST000001', 'CE10001', 'CCSL', 'PP'],
      ['TEST000002', '', 'CCSL', 'PP'],
      ['TEST000003', 'TBKH', 'CCSL', 'PV'],
      ['TEST000004', 'ALI1688', 'CCSL', 'PP'],
      ['TEST000005', 'SHOPEECN', 'Shopee', 'PP'],
      ['TEST000006', 'SHOPEEVN', 'Shopee', 'PV'],
      ['TEST000007', 'SHOPEEVN SHOPEECN', 'Shopee', 'PV'],
      ['TEST000008', 'SHOPEEVN', 'Shopee', 'PV'],
      ['TEST000008', 'SHOPEEVN', 'Shopee', 'PV'],
      ['', 'CE99999', 'CCSL', 'PP']
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'sheet');
    XLSX.writeFile(workbook, file);

    const parsed = parseUnifiedDailyExcel(file, { reportDate: '2026-08-05' });
    assert.equal(parsed.reportDate, '2026-08-05');
    assert.deepEqual(parsed.classificationCounts, { CE: 2, CEAF: 0, TBKH: 1, ALI1688: 1, SHOPEECN: 1, SHOPEEVN: 3 });
    assert.deepEqual(parsed.sourceReconciliation, {
      businessTypes: ['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'],
      validUniqueWaybills: 8,
      classifiedWaybills: 8,
      difference: 0,
      balanced: true
    });
    assert.deepEqual(parsed.summary, {
      rawRows: 10,
      validUniqueWaybills: 8,
      duplicateRows: 1,
      missingWaybillRows: 1,
      missingRecipientWarnings: 1,
      classificationConflicts: 1
    });
    assert.equal(parsed.rows.find(row => row.shipmentCode === 'TEST000007')?.businessType, 'SHOPEEVN');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
