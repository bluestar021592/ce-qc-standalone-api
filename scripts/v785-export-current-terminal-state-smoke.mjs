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
assert.equal(rows[1].podDate,'','returning 80 must not carry stale POD date');
assert.equal(rows[2].signingDays,null,'returned 81 must not be part of signing average');
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
// Persisted POD locks can recover a signed timestamp ONLY for the matching
// POD member and ONLY with trusted provenance and valid event date.
labelDb.exec("CREATE TABLE business_pod_locks(businessType TEXT,shipmentCode TEXT,podTime TEXT,source TEXT)");
const addLock=labelDb.prepare("INSERT INTO business_pod_locks VALUES('WHPP',?,?,?)");
addLock.run('CE020726LABEL01','2026-07-03 08:30:00','whpp_strict_track_event');
addLock.run('CE020726LABEL02','2026-07-01 22:00:00','whpp_saved_scan_pod_time');
addLock.run('CE020726LABEL03','2026-07-03 12:00:00','whpp_strict_track_event');
const recovered=loadWhppCanonicalTruth('2026-07-02','',labelDb);
assert.equal(recovered.evidence.trustedSavedPodTimeRows,1,
  'only valid and exact-member saved POD timing can be restored');
const r01=recovered.rows.find(row=>row.shipmentCode==='CE020726LABEL01');
assert.equal(r01.podTime,'2026-07-03 08:30:00');
assert.equal(r01.podDate,'2026-07-03');
assert.equal(r01.truthEvidence.savedPodTimeSource,'whpp_strict_track_event');
assert.equal(r01.truthEvidence.currentTerminalStrict,false,
  'track POD event does not constitute TMS shipmentStatus=60');
assert.equal(recovered.rows.find(row=>row.shipmentCode==='CE020726LABEL02').podTime,undefined,
  'POD lock dated before source intake must not be used');
assert.equal(recovered.rows.find(row=>row.shipmentCode==='CE020726LABEL03').podTime,undefined,
  'a return must never inherit an unrelated stored POD lock');
const recoveredExport=labelExport('V788-NO-TMS','2026-07-02','WHPP');
assert.equal(recoveredExport.find(row=>row.shipmentCode==='CE020726LABEL01').podTime,
  '2026-07-03 08:30:00','evidence-qualified POD time must enter export');
assert.ok(!recoveredExport.find(row=>row.shipmentCode==='CE020726LABEL02').podTime);
assert.ok(!recoveredExport.find(row=>row.shipmentCode==='CE020726LABEL03').podTime);
// ISO timestamps with time zone are also real saved event times. Unknown
// provenance remains ignored even when it looks like a valid timestamp.
labelDb.prepare("UPDATE business_pod_locks SET podTime=?,source=? WHERE shipmentCode=?")
  .run('2026-07-04T09:30:00.000Z','USER_EDIT','CE020726LABEL02');
assert.equal(loadWhppCanonicalTruth('2026-07-02','',labelDb).evidence.trustedSavedPodTimeRows,1);
labelDb.prepare("UPDATE business_pod_locks SET source=? WHERE shipmentCode=?")
  .run('whpp_saved_final_pod_time','CE020726LABEL02');
const isoTruth=loadWhppCanonicalTruth('2026-07-02','',labelDb);
assert.equal(isoTruth.evidence.trustedSavedPodTimeRows,2);
assert.equal(isoTruth.rows.find(row=>row.shipmentCode==='CE020726LABEL02').podTime,'2026-07-04T09:30:00.000Z');
assert.equal(labelExport('V788-NO-TMS','2026-07-02','WHPP').find(
  row=>row.shipmentCode==='CE020726LABEL02').podDate,'2026-07-04');
// Check final export overlay (not just canonical source): an older ledger
// date must never overwrite member-matched POD lock provenance.
labelDb.exec("CREATE TABLE qc_tracking_ledger(shipmentCode TEXT,businessType TEXT,trackingStatus TEXT,terminalReason TEXT,podDate TEXT,lastEventTime TEXT)");
labelDb.prepare("INSERT INTO qc_tracking_ledger VALUES(?,'WHPP','TERMINAL','POD','2026-07-03','')")
  .run('CE020726LABEL01');
labelDb.prepare("INSERT INTO qc_tracking_ledger VALUES(?,'WHPP','TERMINAL','POD','2026-07-03','')")
  .run('CE020726LABEL02');
labelDb.prepare("INSERT INTO qc_tracking_ledger VALUES(?,'WHPP','TERMINAL','RETURNED','','')")
  .run('CE020726LABEL03');
const trueProjection=overlay(labelExport('V788-NO-TMS','2026-07-02','WHPP'),labelDb);
assert.equal(trueProjection.length,3);
assert.equal(trueProjection.find(row=>row.shipmentCode==='CE020726LABEL01').podTime,
  '2026-07-03 08:30:00','verified timestamp must outrank outdated ledger only');
