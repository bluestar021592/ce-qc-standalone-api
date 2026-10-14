import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { auditV788Readonly,truthCategory } from './v788-whpp-real-readonly-audit.mjs';
assert.equal(truthCategory('PENDING_SCAN','60'),'latePODPendingState');
assert.equal(truthCategory('OPEN','81'),'lateReturnedPendingState');
assert.equal(truthCategory('RETURNED','60'),'contradiction');
assert.equal(truthCategory('POD','81'),'contradiction');
assert.equal(truthCategory('POD','60'),'strictPOD');
assert.equal(truthCategory('RETURNED','81'),'strictReturned');

const db=new DatabaseSync(':memory:');
try{
  db.exec("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT)");
  db.exec("CREATE TABLE business_daily_parse_rows(reportDate TEXT,businessType TEXT,shipmentCode TEXT)");
  db.exec("CREATE TABLE shipment_current_state(shipmentCode TEXT,businessType TEXT,reportDate TEXT,state TEXT,stateJson TEXT)");
  db.exec("CREATE TABLE qc_tracking_ledger(shipmentCode TEXT,businessType TEXT,trackingStatus TEXT,terminalReason TEXT)");
  db.exec("CREATE TABLE business_scan_results(shipmentCode TEXT,businessType TEXT,reportDate TEXT,isPod INTEGER,orderStatus TEXT,rawJson TEXT)");
  db.exec("CREATE TABLE business_final_rows(shipmentCode TEXT,businessType TEXT,reportDate TEXT,isPod INTEGER,primaryCategory TEXT,rawJson TEXT)");
  db.exec("CREATE TABLE business_pod_locks(businessType TEXT,shipmentCode TEXT,podTime TEXT,source TEXT)");
  db.exec("CREATE TABLE business_shipment_tracks(businessType TEXT,shipmentCode TEXT,reportDate TEXT,shipmentStatus TEXT,rawJson TEXT)");
  const members=Array.from({length:72},(_,i)=>({code:'CP'+String(100001+i),name:'Shop '+(i+1)}));
  db.prepare('INSERT INTO app_meta VALUES(?,?)').run('shop_current_complete_codes_v780',JSON.stringify({mode:'COMPLETE',members}));
  db.exec("CREATE TABLE unified_import_batches(snapshotId TEXT,reportDate TEXT,createdAt TEXT,batchId TEXT,status TEXT)");
  db.exec("CREATE TABLE unified_snapshots(snapshotId TEXT,status TEXT)");
  db.exec("CREATE TABLE unified_import_rows(snapshotId TEXT,businessType TEXT,shipmentCode TEXT)");
  db.prepare("INSERT INTO unified_import_batches VALUES('S1','2026-07-01','2026-07-01 10:00:00','B1','VALID')").run();
  db.prepare("INSERT INTO unified_snapshots VALUES('S1','COMPLETED')").run();
  db.prepare("INSERT INTO unified_import_rows VALUES('S1','CE','Z1')").run();
  db.prepare("INSERT INTO unified_import_rows VALUES('S1','CEAF','Z2')").run();
  db.prepare("INSERT INTO unified_import_rows VALUES('S1','SHOPEEVN','Z3')").run();
  db.prepare("INSERT INTO unified_import_batches VALUES('S0','2026-07-01','2026-07-01 09:00:00','B0','VALID')").run();
  db.prepare("INSERT INTO unified_snapshots VALUES('S0','COMPLETED')").run();
  db.prepare("INSERT INTO unified_import_rows VALUES('S0','CE','DEPRECATED_OLD_MEMBER')").run();
  const insertMember=db.prepare("INSERT INTO business_daily_parse_rows VALUES(?,'WHPP',?)");
  const insertCurrent=db.prepare("INSERT INTO shipment_current_state VALUES(?,'WHPP',?,?,?)");
  const insertLedger=db.prepare("INSERT INTO qc_tracking_ledger VALUES(?,'WHPP','OPEN','PENDING_SCAN')");
  for(const [day,code,state,status,extra] of [
    ['2026-07-01','A1','POD','60',{podTime:'2026-07-03 09:00:00'}],
    ['2026-07-01','A2','RETURNED','81',{}],
    ['2026-07-02','B1','RETURNING','80',{}],
    ['2026-07-02','B2','POD','81',{}],
    ['2026-07-02','B3','POD','',{}]
  ]){
    insertMember.run(day,code);
    insertCurrent.run(code,day,state,JSON.stringify({shipmentStatus:status,...extra}));
    insertLedger.run(code);
  }
  db.prepare("INSERT INTO business_scan_results VALUES('A1','WHPP','2026-07-01',1,'85','{}')").run();
  db.prepare("INSERT INTO business_final_rows VALUES('A1','WHPP','2026-07-01',1,'POD','{}')").run();
  db.prepare("INSERT INTO business_scan_results VALUES('A2','WHPP','2026-07-01',0,'','{}')").run();
  db.prepare("INSERT INTO business_final_rows VALUES('A2','WHPP','2026-07-01',0,'已退回','{}')").run();
  const insertLock=db.prepare("INSERT INTO business_pod_locks VALUES('WHPP',?,?,?)");
  insertLock.run('A1','2026-07-03 08:30:00','whpp_strict_track_event');
  insertLock.run('A2','2026-07-03 08:30:00','whpp_saved_final_pod_time');
  insertLock.run('B2','2026-07-03 08:30:00','NOT_VERIFIED_SOURCE');
  insertLock.run('B3','2026-07-01 08:30:00','whpp_saved_scan_pod_time');
  // Independently saved TMS evidence overrides missing legacy stateJson status.
  db.prepare("UPDATE shipment_current_state SET stateJson='{"podTime":"2026-07-03 09:00:00"}' WHERE shipmentCode='A1'").run();
  db.prepare("INSERT INTO business_shipment_tracks VALUES('WHPP','A1','2026-07-01','60','{}')").run();
  const audit=auditV788Readonly(db);
  assert.equal(audit.whpp.totals.savedTmsTrackMembers,1);
  assert.equal(audit.whpp.totals.savedTms60,1);
  assert.equal(audit.whpp.totals.savedTmsCurrentConflict,0);
  assert.equal(audit.active72.status,'ACTIVE_72');
  assert.equal(audit.whpp.totals.sourceMembers,5);
  assert.equal(audit.whpp.totals.strictPOD,1);
  assert.equal(audit.whpp.totals.strictReturned,1);
  assert.equal(audit.whpp.totals.returning80,1);
  assert.equal(audit.whpp.totals.contradiction,1);
  assert.equal(audit.whpp.totals.labelOnlyTerminal,1);
  assert.equal(audit.whpp.totals.ledgerOpenWithStrictTerminal,2);
  assert.equal(audit.whpp.totals.withExplicitPodTime,1);
  assert.equal(audit.whpp.totals.normalizedPOD,3);
  assert.equal(audit.whpp.totals.normalizedReturned,1);
  assert.equal(audit.whpp.totals.normalizedNonterminal,1);
  assert.equal(audit.whpp.totals.explicitPODTimeFromSavedEvidence,1);
  assert.equal(audit.whpp.totals.matchedPODAgainstScanOrFinal,1);
  assert.equal(audit.whpp.totals.matchedReturnAgainstFinal,1);
  assert.equal(audit.whpp.totals.finalPOD,1);
  assert.equal(audit.whpp.totals.scanPOD,1);
  assert.equal(audit.whpp.totals.finalReturnCompleted,1);
  assert.equal(audit.whpp.totals.hasFullMembershipNotVerifiedOutcome,false);
  assert.equal(audit.whpp.totals.podLockTablePresent,true);
  assert.equal(audit.whpp.totals.savedPodLockMembers,4);
  assert.equal(audit.whpp.totals.trustedPodLockOnPOD,1);
  assert.equal(audit.whpp.totals.trustedPodLockOnNonPOD,1);
  assert.equal(audit.whpp.totals.rejectedPodLockOnPOD,2);
  assert.equal(audit.whpp.totals.trustedPodTimeCoveragePct,33.33);
  assert.equal(audit.whpp.totals.ledgerOpenWithNormalizedTerminal,4);
  assert.equal(audit.whpp.totals.ledgerTerminalWithNonterminal,0);
  assert.equal(audit.whpp.totals.ledgerTerminalContradictingTms,0);
  assert.equal(audit.sevenBusinessSource.available,true);
  assert.equal(audit.sevenBusinessSource.datesChecked,2);
  assert.equal(audit.sevenBusinessSource.byDate[0].sixBusinessRows,3);
  assert.equal(audit.sevenBusinessSource.byDate[0].whppIndependentSourceMembers,2);
  assert.equal(audit.sevenBusinessSource.byDate[0].sevenBusinessSourceSum,5);
  assert.equal(audit.sevenBusinessSource.byDate[0].sevenBusinessDistinctUnion,5);
  assert.equal(audit.sevenBusinessSource.byDate[0].reconciled,true);
  assert.equal(audit.sevenBusinessSource.byDate[1].whppIndependentSourceMembers,3);
  assert.equal(audit.sevenBusinessSource.byDate[1].completedValidUnifiedBatch,false);
  assert.equal(audit.sevenBusinessSource.byDate[1].sevenBusinessDistinctUnion,3);
  // The audit enables query_only. For the *in-memory test fixture only*,
  // explicitly disable it before seeding a simulated later upload.
  db.exec('PRAGMA query_only=OFF');
  // Newer VALID but PROCESSING must not fall back to previous complete S1.
  db.prepare("INSERT INTO unified_import_batches VALUES('S2','2026-07-01','2026-07-01 11:00:00','B2','VALID')").run();
  db.prepare("INSERT INTO unified_snapshots VALUES('S2','PROCESSING')").run();
  db.prepare("INSERT INTO unified_import_rows VALUES('S2','CE','NEW_UNFINISHED_MEMBER')").run();
  const blocked=auditV788Readonly(db);
  assert.deepEqual(blocked.sevenBusinessSource.blockedDates,['2026-07-01']);
  assert.equal(blocked.sevenBusinessSource.byDate[0].completedValidUnifiedBatch,false);
  assert.equal(blocked.sevenBusinessSource.byDate[0].sixBusinessRows,0,
    'older complete S1 cannot count as the latest source after S2 starts');
  assert.equal(blocked.sevenBusinessSource.byDate[0].reconciled,false);
  db.exec('PRAGMA query_only=OFF');
  db.prepare("UPDATE unified_snapshots SET status='COMPLETED' WHERE snapshotId='S2'").run();
  const completed=auditV788Readonly(db);
  assert.equal(completed.sevenBusinessSource.byDate[0].sixBusinessRows,1);
  assert.equal(completed.sevenBusinessSource.byDate[0].completedValidUnifiedBatch,true);
  assert.equal(completed.sevenBusinessSource.byDate[0].sixBusinessCounts.CE,1);
  assert.equal(audit.whpp.byDate[0].trustedPodTimeCoveragePct,100);
  assert.equal(audit.whpp.byDate[1].trustedPodTimeCoveragePct,0);

  assert.equal(audit.whpp.byDate[0].scanAndFinalComplete,true,'July1 fixture has full scan/final source coverage');
  assert.equal(audit.whpp.byDate[0].eligibleForStrictExportFallback,false,'full scan/final uses the primary export gate, not alternative TMS fallback');
  assert.equal(audit.whpp.byDate[1].eligibleForStrictExportFallback,false);
  assert.ok(!JSON.stringify(audit).includes('A1')&&!JSON.stringify(audit).includes('B1'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM shipment_current_state').get().n,5,'audit must not mutate shipment rows');
  console.log('[V788 READONLY] strict 60/81, status 80, contradictions, label-only, CP72 and privacy checks PASS');
}finally{db.close()}
