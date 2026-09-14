import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import XLSX from 'xlsx';

import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

function writeWorkbook(dir, rows, name = '日报表_2026-09-13.xlsx') {
  const file = path.join(dir, name);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '日报');
  XLSX.writeFile(workbook, file);
  return file;
}

test('duplicate rows with the same resolved business remain one conserved shipment', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-dup-same-'));
  try {
    const file = writeWorkbook(dir, [
      ['运单编号', '收件人', '客户名称', '省份标识'],
      ['CC123456', 'CE10001', 'CCSL', 'PP'],
      ['CC123456', 'CE10001', 'CCSL', 'PP'],
      ['CE123456', 'CE10002', 'CCSL', 'PV']
    ]);
    const parsed = parseUnifiedDailyExcel(file, { reportDate: '2026-09-13' });
    assert.equal(parsed.summary.rawRows, 3);
    assert.equal(parsed.summary.validUniqueWaybills, 2);
    assert.equal(parsed.summary.duplicateRows, 1);
    assert.equal(parsed.sourceReconciliation.balanced, true);
    assert.deepEqual(parsed.classificationCounts, {
      CE: 1,
      CEAF: 0,
      TBKH: 0,
      ALI1688: 0,
      SHOPEECN: 0,
      SHOPEEVN: 0,
      WHPP: 1
    });
    const duplicate = parsed.warnings.find(item => item.type === 'DUPLICATE');
    assert.equal(duplicate?.firstBusinessType, 'CE');
    assert.equal(duplicate?.duplicateBusinessType, 'CE');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate shipment with conflicting business evidence fails closed instead of keeping the first row silently', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-dup-conflict-'));
  try {
    const file = writeWorkbook(dir, [
      ['运单编号', '收件人', '客户名称', '省份标识'],
      ['CC999999', 'CE10001', 'CCSL', 'PP'],
      ['CC999999', 'SHOPEECN', 'Shopee', 'PP']
    ]);
    assert.throws(
      () => parseUnifiedDailyExcel(file, { reportDate: '2026-09-13' }),
      error => {
        assert.equal(error?.code, 'DUPLICATE_BUSINESS_CLASSIFICATION_CONFLICT');
        assert.equal(error?.shipmentCode, 'CC999999');
        assert.equal(error?.first?.businessType, 'CE');
        assert.equal(error?.duplicate?.businessType, 'SHOPEECN');
        assert.match(String(error?.message || ''), /自动分类错票/);
        return true;
      }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate row with incomplete evidence does not erase a previously confirmed classification', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-dup-incomplete-'));
  try {
    const file = writeWorkbook(dir, [
      ['运单编号', '收件人', '客户名称', '省份标识'],
      ['SPX100001', 'SHOPEEVN', 'Shopee', 'PV'],
      ['SPX100001', '', '', 'PV']
    ]);
    const parsed = parseUnifiedDailyExcel(file, { reportDate: '2026-09-13' });
    assert.equal(parsed.summary.validUniqueWaybills, 1);
    assert.equal(parsed.summary.duplicateRows, 1);
    assert.equal(parsed.classificationCounts.SHOPEEVN, 1);
    assert.equal(parsed.rows[0]?.businessType, 'SHOPEEVN');
    assert.equal(parsed.warnings.find(item => item.type === 'DUPLICATE')?.duplicateBusinessType, 'UNRESOLVED');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
