import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-final-shopee-range-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'range.db');

const { getDb, closeDb } = await import('../src/db.js');
const { loadRangeDashboard } = await import('../src/rangeDashboardStore.js');

function insertFlexible(db, table, values) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(item => item.name));
  const entries = Object.entries(values).filter(([key]) => columns.has(key));
  const sql = `INSERT INTO ${table}(${entries.map(([key]) => key).join(',')}) VALUES(${entries.map(() => '?').join(',')})`;
  db.prepare(sql).run(...entries.map(([, value]) => value));
}

test('Shopee final range subtracts normal pickup-success exactly once and store Pending is not retention', () => {
  const db = getDb();
  const date = '2026-08-10';
  const snapshotId = 'shopee-final-range';
  const batchId = 'shopee-final-batch';
  const now = '2026-08-10T03:00:00.000Z';

  insertFlexible(db, 'unified_import_batches', {
    batchId, snapshotId, reportDate: date, sourceName: 'shopee.xlsx', fileHash: 'shopee-hash', status: 'VALID', summaryJson: '{}', warningsJson: '[]', createdAt: now
  });
  insertFlexible(db, 'unified_snapshots', {
    snapshotId, batchId, reportDate: date, status: 'COMPLETED', payloadJson: '{}', createdAt: now
  });

  const fixtures = [
    ['S-NORMAL', '正常流转', '', 0, { currentState: 'PICKUP_SUCCESS' }],
    ['S-SHOP-PENDING', '门店Pending', 'SHOP_ARRIVED_CURRENT', 3, { currentState: 'SHOP_PENDING' }],
    ['S-PENDING', 'Pending1次', '', 0, { currentState: 'PENDING', Pending次数: 1 }]
  ];

  for (const [code, category, shopState, retention, raw] of fixtures) {
    insertFlexible(db, 'unified_import_rows', {
      batchId, snapshotId, reportDate: date, businessType: 'SHOPEECN', shipmentCode: code, regionCode: 'PV', rowJson: '{}', createdAt: now
    });
    insertFlexible(db, 'business_final_rows', {
      businessType: 'SHOPEE', shipmentCode: code, reportDate: date, isPod: 0,
      primaryCategory: category, shopState, shopRetentionNaturalDays: retention,
      rawJson: JSON.stringify(raw), createdAt: now, updatedAt: now
    });
  }

  const range = loadRangeDashboard(date, date);
  const metrics = range.states.SHOPEECN.dashboard.metrics;
  assert.equal(metrics.total, 3);
  assert.equal(metrics.normalOperationalOpen, 1);
  assert.equal(metrics.shopPending, 1);
  assert.equal(metrics.shopRetention2, 0, 'current store Pending must not be counted as store retention');
  assert.equal(metrics.unresolved, 1, 'only the ordinary Pending remains unresolved; normal flow must be subtracted once, not twice');
});

test.after(() => {
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