assert.equal(trueProjection.find(row=>row.shipmentCode==='CE020726LABEL01').signingDays,2);
assert.equal(trueProjection.find(row=>row.shipmentCode==='CE020726LABEL02').podTime,
  '2026-07-04T09:30:00.000Z','ISO saved time must outrank outdated ledger');
assert.equal(trueProjection.find(row=>row.shipmentCode==='CE020726LABEL02').signingDays,3);
const returnedProjected=trueProjection.find(row=>row.shipmentCode==='CE020726LABEL03');
assert.equal(returnedProjected.currentState,'RETURNED');
assert.equal(returnedProjected.podTime,'','returned member must not retain old POD time');
assert.equal(returnedProjected.podDate,'');
assert.equal(returnedProjected.signingDays,null);
labelDb.close();

// V788: stale ledger TERMINAL must not override an exact newer TMS status80.
// A normalized POD/RETURNED label without original 60/81 may appear in an
// export but must NOT be advertised as a strict TMS terminal.
const status80Bill='CE020726STATUS80';
put.run(status80Bill,'WHPP','RETURNED',JSON.stringify({shipmentStatus:'80'}),'2026-07-04 08:00:00');
insertLedger.run(status80Bill,'WHPP','TERMINAL','RETURNED',null,'2026-07-03 00:00:00');
const conflict=overlay([{shipmentCode:status80Bill,businessType:'WHPP',reportDate:'2026-07-02',
  isPod:1,POD状态:'POD',是否退回:'是',退回状态:'已退回'}],db)[0];
assert.equal(conflict.currentState,'PENDING_VERIFICATION','status80/normalized terminal contradiction must remain unresolved');
assert.equal(conflict.是否POD,'否');
assert.equal(conflict.POD状态,'');
assert.equal(conflict.是否退回,'否');
assert.equal(conflict.terminalEvidenceStatus,'CONFLICT');
// Late TMS terminal updates must close a previously OPEN or Pending
// member. Only two contradictory terminal states require investigation.
const latePod='CE020726LATEPOD',lateReturn='CE020726LATERET';
put.run(latePod,'WHPP','PENDING_SCAN',
  JSON.stringify({shipmentStatus:'60',podTime:'2026-07-05 11:20:00'}),'2026-07-05 11:20:00');
put.run(lateReturn,'WHPP','OPEN',JSON.stringify({shipmentStatus:'81'}),'2026-07-05 12:30:00');
insertLedger.run(latePod,'WHPP','OPEN','',null,null);
insertLedger.run(lateReturn,'WHPP','OPEN','',null,null);
const newlyFinished=overlay([
 {shipmentCode:latePod,businessType:'WHPP',reportDate:'2026-07-02',
   currentState:'PENDING_SCAN',pendingDays:3,是否POD:'否',primaryCategory:'Pending'},
 {shipmentCode:lateReturn,businessType:'WHPP',reportDate:'2026-07-02',
   currentState:'OPEN',pendingDays:3,是否POD:'否',primaryCategory:'Pending'}
],db);
assert.equal(newlyFinished[0].currentState,'POD',
  'late status60 must close previously pending member, not fabricate a terminal conflict');
assert.equal(newlyFinished[0].是否POD,'是');
assert.equal(newlyFinished[0].terminalEvidenceStatus,'STRICT_TMS');
assert.equal(newlyFinished[1].currentState,'RETURNED',
  'late status81 must close previously OPEN member, not fabricate a terminal conflict');
assert.equal(newlyFinished[1].是否退回,'是');
assert.equal(newlyFinished[1].terminalEvidenceStatus,'STRICT_TMS');
// Dashboard unresolved carry uses precisely the same final terminal
// overlay as export. Late terminal proof must clear it from OPEN counters
// without mutating the old persisted carry row.
const filterStart=src.indexOf('function filterActiveCarryMembers(');
const filterEnd=src.indexOf('// Read-only export overlay.',filterStart);
assert.ok(filterStart>=0&&filterEnd>filterStart);
const filterCarry=new Function('overlaySavedTerminalExportTruth','getDb','billOf',
  src.slice(filterStart,filterEnd)+'\nreturn filterActiveCarryMembers;')(
    overlay,()=>db,row=>String(row.shipmentCode||'').toUpperCase());
assert.deepEqual(filterCarry([latePod,lateReturn,status80Bill],'WHPP','2026-07-02',db),
  [status80Bill],'late POD and returned must leave historical OPEN counts; conflicting return80 remains');
assert.equal(db.prepare("SELECT trackingStatus FROM qc_tracking_ledger WHERE shipmentCode=?")
  .get(latePod).trackingStatus,'OPEN','dashboard read must not silently modify the historic ledger');
