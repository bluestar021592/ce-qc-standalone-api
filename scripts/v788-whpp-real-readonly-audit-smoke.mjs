import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { auditV788Readonly } from './v788-whpp-real-readonly-audit.mjs';

const db=new DatabaseSync(':memory:');
try{
  db.exec("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT)");
  db.exec("CREATE TABLE business_daily_parse_rows(reportDate TEXT,businessType TEXT,shipmentCode TEXT)");
  db.exec("CREATE TABLE shipment_current_state(shipmentCode TEXT,businessType TEXT,reportDate TEXT,state TEXT,stateJson TEXT)");
  db.exec("CREATE TABLE qc_tracking_ledger(shipmentCode TEXT,businessType TEXT,trackingStatus TEXT,terminalReason TEXT)");
  db.exec("CREATE TABLE business_scan_results(shipmentCode TEXT,businessType TEXT,reportDate TEXT,isPod INTEGER,orderStatus TEXT,rawJson TEXT)");
  db.exec("CREATE TABLE business_final_rows(shipmentCode TEXT,businessType TEXT,reportDate TEXT,isPod INTEGER,primaryCategory TEXT,rawJson TEXT)");
  db.exec("CREATE TABLE business_pod_locks(businessType TEXT,shipmentCode TEXT,podTime TEXT,source TEXT)");
  const members=Array.from({length:72},(_,i)=>({code:'CP'+String(100001+i),name:'Shop '+(i+1)}));
  db.prepare('INSERT INTO app_meta VALUES(?,?)').run('shop_current_complete_codes_v780',JSON.stringify({mode:'COMPLETE',members}));
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
  const audit=auditV788Readonly(db);
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
  assert.equal(audit.whpp.byDate[0].trustedPodTimeCoveragePct,100);
  assert.equal(audit.whpp.byDate[1].trustedPodTimeCoveragePct,0);

  assert.equal(audit.whpp.byDate[0].scanAndFinalComplete,true,'July1 fixture has full scan/final source coverage');
  assert.equal(audit.whpp.byDate[0].eligibleForStrictExportFallback,false,'full scan/final uses the primary export gate, not alternative TMS fallback');
  assert.equal(audit.whpp.byDate[1].eligibleForStrictExportFallback,false);
  assert.ok(!JSON.stringify(audit).includes('A1')&&!JSON.stringify(audit).includes('B1'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM shipment_current_state').get().n,5,'audit must not mutate shipment rows');
  console.log('[V788 READONLY] strict 60/81, status 80, contradictions, label-only, CP72 and privacy checks PASS');
}finally{db.close()}
