import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {loadWhppCanonicalTruth} from '../src/whppCanonicalTruth.js';
import {persistentSelectedDatePodTruth} from '../src/selectedDatePersistentTruth.js';

const src=fs.readFileSync(new URL('../src/lightweightDashboardStore.js',import.meta.url),'utf8');
const first=src.indexOf('function overlaySavedTerminalExportTruth(');
const end=src.indexOf('\n}\n',first)+3;
assert.ok(first>=0&&end>first);
const overlay=new Function('getDb','billOf',src.slice(first,end)+
  '\nreturn overlaySavedTerminalExportTruth;')(()=>db,row=>String(row.shipmentCode||'').toUpperCase());

const db=new DatabaseSync(':memory:');
try{
  db.exec("CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,rowNumber INTEGER,rowJson TEXT);"+
    "CREATE TABLE business_scan_results(businessType TEXT,reportDate TEXT,shipmentCode TEXT,isPod INTEGER,orderStatus TEXT,rawJson TEXT);"+
    "CREATE TABLE business_final_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,isPod INTEGER,primaryCategory TEXT,apiStatus TEXT,carryStatus TEXT,latestEventTime TEXT,latestEventDesc TEXT,latestNode TEXT,rawJson TEXT);"+
    "CREATE TABLE shipment_current_state(shipmentCode TEXT,businessType TEXT,reportDate TEXT,state TEXT,apiStatus TEXT,lastEventTime TEXT,stateJson TEXT);"+
    "CREATE TABLE business_shipment_tracks(businessType TEXT,reportDate TEXT,shipmentCode TEXT,shipmentStatus TEXT,updatedAt TEXT);"+
    "CREATE TABLE qc_tracking_ledger(shipmentCode TEXT,businessType TEXT,trackingStatus TEXT,terminalReason TEXT,podDate TEXT,lastEventTime TEXT)");
  const date='2026-07-02';
  const cases=[
    ['TESTPOD','OPEN','60','POD'],
    ['TESTRETURN','PENDING_SCAN','81','RETURNED'],
    ['TESTRETURNING','OPEN','80','RETURN_IN_PROGRESS'],
    ['TESTCONFLICT','POD','81','PENDING_VERIFICATION'],
    ['TESTNOSOURCE','PENDING_SCAN',null,'PENDING_SCAN']
  ];
  const iMember=db.prepare("INSERT INTO business_daily_parse_rows VALUES('WHPP',?,?,1,'{}')");
  const iCurrent=db.prepare("INSERT INTO shipment_current_state VALUES(?,'WHPP',? ,?,'success','',?)");
  const iScan=db.prepare("INSERT INTO business_scan_results VALUES('WHPP',?,?,0,'','{}')");
  const iFinal=db.prepare("INSERT INTO business_final_rows VALUES('WHPP',?,?,0,'待派送','success','','','','','{}')");
  const iTrack=db.prepare("INSERT INTO business_shipment_tracks VALUES('WHPP',?,?,?,'2026-10-14T01:00:00Z')");
  for(const [bill,state,status] of cases){
    iMember.run(date,bill);
    iCurrent.run(bill,date,state,JSON.stringify({currentState:state}));
    iScan.run(date,bill);iFinal.run(date,bill);
    if(status)iTrack.run(date,bill,status);
  }
  // Same bill, different report date: must not enter the selected-date result.
  iTrack.run('2026-07-03','TESTNOSOURCE','60');
  const result=loadWhppCanonicalTruth(date,'',db);
  assert.equal(result.total,5);
  const byBill=new Map(result.rows.map(row=>[row.shipmentCode,row]));
  for(const [bill,,status,expected] of cases){
    assert.equal(byBill.get(bill).currentState,expected,bill+' exact-date TMS projection');
    if(status)assert.equal(byBill.get(bill).truthEvidence.exactDayTmsStatus,status);
  }
  assert.equal(result.evidence.exactDayTmsRows,4);
  assert.equal(result.evidence.exactDayTmsConflicts,1);
  assert.equal(result.evidence.exactDayTmsTerminalRows,2);
  assert.equal(byBill.get('TESTPOD').truthEvidence.currentTerminalStrict,true);
  assert.equal(byBill.get('TESTRETURN').truthEvidence.currentTerminalStrict,true);
  assert.equal(byBill.get('TESTRETURNING').truthEvidence.pod,false);
  assert.equal(byBill.get('TESTRETURNING').truthEvidence.returned,false);
  assert.equal(byBill.get('TESTCONFLICT').truthEvidence.currentTerminalStrict,false);
  assert.equal(byBill.get('TESTNOSOURCE').truthEvidence.exactDayTmsSaved,false);
  assert.ok(!byBill.get('TESTPOD').podTime,'TMS code 60 alone must never invent a signing timestamp');
  // WHPP can supply real independent POD members with NO unified batch.
  const selected=persistentSelectedDatePodTruth(db,'WHPP',date);
  assert.equal(selected.authoritative,true);
  assert.deepEqual(selected.bills,['TESTPOD']);
  const projected=overlay(result.rows,db);
  const after=new Map(projected.map(row=>[row.shipmentCode,row]));
  assert.equal(after.get('TESTPOD').currentState,'POD');
  assert.equal(after.get('TESTPOD').terminalEvidenceStatus,'STRICT_TMS');
  assert.equal(after.get('TESTRETURN').currentState,'RETURNED');
  assert.equal(after.get('TESTRETURN').terminalEvidenceStatus,'STRICT_TMS');
  assert.equal(after.get('TESTRETURNING').currentState,'RETURNING');
  assert.equal(after.get('TESTRETURNING').terminalEvidenceStatus,'NONTERMINAL_80');
  assert.equal(after.get('TESTCONFLICT').currentState,'PENDING_VERIFICATION');
  assert.equal(after.get('TESTCONFLICT').terminalEvidenceStatus,'CONFLICT');
  assert.equal(after.get('TESTNOSOURCE').currentState,'PENDING_SCAN');
  assert.equal(after.get('TESTPOD').podTime,'');
  assert.equal(db.prepare("SELECT state FROM shipment_current_state WHERE shipmentCode='TESTPOD'").get().state,'OPEN',
    'read-only projection must never mutate historical current-state record');
  console.log('[V788 SAVED TMS BRIDGE] independent WHPP source, 60/80/81, stale OPEN, contradictions, zero fake time PASS');
}finally{db.close();}
