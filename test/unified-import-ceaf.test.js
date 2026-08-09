import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import XLSX from 'xlsx';

import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

test('customer name CCAF is classified as CEAF and six businesses reconcile exactly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-ceaf-'));
  const file = path.join(dir, '日报表_2026-08-09.xlsx');
  try {
    const rows = [
      ['日报表'],
      ['运单编号', '收件人', '客户名称', '省份标识'],
      ['CC0001', 'CE10001', 'CCSL', 'PP'],
      ['CC0002', 'ShopeeVN', 'C C A F', 'PV'],
      ['TBKH0001', 'CECN', 'CCSL', 'PV'],
      ['CC0004', 'ALI1688', 'CCSL', 'PP'],
      ['SPE0001', 'ShopeeCN', 'Shopee', 'PP'],
      ['SPE0002', 'ShopeeVN', 'Shopee', 'PV']
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'sheet');
    XLSX.writeFile(workbook, file);

    const parsed = parseUnifiedDailyExcel(file, { reportDate: '2026-08-09' });
    assert.deepEqual(parsed.classificationCounts, {
      CE: 1,
      CEAF: 1,
      TBKH: 1,
      ALI1688: 1,
      SHOPEECN: 1,
      SHOPEEVN: 1
    });
    assert.equal(parsed.sourceReconciliation.validUniqueWaybills, 6);
    assert.equal(parsed.sourceReconciliation.classifiedWaybills, 6);
    assert.equal(parsed.sourceReconciliation.difference, 0);
    assert.equal(parsed.sourceReconciliation.balanced, true);

    const ceaf = parsed.rows.find(row => row.shipmentCode === 'CC0002');
    assert.equal(ceaf?.businessType, 'CEAF');
    assert.equal(ceaf?.customerNameRaw, 'C C A F');
    assert.equal(ceaf?.customerNameNormalized, 'CCAF');
    assert.equal(ceaf?.classificationSource, 'CUSTOMER_NAME');
    assert.equal(ceaf?.classificationMatchedValue, 'CCAF');
    assert.match(ceaf?.classificationReason || '', /CCAF/);
    assert.match(ceaf?.classificationWarning || '', /CEAF,SHOPEEVN/);
    assert.equal(parsed.summary.classificationConflicts, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
