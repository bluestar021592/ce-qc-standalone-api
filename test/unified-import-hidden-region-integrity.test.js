import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import XLSX from 'xlsx';

import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

function withWorkbook(name, build, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v513-'));
  const file = path.join(dir, name);
  try {
    const workbook = XLSX.utils.book_new();
    build(workbook);
    XLSX.writeFile(workbook, file);
    return run(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function append(workbook, name, rows) {
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
}

test('hidden sheet containing shipment evidence is never silently skipped', () => {
  withWorkbook('日报表_2026-09-14.xlsx', workbook => {
    append(workbook, '日报', [
      ['运单编号', '收件人', '客户名称', '省份标识'],
      ['CC000001', 'CE10001', 'CCSL', 'PP']
    ]);
    append(workbook, '隐藏数据', [
      ['运单编号', '收件人', '客户名称', '省份标识'],
      ['CE000099', 'CE10099', 'CCSL', 'PV']
    ]);
    workbook.Workbook ||= {};
    workbook.Workbook.Sheets ||= workbook.SheetNames.map(name => ({ name }));
    const hidden = workbook.Workbook.Sheets.find(item => item.name === '隐藏数据');
    hidden.Hidden = 1;
  }, file => {
    assert.throws(
      () => parseUnifiedDailyExcel(file, { reportDate: '2026-09-14' }),
      error => error?.code === 'HIDDEN_WAYBILL_SHEET'
        && error?.sheetName === '隐藏数据'
        && Number(error?.suspectedCount || 0) >= 1
        && Array.isArray(error?.suspectedWaybills)
        && error.suspectedWaybills.includes('CE000099')
    );
  });
});

test('hidden notes sheet without shipment evidence remains safely skippable', () => {
  withWorkbook('日报表_2026-09-14.xlsx', workbook => {
    append(workbook, '日报', [
      ['运单编号', '收件人', '客户名称', '省份标识'],
      ['CC000001', 'CE10001', 'CCSL', 'PP']
    ]);
    append(workbook, '隐藏说明', [
      ['说明'],
      ['本页仅用于模板备注，不包含业务数据。']
    ]);
    workbook.Workbook ||= {};
    workbook.Workbook.Sheets ||= workbook.SheetNames.map(name => ({ name }));
    const hidden = workbook.Workbook.Sheets.find(item => item.name === '隐藏说明');
    hidden.Hidden = 1;
  }, file => {
    const parsed = parseUnifiedDailyExcel(file, { reportDate: '2026-09-14' });
    assert.equal(parsed.summary.validUniqueWaybills, 1);
    assert.equal(parsed.sourceReconciliation.balanced, true);
    assert.equal(parsed.sheetDiagnostics.find(item => item.sheetName === '隐藏说明')?.status, 'SKIPPED');
  });
});

test('same-business duplicate enriches a missing region instead of keeping UNKNOWN', () => {
  withWorkbook('日报表_2026-09-14.xlsx', workbook => {
    append(workbook, '日报', [
      ['运单编号', '收件人', '客户名称', '省份标识'],
      ['CC000001', 'CE10001', 'CCSL', ''],
      ['CC000001', 'CE10001', 'CCSL', 'PP']
    ]);
  }, file => {
    const parsed = parseUnifiedDailyExcel(file, { reportDate: '2026-09-14' });
    assert.equal(parsed.summary.validUniqueWaybills, 1);
    assert.equal(parsed.summary.duplicateRows, 1);
    assert.equal(parsed.summary.duplicateRegionEnrichments, 1);
    assert.equal(parsed.rows[0].businessType, 'CE');
    assert.equal(parsed.rows[0].regionCode, 'PP');
    assert.equal(parsed.regionCounts.PP, 1);
    assert.equal(parsed.regionCounts.UNKNOWN, 0);
    assert.ok(parsed.warnings.some(item => item.type === 'DUPLICATE_REGION_ENRICHED'));
  });
});

test('same-business duplicate with PP/PV conflict fails closed', () => {
  withWorkbook('日报表_2026-09-14.xlsx', workbook => {
    append(workbook, '日报', [
      ['运单编号', '收件人', '客户名称', '省份标识'],
      ['CC000001', 'CE10001', 'CCSL', 'PP'],
      ['CC000001', 'CE10001', 'CCSL', 'PV']
    ]);
  }, file => {
    assert.throws(
      () => parseUnifiedDailyExcel(file, { reportDate: '2026-09-14' }),
      error => error?.code === 'DUPLICATE_REGION_CONFLICT'
        && error?.shipmentCode === 'CC000001'
        && error?.first?.regionCode === 'PP'
        && error?.duplicate?.regionCode === 'PV'
    );
  });
});
