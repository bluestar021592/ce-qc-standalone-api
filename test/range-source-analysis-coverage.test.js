import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-source-analysis-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'coverage.db');

const { getDb, closeDb } = await import('../src/db.js');
const { loadRangeDashboard } = await import('../src/rangeDashboardStore.js');

function seed() {
  const db = getDb();
  const insertBatch = db.prepare(`INSERT INTO unified_import_batches(
    batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt
  ) VALUES(?,?,?,?,?,'VALID','{}','[]',?)`);
  const insertSnapshot = db.prepare(`INSERT INTO unified_snapshots(
    snapshotId,batchId,reportDate,status,payloadJson,createdAt
  ) VALUES(?,?,?,?,?,?)`);
  const insertImport = db.prepare(`INSERT INTO unified_import_rows(
    batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,rowJson,createdAt
  ) VALUES(?,?,?,?,?,?,?,?)`);
  const insertCcsl = db.prepare(`INSERT INTO final_rows(
    shipmentCode,reportDate,isPod,primaryCategory,pendingDays,ocDays,cycleCountDays,rawJson,createdAt,updatedAt
  ) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const insertShopee = db.prepare(`INSERT INTO business_final_rows(
    businessType,shipmentCode,reportDate,isPod,primaryCategory,rawJson,createdAt,updatedAt
  ) VALUES('SHOPEE',?,?,?,?,?,?,?)`);

  const d1 = '2026-08-01';
  const d2 = '2026-08-02';
  const t1 = '2026-08-01T12:00:00.000Z';
  const t2 = '2026-08-02T12:00:00.000Z';

  insertBatch.run('batch-d1','snapshot-d1',d1,'d1.xlsx','hash-d1',t1);
  insertSnapshot.run('snapshot-d1','batch-d1',d1,'COMPLETED','{}',t1);
  insertBatch.run('batch-d2','snapshot-d2',d2,'d2.xlsx','hash-d2',t2);
  insertSnapshot.run('snapshot-d2','batch-d2',d2,'IMPORTED','{}',t2);

  for (const [code,type,region] of [
    ['CE-D1-POD','CE','PP'],
    ['CE-D1-PENDING','CE','PV'],
    ['CN-D1-POD','SHOPEECN','PP'],
    ['CN-D1-RETURN','SHOPEECN','PV']
  ]) insertImport.run('batch-d1','snapshot-d1',d1,type,code,region,'{}',t1);

  for (const [code,type,region] of [
    ['CE-D2-1','CE','PP'],
    ['CE-D2-2','CE','PV'],
    ['CE-D2-3','CE','PV'],
    ['CN-D2-1','SHOPEECN','PP'],
    ['CN-D2-2','SHOPEECN','PV'],
    ['CN-D2-3','SHOPEECN','PV']
  ]) insertImport.run('batch-d2','snapshot-d2',d2,type,code,region,'{}',t2);

  insertCcsl.run('CE-D1-POD',d1,1,'POD',0,0,0,JSON.stringify({ currentState:'POD' }),t1,t1);
  insertCcsl.run('CE-D1-PENDING',d1,0,'Pending2次',2,0,0,JSON.stringify({ currentState:'PENDING', Pending次数:2 }),t1,t1);
  insertShopee.run('CN-D1-POD',d1,1,'POD',JSON.stringify({ currentState:'POD', podAttemptNo:1 }),t1,t1);
  insertShopee.run('CN-D1-RETURN',d1,0,'退回',JSON.stringify({ currentState:'RETURN_COMPLETED', 退回状态:'已退回' }),t1,t1);
}

test('source totals include imported unfinished dates while outcome metrics stay analyzed-only', () => {
  seed();
  const result = loadRangeDashboard('2026-08-01','2026-08-02');

  assert.match(result.queryMode, /^SQL_SOURCE_VALID_PLUS_ANALYSIS_COMPLETED_V32\+/,
    'explicit multi-day range must enter the historical SQL owner chain instead of V322 single-day cache');
  assert.match(result.queryMode, /DAILY_MEMBERSHIP_PROVEN_LEDGER_V284/,
    'multi-day result must include current proven-membership coverage semantics');
  assert.match(result.queryMode, /V293_WHPP_HISTORY_RANGE/,
    'multi-day result must retain the preserved WHPP historical owner');
  assert.deepEqual(result.sourceDates, ['2026-08-01','2026-08-02']);
  assert.deepEqual(result.analyzedDates, ['2026-08-01']);
  assert.deepEqual(result.missingAnalysisDates, ['2026-08-02']);
  assert.deepEqual(result.dates, result.sourceDates, 'range dates follow immutable source imports');
  assert.equal(result.sourceTotal, 10);
  assert.equal(result.analyzedTotal, 4);
  assert.equal(result.analysisPending, 6);
  assert.equal(result.analysisComplete, false);

  const ce = result.states.CE;
  assert.equal(ce.sourceTotal, 5);
  assert.equal(ce.analyzedTotal, 2);
  assert.equal(ce.analysisPending, 3);
  assert.equal(ce.analysisComplete, false);
  assert.equal(ce.snapshotStatus, 'PARTIAL');
  assert.deepEqual(ce.missingAnalysisDates, ['2026-08-02']);
  assert.equal(ce.dailyParseSummary.totalRecognized, 5, 'source denominator remains complete');
  assert.equal(ce.dashboard.pnh, 2, 'POD/Pending outcome denominator remains analyzed-only');
  assert.equal(ce.dashboard.abnormalCount, 1, 'unfinished source rows are not invented as anomalies');

  const cn = result.states.SHOPEECN;
  assert.equal(cn.sourceTotal, 5);
  assert.equal(cn.analyzedTotal, 2);
  assert.equal(cn.analysisPending, 3);
  assert.equal(cn.dailyParseSummary.totalRecognized, 5);
  assert.equal(cn.dashboard.metrics.total, 2, 'Shopee outcome metrics remain analyzed-only');
  assert.equal(cn.dashboard.metrics.unresolved, 0, 'three unfinished source rows are not counted unresolved');

  assert.equal(result.aggregates.CCSL.sourceTotal, 5);
  assert.equal(result.aggregates.CCSL.analyzedTotal, 2);
  assert.equal(result.aggregates.SHOPEE.sourceTotal, 5);
  assert.equal(result.aggregates.SHOPEE.analyzedTotal, 2);
});

test('single-day range stays cache-only and fails closed when derived cache is absent', () => {
  const result = loadRangeDashboard('2026-08-01','2026-08-01');
  assert.equal(result.queryMode, 'V322_SINGLE_DAY_DASHBOARD_CACHE_ONLY');
  assert.equal(result.singleDayCacheOnly, true);
  assert.equal(result.availabilityFirst, true);
  assert.equal(result.sourceTotal, 4, 'latest VALID membership remains visible without rebuilding heavy history');
  assert.equal(result.analyzedTotal, 0, 'missing derived cache must not trigger synchronous historical reconstruction');
  assert.equal(result.analysisPending, 4);
  assert.equal(result.analysisComplete, false);
  assert.deepEqual(result.missingAnalysisDates, ['2026-08-01']);
});

test.after(() => {
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
