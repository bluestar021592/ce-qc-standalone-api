import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ce-qc-v31-pending-gap-'));
process.env.DATA_DIR = tempDir;
process.env.DB_FILE = path.join(tempDir, 'range.db');

const { getDb, closeDb } = await import('../src/db.js');
const { loadRangeDashboard } = await import('../src/rangeDashboardStore.js');

const date = '2026-08-10';
const at = '2026-08-10T12:00:00.000Z';

function insertFixture() {
  const db = getDb();
  db.prepare(`INSERT INTO unified_import_batches(
    batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt
  ) VALUES('batch','snapshot',?,?,?,'VALID','{}','[]',?)`).run(date,'pending-gap.xlsx','hash',at);
  db.prepare(`INSERT INTO unified_snapshots(
    snapshotId,batchId,reportDate,status,payloadJson,createdAt
  ) VALUES('snapshot','batch',?,'COMPLETED','{}',?)`).run(date,at);

  const importRow = db.prepare(`INSERT INTO unified_import_rows(
    batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,rowJson,createdAt
  ) VALUES('batch','snapshot',?,?,?,?, '{}',?)`);
  const ccsl = db.prepare(`INSERT INTO final_rows(
    shipmentCode,reportDate,isPod,primaryCategory,pendingDays,ocDays,cycleCountDays,rawJson,createdAt,updatedAt
  ) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const shopee = db.prepare(`INSERT INTO business_final_rows(
    businessType,shipmentCode,reportDate,isPod,primaryCategory,rawJson,createdAt,updatedAt
  ) VALUES('SHOPEE',?,?,?,?,?,?,?)`);

  importRow.run(date,'CE','CE-GAP','PP',at);
  ccsl.run('CE-GAP',date,0,'Pending1次',1,0,0,JSON.stringify({
    currentState:'PENDING', Pending次数:1, Pending当前次数:1,
    Pending不连续:'是', pendingDistinctDayCount:2, pendingFactDateContinuity:'不连续'
  }),at,at);

  // Even if legacy/raw history still contains a non-continuous marker, a normal
  // terminal return must never remain in the ordinary Pending anomaly count.
  importRow.run(date,'CE','CE-RETURN','PP',at);
  ccsl.run('CE-RETURN',date,0,'退回',0,0,0,JSON.stringify({
    currentState:'RETURN_COMPLETED', 退回状态:'已退回', Pending不连续:'是',
    pendingDistinctDayCount:2, pendingFactDateContinuity:'不连续', Pending连续性:'不连续'
  }),at,at);

  importRow.run(date,'CE','CE-580','PP',at);
  ccsl.run('CE-580',date,0,'CCSL580_RETENTION',0,0,0,JSON.stringify({
    currentState:'CCSL580_RETENTION', specialState:'CCSL580_RETENTION', Pending不连续:'是',
    pendingDistinctDayCount:2, pendingFactDateContinuity:'不连续', Pending连续性:'不连续'
  }),at,at);

  importRow.run(date,'SHOPEEVN','VN-GAP','PV',at);
  shopee.run('VN-GAP',date,0,'Pending1次',JSON.stringify({
    currentState:'PENDING', Pending次数:1, Pending当前次数:1,
    Pending不连续:'是', pendingDistinctDayCount:2, pendingFactDateContinuity:'不连续'
  }),at,at);

  importRow.run(date,'SHOPEEVN','VN-RETURN','PV',at);
  shopee.run('VN-RETURN',date,0,'退回',JSON.stringify({
    currentState:'RETURN_COMPLETED', 退回状态:'已退回', Pending不连续:'是',
    pendingDistinctDayCount:2, pendingFactDateContinuity:'不连续', Pending连续性:'不连续'
  }),at,at);
}

test('range SQL counts independent Pending gaps but excludes returned and 580 closures', () => {
  insertFixture();
  const result = loadRangeDashboard(date,date);

  const ceRow = result.states.CE.detailTabs.dashboard.rows.find(row => row.项目 === 'Pending不连续');
  assert.equal(ceRow?.数值原值, 1, 'only CE-GAP is an active ordinary Pending non-continuity anomaly');
  assert.equal(result.states.CE.dashboard.returned, 1);

  const vn = result.states.SHOPEEVN.dashboard.metrics;
  assert.equal(vn.pendingNonContinuous, 1, 'only VN-GAP counts; completed return is excluded');
  assert.equal(vn.returned, 1);
});

test.after(async () => {
  closeDb();
  await rm(tempDir, { recursive:true, force:true });
});
