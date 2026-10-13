import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {classifyV246Terminal,ensureV246TrackingSchema,reconcileV246TrackingLedger} from '../src/v246TrackingLedgerCore.js';
import {syncCarryRowsToV246Ledger} from '../src/carryLedgerSync.js';

function tms(state,code,extra={}) {
  return classifyV246Terminal({state,stateJson:{...extra,shipmentStatus:code}});
}
assert.equal(tms('RETURNED','80').terminal,false,'TMS 80 must override old returned label');
assert.equal(tms('POD','80',{orderStatus:'85',eventCode:'80'}).terminal,false,'TMS 80 is not POD even with stale POD evidence');
assert.equal(tms('PENDING_SCAN','60').reason,'POD');
assert.equal(tms('PENDING_SCAN','81').reason,'RETURNED');
assert.equal(tms('POD','81').stateConflict,true,'81 vs current POD must flag conflict');
assert.equal(tms('RETURNED','60').stateConflict,true,'60 vs current RETURNED must flag conflict');
assert.equal(tms('PENDING_VERIFICATION','81',{shipmentStatusConflict:true}).terminal,false,
  'persistent TMS conflict must never silently close on second sync');
assert.equal(classifyV246Terminal({state:'PENDING_SCAN',stateJson:{eventCode:'80'}}).reason,'POD',
  'tracking eventCode80 is distinct from shipmentStatus80');

