import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const src=fs.readFileSync(new URL('../src/lightweightDashboardStore.js',import.meta.url),'utf8').replace(/\r\n?/g,'\n');
const start=src.indexOf('function overlaySavedTerminalExportTruth(');
const end=src.indexOf('function listLatestValidRangeBatches(',start);
assert.ok(start>=0&&end>start,'actual exported terminal projection must remain accessible');
const db=new DatabaseSync(':memory:');
db.exec(`
 CREATE TABLE qc_tracking_ledger(shipmentCode TEXT,businessType TEXT,trackingStatus TEXT,terminalReason TEXT,podDate TEXT,lastEventTime TEXT);
 CREATE TABLE shipment_current_state(shipmentCode TEXT,businessType TEXT,state TEXT,stateJson TEXT,lastEventTime TEXT);
`);
const overlay=new Function('getDb','billOf',src.slice(start,end)+'\nreturn overlaySavedTerminalExportTruth;')(
 ()=>db,row=>String(row.shipmentCode||'').toUpperCase());
const put=db.prepare('INSERT INTO shipment_current_state VALUES(?,?,?,?,?)');
put.run('CE26070200001','WHPP','POD',JSON.stringify({shipmentStatus:'60',podTime:'2026-07-03 09:00:00'}),'2026-07-03 09:00:00');
put.run('CE26070200002','WHPP','RETURNING',JSON.stringify({shipmentStatus:'80'}),'2026-07-03 10:00:00');
put.run('CE26070200003','WHPP','RETURNED',JSON.stringify({shipmentStatus:'81'}),'2026-07-03 11:00:00');
put.run('CE26070200004','SHOPEEVN','POD',JSON.stringify({shipmentStatus:'60',podTime:'2026-07-04 09:00:00'}),'2026-07-04 09:00:00');
const original=[
 {shipmentCode:'CE26070200001',businessType:'WHPP',reportDate:'2026-07-02',是否POD:'否',primaryCategory:'Pending'},
 {shipmentCode:'CE26070200002',businessType:'WHPP',reportDate:'2026-07-02',是否退回:'是',退回状态:'已退回',primaryCategory:'退回'},
 {shipmentCode:'CE26070200003',businessType:'WHPP',reportDate:'2026-07-02',是否退回:'否',primaryCategory:'Pending'},
 {shipmentCode:'CE26070200004',businessType:'SHOPEEVN',reportDate:'2026-07-02',是否POD:'否',primaryCategory:'Pending'}
];
// Real V788 acceptance condition: historical WHPP ledger can remain OPEN /
// PENDING_SCAN while the exact shipment current state is strictly terminal.
// Exports must honor terminal source evidence rather than regress to OPEN.
const insertLedger=db.prepare('INSERT INTO qc_tracking_ledger VALUES(?,?,?,?,?,?)');
for(const bill of ['CE26070200001','CE26070200002','CE26070200003']){
  insertLedger.run(bill,'WHPP','OPEN','PENDING_SCAN',null,null);
}
const rows=overlay(original,db);
assert.equal(rows[0].currentState,'POD');
assert.equal(rows[0].是否POD,'是');
assert.equal(rows[0].podDate,'2026-07-03 09:00:00');
assert.equal(rows[1].currentState,'RETURNING');
assert.equal(rows[1].是否退回,'否');
assert.equal(rows[1].退回状态,'退回中');
assert.equal(rows[2].currentState,'RETURNED');
assert.equal(rows[2].是否退回,'是');
assert.equal(rows[3].currentState,'POD');
assert.equal(rows[3].是否POD,'是');
assert.ok(rows.every(r=>r.reportDate==='2026-07-02'),'historical source membership must remain unchanged');
assert.ok(original[0].是否POD==='否'&&original[1].退回状态==='已退回','read-only export overlay must not change saved source rows');

// V788: actual WHPP canonical source reads 60/81 terminal status from the
// exact selected-day current-state member, even with stale ledger OPEN and
// missing scan/final evidence. Status 80 or contradictory current evidence
// must NEVER open an unverified export.
const {loadWhppCanonicalTruth}=await import('../src/whppCanonicalTruth.js');
const whppDb=new DatabaseSync(':memory:');
whppDb.exec(`
  CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,rowNumber INTEGER,rowJson TEXT);
  CREATE TABLE shipment_current_state(shipmentCode TEXT,businessType TEXT,reportDate TEXT,state TEXT,apiStatus TEXT,lastEventTime TEXT,stateJson TEXT);
  CREATE TABLE business_final_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,isPod INTEGER,primaryCategory TEXT,apiStatus TEXT,carryStatus TEXT,latestEventTime TEXT,latestEventDesc TEXT,latestNode TEXT,rawJson TEXT);
`);
const putWhpp=whppDb.prepare("INSERT INTO business_daily_parse_rows VALUES('WHPP','2026-07-02',?,?,'{}')");
const putWhppCurrent=whppDb.prepare("INSERT INTO shipment_current_state VALUES(?,'WHPP','2026-07-02',?,'success','',?)");
putWhpp.run('CE020726TEST01',1);putWhpp.run('CE020726TEST02',2);
putWhppCurrent.run('CE020726TEST01','POD',JSON.stringify({shipmentStatus:'60',podTime:'2026-07-03 11:00:00'}));
putWhppCurrent.run('CE020726TEST02','RETURNED',JSON.stringify({shipmentStatus:'81'}));
// A stale legacy final event code cannot downgrade a newer current 81.
whppDb.prepare("INSERT INTO business_final_rows VALUES('WHPP','2026-07-02','CE020726TEST02',0,'退回中','success','','','','',?)")
  .run(JSON.stringify({shipmentStatus:'80',currentState:'RETURNING'}));
