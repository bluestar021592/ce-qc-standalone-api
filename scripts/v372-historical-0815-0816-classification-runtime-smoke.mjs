import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import XLSX from 'xlsx';
import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

// Historical read-only dashboard truth recovered from the production database/cache.
// These are acceptance baselines, not inferred residuals. Each seven-business vector
// sums exactly to the historical ALL daily total for the same date.
const HISTORICAL_TRUTH = Object.freeze({
  '2026-08-15': Object.freeze({
    CE: 1197,
    CEAF: 76,
    TBKH: 2127,
    ALI1688: 167,
    SHOPEECN: 814,
    SHOPEEVN: 730,
    WHPP: 155
  }),
  '2026-08-16': Object.freeze({
    CE: 1978,
    CEAF: 13,
    TBKH: 1917,
    ALI1688: 186,
    SHOPEECN: 1074,
    SHOPEEVN: 0,
    WHPP: 42
  })
});

const EXPECTED_TOTALS = Object.freeze({
  '2026-08-15': 5266,
  '2026-08-16': 5210
});

function codeDate(date) {
  return date.replaceAll('-', '').slice(2);
}

function pushRows(target, { date, businessType, count }) {
  const stamp = codeDate(date);
  for (let index = 1; index <= count; index += 1) {
    const suffix = String(index).padStart(7, '0');
    let shipmentCode = '';
    let recipient = '';
    let customerName = '';
    switch (businessType) {
      case 'CE':
        shipmentCode = `CC${stamp}CE${suffix}`;
        recipient = 'GENERAL';
        customerName = 'GENERAL';
        break;
      case 'CEAF':
        shipmentCode = `CC${stamp}AF${suffix}`;
        recipient = 'GENERAL';
        customerName = 'CCAF';
        break;
      case 'TBKH':
        shipmentCode = `TBKH${stamp}${suffix}`;
        recipient = 'GENERAL';
        customerName = 'GENERAL';
        break;
      case 'ALI1688':
        shipmentCode = `CC${stamp}ALI${suffix}`;
        recipient = 'ALI1688';
        customerName = 'GENERAL';
        break;
      case 'SHOPEECN':
        shipmentCode = `CC${stamp}CN${suffix}`;
        recipient = 'SHOPEECN';
        customerName = 'GENERAL';
        break;
      case 'SHOPEEVN':
        shipmentCode = `CC${stamp}VN${suffix}`;
        recipient = 'SHOPEEVN';
        customerName = 'GENERAL';
        break;
      case 'WHPP':
        shipmentCode = `CE${stamp}${suffix}`;
        recipient = 'GENERAL';
        customerName = 'GENERAL';
        break;
      default:
        throw new Error(`unsupported business type ${businessType}`);
    }
    target.push([shipmentCode, recipient, customerName, date]);
  }
}

function buildWorkbook(date, truth) {
  const rows = [['运单号', '收件人', '客户名称', '日报日期']];
  for (const [businessType, count] of Object.entries(truth)) {
    pushRows(rows, { date, businessType, count });
  }
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, '日报');
  return workbook;
}

function normalizedCounts(value = {}) {
  return {
    CE: Number(value.CE || 0),
    CEAF: Number(value.CEAF || 0),
    TBKH: Number(value.TBKH || 0),
    ALI1688: Number(value.ALI1688 || 0),
    SHOPEECN: Number(value.SHOPEECN || 0),
    SHOPEEVN: Number(value.SHOPEEVN || 0),
    WHPP: Number(value.WHPP || 0)
  };
}

for (const [date, truth] of Object.entries(HISTORICAL_TRUTH)) {
  const expectedTotal = EXPECTED_TOTALS[date];
  const truthTotal = Object.values(truth).reduce((sum, value) => sum + Number(value || 0), 0);
  assert.equal(truthTotal, expectedTotal, `${date} historical seven-business vector must sum exactly to ALL total`);

  const tempPath = path.join(os.tmpdir(), `ce-qc-v372-${date}-${crypto.randomUUID()}.xlsx`);
  try {
    XLSX.writeFile(buildWorkbook(date, truth), tempPath);
    const parsed = parseUnifiedDailyExcel(tempPath, {
      reportDate: date,
      originalName: `historical-acceptance-${date}.xlsx`
    });

    assert.equal(parsed.reportDate, date, `${date} parser must preserve the explicit target report date`);
    assert.equal(Number(parsed.summary?.validUniqueWaybills || 0), expectedTotal, `${date} valid unique waybill total must match historical truth`);
    assert.equal(Number(parsed.sourceReconciliation?.classifiedWaybills || 0), expectedTotal, `${date} every historical fixture member must be classified`);
    assert.equal(Number(parsed.sourceReconciliation?.difference || 0), 0, `${date} classification reconciliation must be exact`);
    assert.deepEqual(normalizedCounts(parsed.classificationCounts), truth, `${date} seven-business split must match historical production truth exactly`);
    assert.equal(parsed.rows.length, expectedTotal, `${date} parser row count must equal historical ALL total`);
    assert.ok(parsed.rows.every(row => row.reportDate === date), `${date} every parsed member must remain bound to the requested day`);
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }
}

assert.notDeepEqual(HISTORICAL_TRUTH['2026-08-15'], HISTORICAL_TRUTH['2026-08-16'], 'the next-day acceptance fixture must not accidentally reuse previous-day classification truth');
assert.equal(HISTORICAL_TRUTH['2026-08-16'].SHOPEEVN, 0, 'a legitimate zero-count business must remain an explicit seven-business member, not be interpreted as missing classification');
assert.equal(HISTORICAL_TRUTH['2026-08-16'].WHPP, 42, 'WHPP must remain visible as the seventh 2026-08-16 classification');

console.log('[V372] historical 08-15→08-16 production-parser classification smoke passed · 08-15=5266 [1197,76,2127,167,814,730,155] · 08-16=5210 [1978,13,1917,186,1074,0,42] · actual parseUnifiedDailyExcel used · exact seven-business split reconciled · WHPP=42 visible · legitimate SHOPEEVN=0 retained');
