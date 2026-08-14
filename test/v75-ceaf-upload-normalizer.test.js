import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import XLSX from 'xlsx';

import { __test as v75 } from '../src/v75CeafUploadNormalizerPatch.js';
import { assertUnifiedImportSafety } from '../src/v102UnifiedImportSafetyGatePatch.js';
import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

function writeBook(file, rows, sheetName = '日报') {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  XLSX.writeFile(workbook, file);
  return file;
}

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

    writeBook(file, rows);
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
    const accepted = assertUnifiedImportSafety({ filePath: file, parsed, manualReportDate: '2026-08-01' });
    assert.equal(accepted.readyForPersistence, true);
    assert.equal(accepted.validUniqueWaybills, 276);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('V102 blocks a row that simultaneously matches multiple strong business rules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v102-conflict-'));
  const file = path.join(dir, '日报表_2026-08-02.xlsx');
  try {
    writeBook(file, [
      ['运单编号', '收件人', '客户名称', '省份标识'],
      ['CCCONFLICT0001', 'SHOPEEVN ALI1688', 'CCSL', 'PP']
    ]);
    const parsed = parseUnifiedDailyExcel(file, { reportDate: '2026-08-02', originalName: path.basename(file) });
    assert.equal(parsed.summary.classificationConflicts, 1);
    assert.throws(
      () => assertUnifiedImportSafety({ filePath: file, parsed, manualReportDate: '2026-08-02' }),
      error => error?.code === 'CLASSIFICATION_CONFLICT_BLOCKED'
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('V102 blocks the same waybill when duplicate rows disagree on business ownership', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v102-duplicate-'));
  const file = path.join(dir, '日报表_2026-08-03.xlsx');
  try {
    writeBook(file, [
      ['运单编号', '收件人', '客户名称', '省份标识'],
      ['CCDUPLICATE0001', 'SHOPEECN', 'CCSL', 'PP'],
      ['CCDUPLICATE0001', 'SHOPEEVN', 'CCSL', 'PV']
    ]);
    const parsed = parseUnifiedDailyExcel(file, { reportDate: '2026-08-03', originalName: path.basename(file) });
    assert.equal(parsed.summary.duplicateRows, 1);
    assert.throws(
      () => assertUnifiedImportSafety({ filePath: file, parsed, manualReportDate: '2026-08-03' }),
      error => error?.code === 'DUPLICATE_WAYBILL_BUSINESS_CONFLICT'
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('V102 allows same-business duplicate rows and still preserves one unique member', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v102-duplicate-ok-'));
  const file = path.join(dir, '日报表_2026-08-04.xlsx');
  try {
    writeBook(file, [
      ['运单编号', '收件人', '客户名称', '省份标识'],
      ['CCDUPLICATE0002', 'SHOPEECN', 'CCSL', 'PP'],
      ['CCDUPLICATE0002', 'SHOPEECN', 'CCSL', 'PP']
    ]);
    const parsed = parseUnifiedDailyExcel(file, { reportDate: '2026-08-04', originalName: path.basename(file) });
    const accepted = assertUnifiedImportSafety({ filePath: file, parsed, manualReportDate: '2026-08-04' });
    assert.equal(parsed.summary.validUniqueWaybills, 1);
    assert.equal(parsed.summary.duplicateRows, 1);
    assert.equal(accepted.readyForPersistence, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('V102 blocks majority-date guessing when no explicit or filename report date exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v102-date-'));
  const file = path.join(dir, '日报表.xlsx');
  try {
    writeBook(file, [
      ['运单编号', '收件人', '客户名称', '下单日期'],
      ['CCDATE0001', 'NORMAL', 'CCSL', '2026-08-05'],
      ['CCDATE0002', 'NORMAL', 'CCSL', '2026-08-06'],
      ['CCDATE0003', 'NORMAL', 'CCSL', '2026-08-06']
    ]);
    const parsed = parseUnifiedDailyExcel(file, { originalName: path.basename(file) });
    assert.equal(parsed.dateDetectionSource, '业务日期列');
    assert.ok(parsed.transactionDateCandidates.length > 1);
    assert.throws(
      () => assertUnifiedImportSafety({ filePath: file, parsed }),
      error => error?.code === 'REPORT_DATE_AMBIGUOUS_BLOCKED'
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('V102 is loaded after V75 normalization and before V42 persistence owner', () => {
  const bootstrap = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
  const v75Index = bootstrap.indexOf('v75CeafUploadNormalizerPatch');
  const v102Index = bootstrap.indexOf('v102UnifiedImportSafetyGatePatch');
  const v42Index = bootstrap.indexOf('v42WhppPatch');
  const serverIndex = bootstrap.indexOf("importPhase('server', './server.js')");
  assert.ok(v75Index >= 0);
  assert.ok(v102Index > v75Index);
  assert.ok(v42Index > v102Index);
  assert.ok(serverIndex > v42Index);
});