const proof=loadWhppCanonicalTruth('2026-07-02','',whppDb);
assert.equal(proof.total,2);
assert.equal(proof.evidence.scanRows,0);
assert.equal(proof.evidence.finalRows,1);
assert.equal(proof.evidence.currentRows,2);
assert.ok(proof.rows.every(row=>row.truthEvidence.currentTerminalStrict===true),'60/81 saved current facts must be independently verifiable');
assert.equal(proof.rows.find(row=>row.shipmentCode==='CE020726TEST02').currentState,'RETURNED','new saved 81 must override stale final 80');
const whppStart=src.indexOf('function loadLightweightExportRows(');
const whppEnd=src.indexOf('// Read-only export overlay.',whppStart);
assert.ok(whppStart>=0&&whppEnd>whppStart);
const whppExport=new Function('getDb','loadWhppCanonicalTruth','billOf','overlaySavedTerminalExportTruth',
 src.slice(whppStart,whppEnd)+'\nreturn loadLightweightExportRows;')(
 ()=>whppDb,loadWhppCanonicalTruth,row=>String(row.shipmentCode||''),(rows)=>rows
);
const exported=whppExport('V788-SNAPSHOT','2026-07-02','WHPP');
assert.equal(exported.length,2,'verified current-state terminal coverage may substitute for missing WHPP scan/final rows');
assert.equal(exported.filter(row=>row.currentState==='POD').length,1);
assert.equal(exported.filter(row=>row.currentState==='RETURNED').length,1);
assert.ok(exported.every(row=>row.reportDate==='2026-07-02'));
putWhpp.run('CE020726TEST03',3);
putWhppCurrent.run('CE020726TEST03','RETURNING',JSON.stringify({shipmentStatus:'80'}));
assert.throws(()=>whppExport('V788-SNAPSHOT','2026-07-02','WHPP'),/TMS 60\/81终态证据/,
 'return-in-progress 80 must never be counted as completed return');
whppDb.prepare("UPDATE shipment_current_state SET state='POD' WHERE shipmentCode='CE020726TEST03'").run();
assert.throws(()=>whppExport('V788-SNAPSHOT','2026-07-02','WHPP'),/TMS 60\/81终态证据/,
 'current POD label contradicting saved TMS 80 must never bypass export gate');
whppDb.close();

// The 7/1-7/2 real-copy pattern: every WHPP member has a scan and a final
// record, but normalized labels have no original shipmentStatus=60/81.
// Export membership can pass; no TMS proof or POD timestamps are invented.
const labelDb=new DatabaseSync(':memory:');
labelDb.exec("CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,rowNumber INTEGER,rowJson TEXT);"+
 "CREATE TABLE business_scan_results(businessType TEXT,reportDate TEXT,shipmentCode TEXT,isPod INTEGER,orderStatus TEXT,rawJson TEXT);"+
 "CREATE TABLE business_final_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,isPod INTEGER,primaryCategory TEXT,apiStatus TEXT,carryStatus TEXT,latestEventTime TEXT,latestEventDesc TEXT,latestNode TEXT,rawJson TEXT);"+
 "CREATE TABLE shipment_current_state(shipmentCode TEXT,businessType TEXT,reportDate TEXT,state TEXT,apiStatus TEXT,lastEventTime TEXT,stateJson TEXT);");
for(const [bill,state,pod,cat] of [
 ['CE020726LABEL01','POD',1,'POD'],
 ['CE020726LABEL02','POD',1,'POD'],
 ['CE020726LABEL03','RETURNED',0,'已退回']
]){
 labelDb.prepare("INSERT INTO business_daily_parse_rows VALUES('WHPP','2026-07-02',?,1,'{}')").run(bill);
 labelDb.prepare("INSERT INTO business_scan_results VALUES('WHPP','2026-07-02',?,?,?, '{}')").run(bill,pod,pod?'85':'');
 labelDb.prepare("INSERT INTO business_final_rows VALUES('WHPP','2026-07-02',?,?,?,'success','','','','','{}')").run(bill,pod,cat);
 labelDb.prepare("INSERT INTO shipment_current_state VALUES(?,'WHPP','2026-07-02',?,'success','','{}')").run(bill,state);
}
const labelTruth=loadWhppCanonicalTruth('2026-07-02','',labelDb);
assert.equal(labelTruth.total,3);
assert.equal(labelTruth.evidence.scanRows,3);
assert.equal(labelTruth.evidence.finalRows,3);
assert.equal(labelTruth.evidence.podRows,2);
assert.equal(labelTruth.evidence.returnedRows,1);
assert.equal(labelTruth.rows.filter(row=>row.truthEvidence?.currentTerminalStrict).length,0,
  'saved normalized states cannot masquerade as strict 60/81 TMS proof');
const labelExport=new Function('getDb','loadWhppCanonicalTruth','billOf','overlaySavedTerminalExportTruth',
 src.slice(whppStart,whppEnd)+'\nreturn loadLightweightExportRows;')(
 ()=>labelDb,loadWhppCanonicalTruth,row=>String(row.shipmentCode||''),(rows)=>rows);
const labelRows=labelExport('V788-NO-TMS','2026-07-02','WHPP');
assert.equal(labelRows.length,3,'complete scan+final coverage permits source-member export');
assert.equal(labelRows.filter(row=>row.currentState==='POD').length,2);
assert.equal(labelRows.filter(row=>row.currentState==='RETURNED').length,1);
assert.ok(labelRows.every(row=>!row.podDate),'missing POD timestamps must remain missing');
labelDb.close();

console.log('[V785 EXPORT] saved TMS status 60(POD)/80(return-in-progress)/81(return-completed), WHPP and Shopee, historical-date preservation and read-only overlay PASS');
db.close();
