import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {classifyV246Terminal,ensureV246TrackingSchema} from '../src/v246TrackingLedgerCore.js';
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
  console.log('[V788 LEDGER] 80 reopens old terminal and clears POD time; 60/81 strict; conflict stays OPEN over two syncs PASS');
} finally { db.close(); }