assert.equal(db.prepare("SELECT trackingStatus FROM qc_tracking_ledger WHERE shipmentCode=?")
  .get(lateReturn).trackingStatus,'OPEN','dashboard read must keep original evidence unchanged');
const openUnknown='CE020726UNRESOLVED';
put.run(openUnknown,'WHPP','PENDING_SCAN','{}','');
assert.deepEqual(filterCarry([openUnknown,latePod,lateReturn],'WHPP','2026-07-02',db),
  [openUnknown],'missing evidence must remain visible in unresolved queue');
const knownDailyRows=overlay([
  {shipmentCode:latePod,businessType:'WHPP',reportDate:'2026-07-02'},
  {shipmentCode:lateReturn,businessType:'WHPP',reportDate:'2026-07-02'},
  {shipmentCode:openUnknown,businessType:'WHPP',reportDate:'2026-07-02'}
],db);
assert.deepEqual(filterCarry([openUnknown,latePod,lateReturn],'WHPP','2026-07-02',db,knownDailyRows),
  [openUnknown],'dashboard should reuse already-projected daily rows for carry');
const noRepeatedQuery=(rows)=>{throw new Error('daily terminal facts must be reused');};
const reuseFn=new Function('overlaySavedTerminalExportTruth','getDb','billOf',
  src.slice(filterStart,filterEnd)+'\nreturn filterActiveCarryMembers;')(
    noRepeatedQuery,()=>db,row=>String(row.shipmentCode||'').toUpperCase());
assert.deepEqual(reuseFn([latePod,lateReturn,openUnknown],'WHPP','2026-07-02',db,knownDailyRows),
  [openUnknown],'no redundant SQLite terminal query for carry bills already in daily rows');
const oppositePod='CE020726OPPOSITEPOD';
put.run(oppositePod,'WHPP','RETURNED',JSON.stringify({shipmentStatus:'60'}),'2026-07-05');
const opposite=overlay([{shipmentCode:oppositePod,businessType:'WHPP',
  reportDate:'2026-07-02',currentState:'RETURNED',是否退回:'是'}],db)[0];
assert.equal(opposite.currentState,'PENDING_VERIFICATION',
  'strict60 opposite a saved explicit returned terminal must remain a conflict');
assert.equal(opposite.terminalEvidenceStatus,'CONFLICT');
// A new strict returned or POD state must replace *all* contradictory old
// source flags. Excel must not read an obsolete source shipmentStatus first.
const newlyReturned='CE020726LATERETSWAP',newlyPod='CE020726LATEPODSWAP';
put.run(newlyReturned,'WHPP','RETURNED',JSON.stringify({shipmentStatus:'81'}),'2026-07-06');
put.run(newlyPod,'WHPP','POD',JSON.stringify({shipmentStatus:'60'}),'2026-07-06');
const switched=overlay([
  {shipmentCode:newlyReturned,businessType:'WHPP',reportDate:'2026-07-02',
    currentState:'POD',shipmentStatus:'60',orderStatus:'85',isPod:1,是否POD:'是',
    truthEvidence:{pod:true,returned:false}},
  {shipmentCode:newlyPod,businessType:'WHPP',reportDate:'2026-07-02',
    currentState:'RETURNED',shipmentStatus:'81',isPod:0,是否退回:'是',
    truthEvidence:{pod:false,returned:true}}
],db);
assert.equal(switched[0].currentState,'RETURNED');
assert.equal(switched[0].shipmentStatus,'81');
assert.equal(switched[0].truthEvidence.pod,false);
assert.equal(switched[0].truthEvidence.returned,true);
assert.equal(switched[1].currentState,'POD');
assert.equal(switched[1].shipmentStatus,'60');
assert.equal(switched[1].truthEvidence.pod,true);
assert.equal(switched[1].truthEvidence.returned,false);
// Integration exercise of the production six-business dashboard reader:
// final_rows may still say PENDING after newer current-state 60/81 proof,
// and carryover_open_items may still say OPEN. Both displayed outputs must
// agree with the export projection without mutating persisted evidence.
const cePod='CE020726DASHPOD',ceReturned='CE020726DASHRETURN',
  ceOpen='CE020726DASHOPEN';
put.run(cePod,'CE','POD',JSON.stringify({shipmentStatus:'60'}),'2026-07-06');
put.run(ceReturned,'CE','RETURNED',JSON.stringify({shipmentStatus:'81'}),'2026-07-06');
put.run(ceOpen,'CE','PENDING_SCAN','{}','');
const liveMergeStart=src.indexOf('function mergeBusinessRows(');
const liveMergeEnd=src.indexOf('function loadRun(',liveMergeStart);
assert.ok(liveMergeStart>=0&&liveMergeEnd>liveMergeStart);
const liveMerge=new Function('billOf',src.slice(liveMergeStart,liveMergeEnd)+
  '\nreturn mergeBusinessRows;')(row=>String(row.shipmentCode||'').toUpperCase());