const db=new DatabaseSync(':memory:');
try {
  db.exec("CREATE TABLE carryover_open_items("+
    "shipmentCode TEXT PRIMARY KEY,businessType TEXT,sourceReportDate TEXT,lastReportDate TEXT,"+
    "sourceSnapshotId TEXT,lastSnapshotId TEXT,status TEXT,apiStatus TEXT,closeReason TEXT,"+
    "stateJson TEXT,createdAt TEXT,updatedAt TEXT);"+
    "CREATE TABLE shipment_current_state("+
    "shipmentCode TEXT PRIMARY KEY,businessType TEXT,reportDate TEXT,snapshotId TEXT,state TEXT,"+
    "apiStatus TEXT,lastEventTime TEXT,stateJson TEXT,updatedAt TEXT);");
  ensureV246TrackingSchema(db);
  db.exec("CREATE TABLE business_pod_locks(businessType TEXT,shipmentCode TEXT,podTime TEXT,source TEXT)");
  const day='2026-07-02',now='2026-10-13T00:00:00Z';
  const seed=(id,state,code,oldReason='')=>{
    const bill='V788LEDGER'+id;
    const json=JSON.stringify({shipmentStatus:code,currentState:state,businessType:'WHPP'});
    db.prepare('INSERT INTO shipment_current_state VALUES(?,?,?,?,?,?,?,?,?)').run(
      bill,'WHPP',day,'SNAP-1',state,'SUCCESS','',json,now);
    db.prepare('INSERT INTO carryover_open_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(
      bill,'WHPP',day,day,'SNAP-1','SNAP-1',oldReason?'CLOSED':'OPEN',
      'SUCCESS',oldReason,json,now,now);
    if(oldReason){
      db.prepare("INSERT INTO qc_tracking_ledger("+
        "shipmentCode,businessType,firstReportDate,lastImportedDate,"+
        "trackingStatus,terminalReason,terminalAt,currentState,currentCategory,"+
        "podDate,signingDays,createdAt,updatedAt)"+
        "VALUES(?,?,?,?,'TERMINAL',?,?,?,?,?,3,?,?)").run(
        bill,'WHPP',day,day,oldReason,day,state,state,day,now,now);
    }
    return bill;
  };
  const ret80=seed('80','RETURNED','80','RETURNED');
  const pod60=seed('60','PENDING_SCAN','60');
  db.prepare("INSERT INTO business_pod_locks VALUES('WHPP',?,?,?)")
    .run(pod60,'2026-07-04 12:30:00','whpp_strict_track_event');
  const ret81=seed('81','PENDING_SCAN','81');
  const mismatch=seed('BAD','POD','81','POD');
  const bills=[ret80,pod60,ret81,mismatch];
  const call=()=>syncCarryRowsToV246Ledger(bills.map(shipmentCode=>({shipmentCode})),{
    db,reason:'V788_REGRESSION',manageTransaction:true,invalidateCaches:false
  });
  const first=call();
  assert.equal(first.processed,4);
  const state=bill=>db.prepare('SELECT * FROM qc_tracking_ledger WHERE shipmentCode=?').get(bill);
  const carry=bill=>db.prepare('SELECT * FROM carryover_open_items WHERE shipmentCode=?').get(bill);
  const current=bill=>db.prepare('SELECT * FROM shipment_current_state WHERE shipmentCode=?').get(bill);
  assert.equal(state(ret80).trackingStatus,'OPEN');
  assert.equal(state(ret80).currentState,'RETURN_IN_PROGRESS');
  assert.equal(state(ret80).podDate,'','status80 must clear stale POD date');
  assert.equal(state(ret80).signingDays,null,'status80 must clear stale signingDays');
  assert.equal(carry(ret80).status,'OPEN','status80 reopens old closed return');
  assert.equal(current(ret80).state,'RETURN_IN_PROGRESS');
  assert.equal(state(pod60).trackingStatus,'TERMINAL');
  assert.equal(state(pod60).terminalReason,'POD');
  assert.equal(state(pod60).podDate,'2026-07-04','daily sync must recover proven WHPP POD time');
  assert.equal(state(pod60).signingDays,3,'July2 intake to July4 POD is three inclusive days');
  assert.equal(state(ret81).terminalReason,'RETURNED');
  assert.equal(state(mismatch).trackingStatus,'OPEN');
  assert.equal(state(mismatch).currentState,'PENDING_VERIFICATION');
  assert.equal(JSON.parse(current(mismatch).stateJson).shipmentStatusConflict,true);
  const repeat=call();
  assert.equal(repeat.processed,4);
  assert.equal(state(mismatch).trackingStatus,'OPEN','second sync cannot close a persisted conflict');
  assert.equal(state(ret80).terminalReason,'');
  assert.equal(state(ret81).trackingStatus,'TERMINAL');
  assert.ok(Number(db.prepare('SELECT COUNT(*) n FROM qc_tracking_audit').get().n)>0);
  // Separate V246 historical rebuilding must not resurrect stale TERMINAL
  // even when an old ledger has a real-looking POD date and signing duration.
  // This uses the actual reconciler against isolated SQLite tables.
  const hist=new DatabaseSync(':memory:');
  try{
    hist.exec("CREATE TABLE unified_import_batches(snapshotId TEXT,reportDate TEXT,createdAt TEXT,batchId TEXT,status TEXT);"+
      "CREATE TABLE unified_snapshots(snapshotId TEXT,status TEXT);"+
      "CREATE TABLE unified_import_rows(snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT);"+
      "CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT);"+
      "CREATE TABLE business_pod_locks(businessType TEXT,shipmentCode TEXT,podTime TEXT,source TEXT);"+
      "CREATE TABLE carryover_open_items("+
      "shipmentCode TEXT PRIMARY KEY,businessType TEXT,sourceReportDate TEXT,lastReportDate TEXT,"+
      "sourceSnapshotId TEXT,lastSnapshotId TEXT,status TEXT,apiStatus TEXT,closeReason TEXT,"+
      "stateJson TEXT,createdAt TEXT,updatedAt TEXT);"+
      "CREATE TABLE shipment_current_state("+
      "shipmentCode TEXT PRIMARY KEY,businessType TEXT,reportDate TEXT,snapshotId TEXT,state TEXT,"+
      "apiStatus TEXT,lastEventTime TEXT,stateJson TEXT,updatedAt TEXT);");
    ensureV246TrackingSchema(hist);
    const addCase=(suffix,state,code,oldReason='')=>{
      const bill='V788HIST'+suffix;
      const raw=JSON.stringify({shipmentStatus:code,currentState:state,businessType:'WHPP'});
      hist.prepare("INSERT INTO business_daily_parse_rows VALUES('WHPP',?,?)").run(day,bill);
      hist.prepare("INSERT INTO shipment_current_state VALUES(?,?,?,?,?,?,?,?,?)").run(
        bill,'WHPP',day,'V788-HIST-SNAP',state,'SUCCESS','',raw,now);
      hist.prepare("INSERT INTO carryover_open_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
        bill,'WHPP',day,day,'V788-HIST-SNAP','V788-HIST-SNAP',
        oldReason?'CLOSED':'OPEN','SUCCESS',oldReason,raw,now,now);
      if(oldReason)hist.prepare("INSERT INTO qc_tracking_ledger("+
        "shipmentCode,businessType,firstReportDate,lastImportedDate,trackingStatus,terminalReason,"+
        "terminalAt,currentState,currentCategory,podDate,signingDays,createdAt,updatedAt)"+
        "VALUES(?,?,?,?,'TERMINAL',?,?,?,?,?,4,?,?)").run(
        bill,'WHPP',day,day,oldReason,day,oldReason,oldReason,day,now,now);
      return bill;
    };
    const h80=addCase('80','RETURNED','80','RETURNED');
    const h81=addCase('81','RETURNED','81','POD');
    const hBad=addCase('BAD','POD','81','POD');
    const h60=addCase('60','PENDING_SCAN','60');
    const lockInsert=hist.prepare("INSERT INTO business_pod_locks VALUES('WHPP',?,?,?)");
    lockInsert.run(h60,'2026-07-04 13:20:00','whpp_saved_scan_pod_time');
    lockInsert.run(hBad,'2026-07-04 13:20:00','whpp_strict_track_event');
    lockInsert.run(h80,'2026-07-04 13:20:00','whpp_strict_track_event');
    const select={businessType:'WHPP',fromDate:day,toDate:day};
    const historical=()=>reconcileV246TrackingLedger(select,{db:hist,reason:'V788_HIST_REGRESSION'});
    const firstHist=historical();
    assert.ok(firstHist,'historical reconcile must return a status');
    const row=bill=>hist.prepare('SELECT * FROM qc_tracking_ledger WHERE shipmentCode=?').get(bill);
    assert.equal(row(h80).trackingStatus,'OPEN');
    assert.equal(row(h80).currentState,'RETURN_IN_PROGRESS');
    assert.equal(row(h80).podDate,'');
    assert.equal(row(h80).signingDays,null);
    assert.equal(row(h81).trackingStatus,'TERMINAL');
    assert.equal(row(h81).terminalReason,'RETURNED');
    assert.equal(row(h81).currentState,'RETURNED');
    assert.equal(row(h81).podDate,'');
    assert.equal(row(h81).signingDays,null);
    assert.equal(row(hBad).trackingStatus,'OPEN');
    assert.equal(row(hBad).currentState,'PENDING_VERIFICATION');
    assert.equal(row(h60).trackingStatus,'TERMINAL');
    assert.equal(row(h60).currentState,'POD');
    assert.equal(row(h60).podDate,'2026-07-04','historical reconcile reads exact saved POD lock time');
    assert.equal(row(h60).signingDays,3);
    assert.equal(row(hBad).podDate,'','conflicting return cannot inherit a POD lock');
    assert.equal(row(h80).podDate,'','return in progress cannot inherit a POD lock');
    historical();
    assert.equal(row(h80).trackingStatus,'OPEN','second historical rebuild cannot restore stale return terminal');
    assert.equal(row(hBad).trackingStatus,'OPEN','second historical rebuild cannot silently close conflicting 81');
    assert.equal(row(h81).terminalReason,'RETURNED');
  }finally{hist.close();}

  console.log('[V788 LEDGER] 80 reopens old terminal and clears POD time; 60/81 strict; conflict stays OPEN over two syncs PASS');
} finally { db.close(); }
