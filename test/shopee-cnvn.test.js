import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import XLSX from 'xlsx';
import { parseShopeeDailyExcel } from '../src/shopeeExcelParser.js';
import { buildShopeeDashboard } from '../src/shopeeReporting.js';
import { runQcPipeline } from '../src/pipeline.js';

test('Shopee parser only accepts exact CN/VN and audits OTHER', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ce-qc-shopee-'));
  const file = path.join(tempDir, 'shopee-2026-08-04.xlsx');
  try {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['shipmentCode', 'recipient', 'reportDate'],
      ['SHP000001', 'ShopeeVN', '2026-08-04'],
      ['SHP000002', ' ShopeeCN ', '2026-08-04'],
      ['SHP000003', 'CECN', '2026-08-04'],
      ['SHP000001', 'ordinary customer', '2026-08-04'],
      ['SHP000004', 'ShopeeCN', '2026-08-04'],
      ['SHP000004', 'ShopeeVN', '2026-08-04']
    ]);
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'daily'); XLSX.writeFile(workbook, file);
    const parsed = await parseShopeeDailyExcel(file);
    assert.deepEqual(parsed.bills.sort(), ['SHP000001', 'SHP000002']);
    assert.equal(parsed.summary.eligibleUniqueShipments, 2);
    assert.deepEqual(parsed.summary.groupCounts, { CN: 1, VN: 1, OTHER: 2 });
    assert.equal(parsed.excludedRows.length, 2);
    assert.equal(parsed.conflicts.length, 1);
  } finally { await rm(tempDir, { recursive: true, force: true }); }
});

test('Shopee dashboard reconciliation uses CN plus VN only', () => {
  const rows = [
    { shipmentCode: 'CN1', recipient_group: 'CN', '是否POD': '否' },
    { shipmentCode: 'VN1', recipient_group: 'VN', '是否POD': '是' },
    { shipmentCode: 'OTHER1', recipient_group: 'OTHER', '是否POD': '是' }
  ];
  const dashboard = buildShopeeDashboard({ reportDate: '2026-08-04', pnhBills: ['CN1', 'VN1'], dailyParseRows: rows, finalRows: rows });
  assert.equal(dashboard.metrics.total, 2);
  assert.equal(dashboard.recipientGroups.ALL.metrics.total, 2);
  assert.equal(dashboard.recipientGroups.CN.metrics.total + dashboard.recipientGroups.VN.metrics.total, 2);
  assert.equal(dashboard.recipientReconciliation.status, 'PASSED');
});

test('Shopee scans 4457 CN/VN bills in 13 batches before 50-sized track batches', async () => {
  const bills = Array.from({ length: 4457 }, (_, index) => `SHP${String(index).padStart(9, '0')}`);
  const calls = { scan: [], track: [], exception: [] };
  const state = {
    businessType: 'SHOPEE', reportDate: '2026-08-04', pnhBills: bills,
    dailyParseRows: bills.map(shipmentCode => ({ shipmentCode, recipient_group: 'VN', importStatus: 'ACCEPTED' })),
    currentRun: { runId: 'test-run' }, carryBills: [], podLocks: []
  };
  const client = {
    confirmQuery: async codes => { calls.scan.push(codes); return codes.map(shipmentCode => ({ shipmentCode, orderStatus: 10 })); },
    trackQuery: async codes => { calls.track.push(codes); return []; },
    exceptionQuery: async codes => { calls.exception.push(codes); return []; }
  };
  await runQcPipeline({ state, client });
  assert.deepEqual(calls.scan.map(batch => batch.length), [...Array(12).fill(350), 257]);
  assert.ok(calls.track.every(batch => batch.length <= 50));
  assert.ok(calls.exception.every(batch => batch.length <= 50));
  assert.ok(calls.track.length > 0);
});
