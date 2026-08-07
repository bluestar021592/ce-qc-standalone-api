import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';

import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

function writeBook(file, rows, sheetName = '日报') {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, file, { bookType: path.extname(file).toLowerCase() === '.xls' ? 'biff8' : 'xlsx' });
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v13-'));
}

test('V13 unified import accepts 收件人名称 after title rows, short filename date, five-business priority and province mapping', () => {
  const dir = tempDir();
  const file = path.join(dir, '日报表 (8-4).xls');
  const rows = Array.from({ length: 19 }, (_, index) => [index === 0 ? 'CE Express 综合日报' : '']);
  rows.push(['运单号', '收件人名称', '收件省份', '下单时间']);
  rows.push(['SPEVN00000001', 'SHOPEEVN', 'Phnom Penh', '2026-08-03 11:00:00']);
  rows.push(['SPECN00000001', 'SHOPEECN', '金边', '2026-08-03 11:00:00']);
  rows.push(['TBKH00000001', '普通客户', 'Kandal', '2026-08-03 11:00:00']);
  rows.push(['CEALI00000001', 'ALI1688 CLIENT', 'Siem Reap', '2026-08-03 11:00:00']);
  rows.push(['CE00000000001', 'NORMAL CUSTOMER', '', '2026-08-03 11:00:00']);
  rows.push(['CONFLICT000001', 'SHOPEEVN ALI1688', 'Battambang', '2026-08-03 11:00:00']);
  writeBook(file, rows);

  const result = parseUnifiedDailyExcel(file, { originalName: path.basename(file), referenceDate: '2026-08-07' });
  assert.equal(result.reportDate, '2026-08-04');
  assert.equal(result.dateDetectionSource, '文件名');
  assert.deepEqual(result.classificationCounts, { CE: 1, TBKH: 1, ALI1688: 1, SHOPEECN: 1, SHOPEEVN: 2 });
  assert.equal(result.regionCounts.PP, 2);
  assert.equal(result.regionCounts.PV, 3);
  assert.equal(result.regionCounts.UNKNOWN, 1);
  assert.equal(result.summary.classificationConflicts, 1);
  assert.equal(result.rows.find(row => row.shipmentCode === 'CONFLICT000001')?.businessType, 'SHOPEEVN');
  assert.equal(result.rows.find(row => row.shipmentCode === 'SPEVN00000001')?.regionCode, 'PP');
  assert.equal(result.rows.find(row => row.shipmentCode === 'TBKH00000001')?.regionCode, 'PV');
  assert.equal(result.rows.find(row => row.shipmentCode === 'CE00000000001')?.regionCode, '');
  assert.equal(result.sheetDiagnostics[0]?.detectedColumns?.recipientHeader, '收件人名称');
  assert.ok(result.rows[0]?.raw && typeof result.rows[0].raw === 'object');
});

test('V13 explicit 日报日期 outranks filename and transaction dates', () => {
  const dir = tempDir();
  const file = path.join(dir, '8-4.xlsx');
  writeBook(file, [
    ['运单号', '收件人', '省份', '日报日期', '下单时间'],
    ['CE00000000002', 'NORMAL', 'Phnom Penh', '2026-08-05', '2026-08-03 10:00:00'],
    ['CE00000000003', 'NORMAL', 'Kandal', '2026-08-05', '2026-08-03 10:00:00']
  ]);
  const result = parseUnifiedDailyExcel(file, { originalName: '8-4.xlsx', referenceDate: '2026-08-07' });
  assert.equal(result.reportDate, '2026-08-05');
  assert.equal(result.dateDetectionSource, '日报日期列');
});

test('V13 manual report date remains highest priority', () => {
  const dir = tempDir();
  const file = path.join(dir, '8-4.xlsx');
  writeBook(file, [
    ['shipmentCode', 'recipientName', 'province', '日报日期'],
    ['SPEVN00000002', 'SHOPEEVN', 'Kandal', '2026-08-05']
  ]);
  const result = parseUnifiedDailyExcel(file, { reportDate: '2026-08-06', originalName: '8-4.xlsx', referenceDate: '2026-08-07' });
  assert.equal(result.reportDate, '2026-08-06');
  assert.equal(result.dateDetectionSource, '手动日期');
  assert.equal(result.dateWasManuallyCorrected, true);
});

test('V13 recipient value heuristic supports unfamiliar recipient header when tagged business values exist', () => {
  const dir = tempDir();
  const file = path.join(dir, '2026-08-07.xlsx');
  writeBook(file, [
    ['运单号', '客户标记', '收件省份'],
    ['SPECN00000002', 'SHOPEECN', 'Phnom Penh'],
    ['CE00000000004', 'NORMAL', 'Kandal']
  ]);
  const result = parseUnifiedDailyExcel(file, { originalName: path.basename(file) });
  assert.equal(result.classificationCounts.SHOPEECN, 1);
  assert.equal(result.classificationCounts.CE, 1);
  assert.equal(result.sheetDiagnostics[0]?.detectedColumns?.recipientDetection, 'VALUE_HEURISTIC');
});

test('V13 duplicate waybill is counted once and first classification wins deterministically', () => {
  const dir = tempDir();
  const file = path.join(dir, '2026-08-07.xlsx');
  writeBook(file, [
    ['运单号', '收件人名称', '省份'],
    ['DUP000000001', 'SHOPEECN', 'Phnom Penh'],
    ['DUP000000001', 'SHOPEEVN', 'Kandal']
  ]);
  const result = parseUnifiedDailyExcel(file, { originalName: path.basename(file) });
  assert.equal(result.summary.validUniqueWaybills, 1);
  assert.equal(result.summary.duplicateRows, 1);
  assert.equal(result.rows[0].businessType, 'SHOPEECN');
});
