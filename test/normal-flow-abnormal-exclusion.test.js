import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-normal-flow-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'normal-flow.db');

const { buildDashboardData } = await import('../src/reporting.js');
const { getDb, closeDb } = await import('../src/db.js');
const { loadRangeDashboard } = await import('../src/rangeDashboardStore.js');
const { loadRangeDashboard: loadRangeDashboardFinal } = await import('../src/rangeDashboardStoreFinal.js');

function row(code, extra = {}) {
  return {
    shipmentCode: code,
    运单号: code,
    reportDate: '2026-08-10',
    是否POD: '否',
    ...extra
  };
}

test('realtime abnormal total excludes normal return/store flows but keeps true 2-day shop retention', () => {
  const rows = [
    row('POD1', { 是否POD: '是', currentState: 'POD', primaryCategory: 'POD闭环' }),
    row('RET1', { currentState: 'RETURN_COMPLETED', 退回状态: '已退回', primaryCategory: '退回' }),
    row('RETIP1', { currentState: 'RETURN_IN_PROGRESS', 退回状态: '退回处理中', primaryCategory: '退回处理中' }),
    row('SHOP1', { shopState: 'SHOP_ARRIVED_CURRENT', shopRetentionNaturalDays: 1, currentState: 'SHOP_ARRIVED_CURRENT', primaryCategory: '门店入库' }),
    row('SHOPP', { shopState: 'SHOP_ARRIVED_CURRENT', shopRetentionNaturalDays: 3, currentState: 'SHOP_PENDING', primaryCategory: '门店Pending' }),
    row('SHOPOC', { shopState: 'SHOP_ARRIVED_CURRENT', shopRetentionNaturalDays: 3, currentState: 'SHOP_OC', primaryCategory: '门店OC' }),
    row('SHOPSTUCK', { shopState: 'SHOP_ARRIVED_CURRENT', shopRetentionNaturalDays: 2, currentState: 'SHOP_RETENTION', primaryCategory: '门店滞留' }),
    row('PEND1', { currentState: 'PENDING', primaryCategory: 'Pending2次', Pending次数: 2, Pending天数: 2 })
  ];
  const state = {
    reportDate: '2026-08-10',
    pnhBills: rows.map(item => item.运单号),
    scanPool: rows.map(item => item.运单号),
    scanResults: rows,
    trackResults: rows,
    finalRows: rows,
    carryBills: [],
    nextCarryBills: []
  };
  const dashboard = buildDashboardData(state);
  assert.equal(dashboard.abnormalCount, 2, 'legacy realtime layer still exposes Pending + 2-day shop retention before V58 reconciliation');
  assert.equal(dashboard.categories.shopStuck, 1, 'store Pending/OC and 1-day arrival must not be counted as shop retention');
});

function insertFlexible(db, table, values) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(item => item.name));
  const entries = Object.entries(values).filter(([key]) => columns.has(key));
  const sql = `INSERT INTO ${table}(${entries.map(([key]) => key).join(',')}) VALUES(${entries.map(() => '?').join(',')})`;
  db.prepare(sql).run(...entries.map(([, value]) => value));
}

test('range abnormal total applies V58 dedicated thresholds after normal-flow exclusions', () => {
  const db = getDb();
  const date = '2026-08-10';
  const snapshotId = 'snapshot-normal-flow';
  const batchId = 'batch-normal-flow';
  const now = '2026-08-10T01:00:00.000Z';

  insertFlexible(db, 'unified_import_batches', {
    batchId, snapshotId, reportDate: date, sourceName: 'normal.xlsx', fileHash: 'normal-hash', status: 'VALID', summaryJson: '{}', warningsJson: '[]', createdAt: now
  });
  insertFlexible(db, 'unified_snapshots', {
    snapshotId, batchId, reportDate: date, status: 'COMPLETED', payloadJson: '{}', createdAt: now
  });

  const fixtures = [
    ['RET1', { primaryCategory: '退回', rawJson: JSON.stringify({ currentState: 'RETURN_COMPLETED', 退回状态: '已退回' }) }],
    ['RETIP1', { primaryCategory: '退回处理中', rawJson: JSON.stringify({ currentState: 'RETURN_IN_PROGRESS', 退回状态: '退回处理中' }) }],
    ['SHOP1', { primaryCategory: '门店入库', shopState: 'SHOP_ARRIVED_CURRENT', shopRetentionNaturalDays: 1, rawJson: JSON.stringify({ currentState: 'SHOP_ARRIVED_CURRENT' }) }],
    ['SHOPP', { primaryCategory: '门店Pending', shopState: 'SHOP_ARRIVED_CURRENT', shopRetentionNaturalDays: 3, rawJson: JSON.stringify({ currentState: 'SHOP_PENDING' }) }],
    ['SHOPSTUCK', { primaryCategory: '门店滞留', shopState: 'SHOP_ARRIVED_CURRENT', shopRetentionNaturalDays: 2, rawJson: JSON.stringify({ currentState: 'SHOP_RETENTION' }) }],
    ['PEND1', { primaryCategory: 'Pending2次', pendingDays: 2, rawJson: JSON.stringify({ currentState: 'PENDING', Pending连续性: '连续' }) }],
    ['580', { primaryCategory: 'CCSL580_RETENTION', rawJson: JSON.stringify({ currentState: 'CCSL580_RETENTION' }) }]
  ];

  for (const [code, final] of fixtures) {
    insertFlexible(db, 'unified_import_rows', {
      batchId, snapshotId, reportDate: date, businessType: 'CE', shipmentCode: code, regionCode: 'PV', rowJson: '{}', createdAt: now
    });
    insertFlexible(db, 'final_rows', {
      shipmentCode: code, reportDate: date, isPod: 0, category: final.primaryCategory, primaryCategory: final.primaryCategory,
      pendingDays: final.pendingDays || 0, ocDays: 0, cycleCountDays: 0, deliveringDays: 0,
      shopState: final.shopState || '', shopRetentionNaturalDays: final.shopRetentionNaturalDays || 0,
      rawJson: final.rawJson || '{}', createdAt: now, updatedAt: now
    });
  }

  // Business-rule regression intentionally exercises the explicit final-normalization owner.
  // The public interactive facade is cache-only for single-day page reads and therefore
  // must not rescan row-level facts merely to satisfy this test.
  const range = loadRangeDashboardFinal(date, date);
  assert.equal(range.states.CE.dashboard.returned, 1);
  assert.equal(range.states.CE.dashboard.returnInProgress, 1);
  assert.equal(range.states.CE.dashboard.normalShopOpen, 2, '1-day store + store Pending are normal store flows');
  assert.equal(range.states.CE.dashboard.specialClosed, 1);
  assert.equal(range.states.CE.dashboard.abnormalCount, 1, 'V58 keeps 2-day store retention abnormal while continuous Pending2 remains below threshold');
  assert.equal(range.states.CE.detailTabs.abnormal.total, 1);
});

test.after(() => {
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
