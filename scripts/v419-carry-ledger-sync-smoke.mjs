import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ensureV246TrackingSchema } from '../src/v246TrackingLedgerCore.js';
import { syncCarryRowsToV246Ledger } from '../src/carryLedgerSync.js';

const db = new DatabaseSync(':memory:');
const now = '2026-09-03T00:00:00Z';
try {
  db.exec(`
    CREATE TABLE carryover_open_items(
      shipmentCode TEXT PRIMARY KEY,businessType TEXT,sourceReportDate TEXT,lastReportDate TEXT,
      sourceSnapshotId TEXT,lastSnapshotId TEXT,status TEXT,apiStatus TEXT,closeReason TEXT,
      stateJson TEXT,createdAt TEXT,updatedAt TEXT
    );
    CREATE TABLE shipment_current_state(
      shipmentCode TEXT PRIMARY KEY,businessType TEXT,reportDate TEXT,snapshotId TEXT,state TEXT,
      apiStatus TEXT,lastEventTime TEXT,stateJson TEXT,updatedAt TEXT
    );
  `);
  ensureV246TrackingSchema(db);

  const insertCarry = db.prepare(`INSERT INTO carryover_open_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertCurrent = db.prepare(`INSERT INTO shipment_current_state VALUES(?,?,?,?,?,?,?,?,?)`);
  const insertLedger = db.prepare(`INSERT INTO qc_tracking_ledger(
    shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,
    currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  // 1) A previous-day WHPP member becomes POD today. The canonical ledger must
  // close immediately and retain the original membership date for range truth.
  const whppPod = {
    shipmentCode:'WHPP-NEXTDAY-POD',businessType:'WHPP',currentState:'POD',是否POD:'是',
    latestTrackStatusCode:'80',latestEventTime:'2026-08-02T08:30:00Z',primaryCategory:'POD'
  };
  insertCarry.run('WHPP-NEXTDAY-POD','WHPP','2026-08-01','2026-08-02','S1','S2','OPEN','SUCCESS','',JSON.stringify({currentState:'OPEN'}),now,now);
  insertCurrent.run('WHPP-NEXTDAY-POD','WHPP','2026-08-02','S2','POD','SUCCESS','2026-08-02T08:30:00Z',JSON.stringify(whppPod),now);
  const podSync = syncCarryRowsToV246Ledger([whppPod],{db,reason:'SMOKE_NEXT_DAY_POD'});
  const podLedger = db.prepare(`SELECT * FROM qc_tracking_ledger WHERE shipmentCode='WHPP-NEXTDAY-POD'`).get();
  assert.equal(podSync.processed,1);
  assert.equal(podLedger.trackingStatus,'TERMINAL');
  assert.equal(podLedger.terminalReason,'POD');
  assert.equal(podLedger.firstReportDate,'2026-08-01');
  assert.equal(podLedger.lastImportedDate,'2026-08-02');
  assert.equal(podLedger.podDate,'2026-08-02');
  assert.equal(db.prepare(`SELECT status FROM carryover_open_items WHERE shipmentCode='WHPP-NEXTDAY-POD'`).get().status,'CLOSED');

  // 2) Legacy logic used to close any text containing RETURN. Explicit
  // RETURN_IN_PROGRESS must reopen carry/current/ledger in the same commit chain.
  const returnProgress = {
    shipmentCode:'SPE-RETURN-PROGRESS',businessType:'SHOPEECN',currentState:'RETURN_IN_PROGRESS',
    退回状态:'退回处理中',primaryCategory:'退回处理中',latestTrackStatusCode:'84'
  };
  insertCarry.run('SPE-RETURN-PROGRESS','SHOPEECN','2026-08-01','2026-08-02','S1','S2','CLOSED','SUCCESS','RETURNED',JSON.stringify(returnProgress),now,now);
  insertCurrent.run('SPE-RETURN-PROGRESS','SHOPEECN','2026-08-02','S2','RETURNED','SUCCESS','',JSON.stringify(returnProgress),now);
  insertLedger.run('SPE-RETURN-PROGRESS','SHOPEECN','2026-08-01','2026-08-02','S1','S2','TERMINAL','RETURNED',now,'RETURNED','退回处理中','','',0,'',null,'{}',JSON.stringify(returnProgress),now,'legacy',now,now);
  const returnSync = syncCarryRowsToV246Ledger([returnProgress],{db,reason:'SMOKE_RETURN_PROGRESS'});
  assert.equal(returnSync.reopened,1);
  assert.equal(db.prepare(`SELECT status FROM carryover_open_items WHERE shipmentCode='SPE-RETURN-PROGRESS'`).get().status,'OPEN');
  assert.equal(db.prepare(`SELECT state FROM shipment_current_state WHERE shipmentCode='SPE-RETURN-PROGRESS'`).get().state,'RETURN_IN_PROGRESS');
  const returnLedger = db.prepare(`SELECT trackingStatus,terminalReason,currentState FROM qc_tracking_ledger WHERE shipmentCode='SPE-RETURN-PROGRESS'`).get();
  assert.equal(returnLedger.trackingStatus,'OPEN');
  assert.equal(returnLedger.terminalReason,'');
  assert.equal(returnLedger.currentState,'RETURN_IN_PROGRESS');

  // 3) Strict Shopee attempt evidence is immutable. A later carry refresh may
  // improve status/POD time but must not rewrite the strict attempt cycle.
  const strictPod = {
    shipmentCode:'SPE-STRICT-ATTEMPT',businessType:'SHOPEEVN',currentState:'POD',是否POD:'是',
    POD时间:'2026-08-03T10:00:00Z',podAttemptNo:1,currentAttemptNo:1,primaryCategory:'POD'
  };
  insertCarry.run('SPE-STRICT-ATTEMPT','SHOPEEVN','2026-08-01','2026-08-03','S1','S3','OPEN','SUCCESS','',JSON.stringify(strictPod),now,now);
  insertCurrent.run('SPE-STRICT-ATTEMPT','SHOPEEVN','2026-08-03','S3','POD','SUCCESS','2026-08-03T10:00:00Z',JSON.stringify(strictPod),now);
  insertLedger.run('SPE-STRICT-ATTEMPT','SHOPEEVN','2026-08-01','2026-08-03','S1','S2','TERMINAL','POD',now,'POD','POD','2026-08-02T09:00:00Z','2026-08-02',2,'V246_STRICT_TRACK:START_FAILURE_CYCLE',2,'{}','{}',now,'strict',now,now);
  syncCarryRowsToV246Ledger([strictPod],{db,reason:'SMOKE_STRICT_ATTEMPT'});
  const strictLedger = db.prepare(`SELECT attemptNo,attemptSource,podDate,terminalReason FROM qc_tracking_ledger WHERE shipmentCode='SPE-STRICT-ATTEMPT'`).get();
  assert.equal(strictLedger.attemptNo,2);
  assert.equal(strictLedger.attemptSource,'V246_STRICT_TRACK:START_FAILURE_CYCLE');
  assert.equal(strictLedger.podDate,'2026-08-02');
  assert.equal(strictLedger.terminalReason,'POD');

  // 4) A persisted POD terminal must survive a later non-terminal-looking row.
  const podLockRefresh = {shipmentCode:'CE-POD-LOCK',businessType:'CE',currentState:'OPEN',primaryCategory:'正常运输中'};
  insertCarry.run('CE-POD-LOCK','CE','2026-08-01','2026-08-03','S1','S3','OPEN','SUCCESS','',JSON.stringify(podLockRefresh),now,now);
  insertCurrent.run('CE-POD-LOCK','CE','2026-08-03','S3','OPEN','SUCCESS','',JSON.stringify(podLockRefresh),now);
  insertLedger.run('CE-POD-LOCK','CE','2026-08-01','2026-08-02','S1','S2','TERMINAL','POD',now,'POD','POD','2026-08-02T09:00:00Z','2026-08-02',0,'',2,'{}','{}',now,'pod-lock',now,now);
  syncCarryRowsToV246Ledger([podLockRefresh],{db,reason:'SMOKE_POD_LOCK'});
  assert.equal(db.prepare(`SELECT terminalReason FROM qc_tracking_ledger WHERE shipmentCode='CE-POD-LOCK'`).get().terminalReason,'POD');
  assert.equal(db.prepare(`SELECT status FROM carryover_open_items WHERE shipmentCode='CE-POD-LOCK'`).get().status,'CLOSED');
  assert.equal(db.prepare(`SELECT state FROM shipment_current_state WHERE shipmentCode='CE-POD-LOCK'`).get().state,'POD');

  // 5) manageTransaction=false must participate in the caller's transaction and
  // never commit independently. Rollback proves atomic integration is possible.
  const atomic = {shipmentCode:'ALI-ATOMIC',businessType:'ALI1688',currentState:'POD',是否POD:'是',POD时间:'2026-08-04T01:00:00Z'};
  insertCarry.run('ALI-ATOMIC','ALI1688','2026-08-01','2026-08-04','S1','S4','OPEN','SUCCESS','',JSON.stringify(atomic),now,now);
  insertCurrent.run('ALI-ATOMIC','ALI1688','2026-08-04','S4','POD','SUCCESS','2026-08-04T01:00:00Z',JSON.stringify(atomic),now);
  db.exec('BEGIN IMMEDIATE');
  syncCarryRowsToV246Ledger([atomic],{db,reason:'SMOKE_OUTER_TX',manageTransaction:false,invalidateCaches:false});
  assert.equal(db.prepare(`SELECT terminalReason FROM qc_tracking_ledger WHERE shipmentCode='ALI-ATOMIC'`).get().terminalReason,'POD');
  db.exec('ROLLBACK');
  assert.equal(db.prepare(`SELECT 1 ok FROM qc_tracking_ledger WHERE shipmentCode='ALI-ATOMIC'`).get(),undefined,'outer rollback must roll back ledger sync too');
  assert.equal(db.prepare(`SELECT status FROM carryover_open_items WHERE shipmentCode='ALI-ATOMIC'`).get().status,'OPEN','outer rollback must roll back carry normalization too');

  // Source-level contract: updateCarryoverResults owns the single transaction;
  // V284 range truth reads V246 ledger before legacy final rows.
  const importStore = fs.readFileSync(new URL('../src/unifiedImportStore.js',import.meta.url),'utf8');
  const v284 = fs.readFileSync(new URL('../src/v284DailyMembershipTruth.js',import.meta.url),'utf8');
  const fn = importStore.slice(importStore.indexOf('export function updateCarryoverResults'),importStore.indexOf('export function carryoverSummary'));
  assert.match(importStore,/from '\.\/carryLedgerSync\.js'/);
  assert.match(fn,/db\.exec\('BEGIN IMMEDIATE'\)[\s\S]*syncCarryRowsToV246Ledger\([\s\S]*manageTransaction:\s*false[\s\S]*db\.exec\('COMMIT'\)/,'carry/current/ledger must share one transaction');
  assert.match(fn,/db\.exec\('COMMIT'\)[\s\S]*invalidateCarryLedgerReadCaches\(\)/,'range caches must invalidate only after successful commit');
  assert.match(v284,/CASE WHEN l\.shipmentCode IS NOT NULL THEN CASE WHEN l\.terminalReason='POD' THEN 1 ELSE 0 END/,'range POD truth must read V246 ledger first');
  assert.match(v284,/LEFT JOIN qc_tracking_ledger l ON l\.shipmentCode=v\.shipmentCode AND l\.businessType='WHPP'/,'WHPP range truth must join canonical V246 ledger');

  console.log('[V419] carry ledger sync smoke passed · next-day POD closes immediately · return-in-progress reopens · strict attempts and POD locks stay immutable · outer transaction rollback is atomic · V284 consumes ledger truth');
} finally {
  try { db.close(); } catch {}
}
