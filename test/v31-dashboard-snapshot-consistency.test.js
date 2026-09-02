import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ce-qc-v31-'));
process.env.DATA_DIR = tempDir;
process.env.DB_FILE = path.join(tempDir, 'v31.db');

const { getDb, closeDb } = await import('../src/db.js');
const { loadRangeDashboard } = await import('../src/rangeDashboardStore.js');

const date = '2026-08-09';

function insertFixture() {
  const db = getDb();
  const insertBatch = db.prepare(`INSERT INTO unified_import_batches(
    batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt
  ) VALUES(?,?,?,?,?,'VALID','{}','[]',?)`);
  const insertSnapshot = db.prepare(`INSERT INTO unified_snapshots(
    snapshotId,batchId,reportDate,status,payloadJson,createdAt
  ) VALUES(?,?,?,'COMPLETED','{}',?)`);
  const insertImport = db.prepare(`INSERT INTO unified_import_rows(
    batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,rowJson,createdAt
  ) VALUES(?,?,?,?,?,?,?,?)`);
  const insertCcsl = db.prepare(`INSERT INTO final_rows(
    shipmentCode,reportDate,isPod,primaryCategory,pendingDays,ocDays,cycleCountDays,rawJson,createdAt,updatedAt
  ) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const insertShopee = db.prepare(`INSERT INTO business_final_rows(
    businessType,shipmentCode,reportDate,isPod,primaryCategory,rawJson,createdAt,updatedAt
  ) VALUES('SHOPEE',?,?,?,?,?,?,?)`);

  const oldAt = '2026-08-09T01:00:00.000Z';
  const newAt = '2026-08-09T02:00:00.000Z';
  insertBatch.run('batch-old','snapshot-old',date,'old.xlsx','hash-old',oldAt);
  insertSnapshot.run('snapshot-old','batch-old',date,oldAt);
  insertBatch.run('batch-new','snapshot-new',date,'new.xlsx','hash-new',newAt);
  insertSnapshot.run('snapshot-new','batch-new',date,newAt);

  // Historical snapshot: these rows must never be added to current card counts.
  for (const code of ['CE-OLD-1','CE-OLD-2','CE-OLD-3']) {
    insertImport.run('batch-old','snapshot-old',date,'CE',code,'PV','{}',oldAt);
    insertCcsl.run(code,date,0,'Pending2次',2,0,0,JSON.stringify({ Pending次数:2, Pending连续性:'连续' }),oldAt,oldAt);
  }
  for (const code of ['VN-OLD-1','VN-OLD-2']) {
    insertImport.run('batch-old','snapshot-old',date,'SHOPEEVN',code,'PV','{}',oldAt);
    insertShopee.run(code,date,0,'Pending2次',JSON.stringify({ Pending次数:2, Pending当前次数:2, Pending连续性:'连续', currentState:'PENDING' }),oldAt,oldAt);
  }

  // Latest snapshot: two CE, one CEAF and two SHOPEEVN parcels.
  insertImport.run('batch-new','snapshot-new',date,'CE','CE-NEW-PENDING','PV','{}',newAt);
  insertCcsl.run('CE-NEW-PENDING',date,0,'Pending2次',2,0,0,JSON.stringify({ Pending次数:2, Pending连续性:'连续', currentState:'PENDING' }),newAt,newAt);

  insertImport.run('batch-new','snapshot-new',date,'CE','CE-NEW-RETURN','PV','{}',newAt);
  insertCcsl.run('CE-NEW-RETURN',date,0,'退回',0,0,0,JSON.stringify({ 退回状态:'已退回', currentState:'RETURN_COMPLETED' }),newAt,newAt);

  insertImport.run('batch-new','snapshot-new',date,'CEAF','AIR-NEW-PENDING','PP','{}',newAt);
  insertCcsl.run('AIR-NEW-PENDING',date,0,'Pending2次',2,0,0,JSON.stringify({ Pending次数:2, Pending连续性:'连续', currentState:'PENDING' }),newAt,newAt);

  insertImport.run('batch-new','snapshot-new',date,'SHOPEEVN','VN-NEW-PENDING','PV','{}',newAt);
  insertShopee.run('VN-NEW-PENDING',date,0,'Pending2次',JSON.stringify({ Pending次数:2, Pending当前次数:2, Pending连续性:'连续', currentState:'PENDING', pvOpenDisposition:'PV_OTHER_PROGRESS' }),newAt,newAt);

  insertImport.run('batch-new','snapshot-new',date,'SHOPEEVN','VN-NEW-RETURN','PV','{}',newAt);
  insertShopee.run('VN-NEW-RETURN',date,0,'退回',JSON.stringify({ 退回状态:'已退回', currentState:'RETURN_COMPLETED' }),newAt,newAt);
}

test('historical range uses latest same-day source snapshot without double counting', () => {
  insertFixture();
  // Explicitly use a two-day range so this test exercises the historical SQL
  // owner chain. Exact single-day reads are intentionally owned by V322 cache-only.
  const result = loadRangeDashboard('2026-08-08',date);

  assert.match(result.queryMode, /^SQL_SOURCE_VALID_PLUS_ANALYSIS_COMPLETED_V32\+/,
    'historical range must start from V31 latest-snapshot SQL truth');
  assert.match(result.queryMode, /DAILY_MEMBERSHIP_PROVEN_LEDGER_V284/,
    'historical result must retain current proven-evidence coverage semantics');
  assert.deepEqual(result.sourceDates, [date]);
  assert.equal(result.sourceTotal, 5, 'latest source import contains exactly five rows');
  assert.equal(result.analyzedTotal, 5, 'latest proven analysis contains the same five rows');
  assert.equal(result.analysisPending, 0);
  assert.equal(result.analysisComplete, true);

  const ce = result.states.CE;
  assert.equal(ce.sourceTotal, 2);
  assert.equal(ce.analyzedTotal, 2);
  assert.equal(ce.dashboard.pnh, 2, 'old CE snapshot rows must not be double-counted');
  assert.equal(ce.dashboard.returned, 1);
  assert.equal(ce.dashboard.abnormalCount, 0, 'Pending2 is below the dedicated Pending3+ abnormal threshold and returned is a normal closure');
  assert.equal(ce.dashboardRows?.length ?? ce.detailTabs.dashboard.rows.length > 0, true);
  const cePending2 = ce.detailTabs.dashboard.rows.find(row => row.项目 === 'Pending2+');
  const ceProvinceOpen = ce.detailTabs.dashboard.rows.find(row => row.项目 === '外省未完结POD件');
  assert.equal(cePending2?.数值原值, 1, 'Pending2 may remain visible as a monitoring detail without being promoted to dedicated abnormal');
  assert.equal(ceProvinceOpen?.数值原值, 1, 'PV returned parcel must not remain province-open');

  const ceaf = result.states.CEAF;
  assert.ok(ceaf, 'CEAF must have an independent range-dashboard state');
  assert.equal(ceaf.sourceTotal, 1);
  assert.equal(ceaf.analyzedTotal, 1);
  assert.equal(ceaf.dashboard.pnh, 1);
  assert.equal(ceaf.dashboard.abnormalCount, 0, 'CEAF Pending2 follows the same Pending3+ abnormal threshold');
  const ceafPending2 = ceaf.detailTabs.dashboard.rows.find(row => row.项目 === 'Pending2+');
  assert.equal(ceafPending2?.数值原值, 1, 'CEAF uses the same CCSL/CE monitoring detail logic');

  const vnState = result.states.SHOPEEVN;
  const vn = vnState.dashboard.metrics;
  assert.equal(vnState.sourceTotal, 2);
  assert.equal(vnState.analyzedTotal, 2);
  assert.equal(vn.total, 2, 'old SHOPEEVN snapshot rows must not be double-counted');
  assert.equal(vn.pending2, 1);
  assert.equal(vn.returned, 1);
  assert.equal(vn.unresolved, 1, 'returned parcel is normal closure, not unresolved anomaly');

  assert.equal(result.aggregates.CCSL.sourceTotal, 3, 'CCSL source aggregate includes CE + CEAF');
  assert.equal(result.aggregates.CCSL.dashboard.pnh, 3, 'CCSL visible denominator includes CE + CEAF without historical duplicates');
  assert.equal(result.aggregates.SHOPEE.sourceTotal, 2);
  assert.equal(result.aggregates.SHOPEE.dashboard.metrics.total, 2);
});

test.after(async () => {
  closeDb();
  await rm(tempDir, { recursive:true, force:true });
});
