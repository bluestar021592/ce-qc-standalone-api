import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v25-'));
process.env.DATA_DIR = root;
process.env.DB_FILE = path.join(root, 'v25.db');

const { getDb, closeDb } = await import('../src/db.js');
const { SHOPEE, saveBusinessState, loadBusinessState, saveBusinessSnapshot } = await import('../src/businessStore.js');

function dailyRow(code) {
  return { shipmentCode: code, 运单号: code, recipient_group: 'CN', recipient_raw: 'SHOPEECN', recipient_normalized: 'SHOPEECN', source_row_number: 1 };
}

test('V25 stores large track evidence outside the single business_states JSON', () => {
  const hugeText = 'x'.repeat(20_000);
  const bills = ['A001', 'A002', 'A003'];
  const state = {
    businessType: SHOPEE,
    reportDate: '2026-08-08',
    sourceName: '8-8.xls',
    dailyReportReady: true,
    dailyParseSummary: { totalRecognized: 3, reconciliation: { status: 'PASSED' } },
    dailyParseRows: bills.map(dailyRow),
    pnhBills: bills,
    carryBills: [],
    podLocks: [],
    scanResults: bills.map(code => ({ ...dailyRow(code), reportDate: '2026-08-08', trackRequired: true, 是否POD: '否', rawJson: { payload: hugeText } })),
    trackEvents: Array.from({ length: 120 }, (_, i) => ({ shipmentCode: bills[i % bills.length], reportDate: '2026-08-08', eventTime: `2026-08-08T00:${String(i % 60).padStart(2,'0')}:00`, eventCode: '10', note: hugeText })),
    trackResults: bills.map(code => ({ ...dailyRow(code), reportDate: '2026-08-08', 是否POD: '否', primaryCategory: 'Pending1次', rawJson: { payload: hugeText } })),
    finalRows: bills.map(code => ({ ...dailyRow(code), reportDate: '2026-08-08', 是否POD: '否', primaryCategory: 'Pending1次', rawJson: { payload: hugeText } })),
    processing: { running: true, paused: false, phase: '轨迹查询', batchIndex: 1, totalBatches: 2, runId: 'run-v25' },
    currentRun: { runId: 'run-v25', reportDate: '2026-08-08' },
    lastRunSummary: { runId: 'run-v25', reportDate: '2026-08-08', runStatus: 'running' }
  };

  saveBusinessState(state, SHOPEE);
  const db = getDb();
  const stored = db.prepare('SELECT length(valueJson) AS n FROM business_states WHERE businessType=?').get(SHOPEE);
  assert.ok(Number(stored.n) < 500_000, `compact state unexpectedly large: ${stored.n}`);
  assert.equal(db.prepare('SELECT count(*) AS n FROM business_track_events WHERE businessType=? AND reportDate=?').get(SHOPEE, '2026-08-08').n, 120);

  const loaded = loadBusinessState(SHOPEE);
  assert.equal(loaded.dailyParseRows.length, 3);
  assert.equal(loaded.scanResults.length, 3);
  assert.equal(loaded.trackEvents.length, 120);
  assert.equal(loaded.trackResults.length, 3);
  assert.equal(loaded.finalRows.length, 3);
  assert.equal(Object.prototype.hasOwnProperty.call(loaded.trackResults[0], 'rawJson'), false);

  const snapshot = saveBusinessSnapshot(SHOPEE, { ...loaded, analysisRuleVersion: 'v25' }, {
    recipientReconciliation: { status: 'PASSED', checks: [] },
    dashboardRows: [], detailTabs: {}, metrics: {}
  });
  assert.ok(snapshot.snapshotId);
  const payloadSize = db.prepare('SELECT length(payloadJson) AS n FROM business_export_snapshots WHERE snapshotId=?').get(snapshot.snapshotId);
  assert.ok(Number(payloadSize.n) < 1_000_000, `snapshot unexpectedly large: ${payloadSize.n}`);
});

test.after(() => {
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});