const dayRows=[cePod,ceReturned,ceOpen].map(shipmentCode=>({
  shipmentCode,businessType:'CE',reportDate:'2026-07-02',
  currentState:'PENDING_SCAN',isPod:0,是否POD:'否'
}));
const carryRows=[cePod,ceReturned,ceOpen].map(shipmentCode=>({shipmentCode}));
const fakeDb={
  prepare(sql){
    if(sql.includes('FROM carryover_open_items'))return {all:()=>carryRows};
    if(sql.includes('SELECT c.shipmentCode'))return {all:()=>[]};
    return db.prepare(sql);
  }
};
const readerStart=src.indexOf('export function loadLightweightUnifiedBusinessState(');
const readerEnd=src.indexOf('export function loadLightweightAggregateState(',readerStart);
assert.ok(readerStart>=0&&readerEnd>readerStart);
const dashboardReader=new Function(
  'normalizeBusinessType','getDb','selectBatch','emptyState','loadDailyRows','billOf',
  'mergeBusinessRows','loadCurrentStateRows','loadFinalRows','overlaySavedTerminalExportTruth',
  'loadScanRows','filterActiveCarryMembers','loadRun','listLightweightBusinessHistory',
  'isPodRow','SHOPEE_TYPES',
  src.slice(readerStart,readerEnd).replace('export function','function')+
    '\nreturn loadLightweightUnifiedBusinessState;')(
  x=>x,()=>fakeDb,()=>({snapshotId:'V788-INTEGRATION',reportDate:'2026-07-02',
    snapshotStatus:'COMPLETED'}),
  ()=>({}),()=>dayRows.map(r=>({...r})),
  row=>String(row.shipmentCode||'').toUpperCase(),
  liveMerge,()=>dayRows.map(r=>({...r})),
  ()=>dayRows.map(r=>({...r})),overlay,()=>[],
  filterCarry,()=>null,()=>[],()=>false,new Set());
const dashboardState=dashboardReader('CE','V788-INTEGRATION',{includeHistory:false});
assert.equal(dashboardState.finalRows.length,3);
assert.equal(dashboardState.finalRows.find(r=>r.shipmentCode===cePod).currentState,'POD',
  'a stale persisted final row must not hide late current TMS POD on dashboard');
assert.equal(dashboardState.finalRows.find(r=>r.shipmentCode===ceReturned).currentState,'RETURNED',
  'a stale persisted final row must not hide late current TMS return on dashboard');
assert.deepEqual(dashboardState.carryBills,[ceOpen],
  'dashboard unresolved queue must contain only truly unfinished member');
assert.deepEqual(dashboardState.nextCarryBills,[ceOpen],
  'next carry queue uses same effective open members');
const labelOnlyBill='CE020726LABELONLY';
put.run(labelOnlyBill,'WHPP','RETURNED','{}','');
const labelOnly=overlay([{shipmentCode:labelOnlyBill,businessType:'WHPP',reportDate:'2026-07-02'}],db)[0];
assert.equal(labelOnly.currentState,'RETURNED','legacy label remains visible for audit');
assert.equal(labelOnly.terminalEvidenceStatus,'NORMALIZED_LABEL_ONLY',
  'an already saved RETURNED state is not proof of original TMS 81');
assert.equal(labelOnly.terminalEvidenceSource,'SAVED_NORMALIZED_RETURNED_LABEL');
const storeSource=fs.readFileSync(new URL('../src/whppStore.js',import.meta.url),'utf8');
const returnStart=storeSource.indexOf('function isReturned(row = {}) {');
const returnEnd=storeSource.indexOf('function categoryOf(row = {})',returnStart);
assert.ok(returnStart>=0&&returnEnd>returnStart);
const whppIsReturned=new Function(storeSource.slice(returnStart,returnEnd)+'\nreturn isReturned;')();
assert.equal(whppIsReturned({primaryCategory:'退回'}),false,
  'legacy text category 退回 cannot finalize an unverified return');
assert.equal(whppIsReturned({primaryCategory:'退回',shipmentStatus:'80'}),false);
assert.equal(whppIsReturned({shipmentStatus:'81'}),true);
assert.equal(whppIsReturned({退回状态:'已退回',shipmentStatus:'80'}),false);
assert.equal(whppIsReturned({退回状态:'已退回'}),true,
  'explicit previously saved completed return remains compatible');

console.log('[V785 EXPORT] saved TMS status 60(POD)/80(return-in-progress)/81(return-completed), WHPP and Shopee, historical-date preservation and read-only overlay PASS');
db.close();
