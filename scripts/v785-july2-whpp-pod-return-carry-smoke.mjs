import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {publishManualRefreshTruth} from '../src/manualRefreshPublication.js';
const ui=fs.readFileSync(new URL('../public/v625-shell.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const db=new DatabaseSync(':memory:');
try{
  const d='2026-07-02',snap='SNAP-v785-july02',refresh='MANUAL-CARRY-v785';
  const types=['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'];
  const batchCounts={CE:46,CEAF:70,TBKH:0,ALI1688:0,WHPP:0,SHOPEECN:0,SHOPEEVN:399};
  // Source SQL and explicit 515+156 proof.
  const beginning=ui.indexOf('const v755ImportCountTruth=new Map();');
  const ending=ui.indexOf('let v640EvidenceRefreshTimer',beginning);
  assert.ok(beginning>=0&&ending>beginning,'family source proof must be defined');
  const compile=new Function('json','v626LatestImport','V755_BUSINESS_COUNT_TYPES',
    ui.slice(beginning,ending)+'\nreturn {resolveV755FamilyCounts,v785WhppProofFor};');
  const latest={reportDate:d,snapshotId:snap,classificationCounts:batchCounts,summary:{validUniqueWaybills:515},
    sourceReconciliation:{balanced:true}};
  const json=async url=>{
    assert.match(url,/source-reconciliation/);
    return {ok:true,reportDate:d,snapshotId:snap,
      source:{balanced:true,counts:batchCounts,validUniqueWaybills:515},
      whppIndependent:{total:156,separateNotInImport:156,alreadyInImport:0,crossBusinessOverlap:0},
      display:{distinctUnion:671,hasUnresolvedConflict:false}};
  };
  const t=compile(json,latest,types);
  const family=await t.resolveV755FamilyCounts(d,latest);
  assert.deepEqual([family.CCSL,family.SHOPEE,family.WHPP],[116,399,156]);
  assert.equal(t.v785WhppProofFor(d).total,156);
  assert.match(ui,/const zeroWhpp=Boolean\(independentWhpp\)&&independentWhpp\.total===0/,
    'a WHPP independent 156 file can never become ZERO_TICKET');
  assert.match(ui,/const params=new URLSearchParams\(\{scope:'open'\}\)/,
    'unfinished POD lists must not use QC actionable-only filtering');
  assert.match(server,/const whppState=dateWhppState\(\)/,'selected-day WHPP must use exact canonical members');
  assert.match(server,/historicalCarryRows/,'prior days still-open carry members remain in unfinished queue');
  assert.match(server,/EXACT_7BUSINESS_WAYBILL_AND_DATED_WHPP_PLUS_HISTORICAL_OPEN_LEDGER/,
    'zero open rows must be validated by all exact selected-date members');

  // Evaluate actual server workspace filter with synthetic terminal and open
  // shipment statuses, not just text assertions.
  const start=server.indexOf('function workspaceRows(');
  const end=server.indexOf('function persistReconciliationDiagnostics(',start);
  assert.ok(start>0&&end>start);
  const maker=new Function('billOfWorkspace','workspacePendingNonContinuous','workspaceStoreArrived','workspaceOcDays',
    server.slice(start,end)+'\nreturn workspaceRows;');
  const workspace=maker(row=>String(row.shipmentCode||''),()=>false,()=>false,()=>0);
  const rows=workspace({businessType:'WHPP',reportDate:d,finalRows:[
    {shipmentCode:'X60',shipmentStatus:'60'},
    {shipmentCode:'X81',shipmentStatus:'81'},
    {shipmentCode:'X80',shipmentStatus:'80',primaryCategory:'退回'},
    {shipmentCode:'XRET',truthEvidence:{returned:true}},
    {shipmentCode:'XOPEN',currentState:'PENDING'},
    {shipmentCode:'XSCAN',scanIsPod:0}
  ]},'WHPP');
  const row=bill=>rows.find(x=>x.shipmentCode===bill);
  assert.equal(row('X60').isClosed,true,'real status60 closes POD');
  assert.equal(row('X60').isPod,true);
  assert.equal(row('X81').isClosed,true,'real status81 closes returned');
  assert.equal(row('X81').isReturned,true);
  assert.equal(row('X80').isClosed,false,'status80 returning stays OPEN');
  const whppCanon=fs.readFileSync(new URL('../src/whppCanonicalTruth.js',import.meta.url),'utf8');
  assert.match(whppCanon,/if\(status==='80'\)return false/,'WHPP 80 cannot close through legacy return text');
  assert.equal(row('XRET').isClosed,true,'WHPP saved returned evidence closes');
  assert.equal(row('XOPEN').isClosed,false,'Pending stays in refresh queue');

  db.exec(`
   CREATE TABLE shipment_current_state(shipmentCode TEXT,businessType TEXT,state TEXT,apiStatus TEXT,lastEventTime TEXT,
      stateJson TEXT,updatedAt TEXT,snapshotId TEXT,reportDate TEXT);
   CREATE TABLE carryover_open_items(shipmentCode TEXT,businessType TEXT,sourceReportDate TEXT,sourceSnapshotId TEXT);
   CREATE TABLE unified_import_batches(batchId TEXT,snapshotId TEXT,reportDate TEXT,status TEXT,createdAt TEXT);
   CREATE TABLE unified_import_rows(id INTEGER PRIMARY KEY,shipmentCode TEXT,businessType TEXT,reportDate TEXT,snapshotId TEXT);
   CREATE TABLE business_daily_parse_rows(shipmentCode TEXT,businessType TEXT,reportDate TEXT);
   CREATE TABLE scan_results(shipmentCode TEXT,isPod INTEGER,needsTrackQuery INTEGER,skipTrackReason TEXT,updatedAt TEXT);
   CREATE TABLE business_scan_results(shipmentCode TEXT,businessType TEXT,isPod INTEGER,needsTrackQuery INTEGER,skipTrackReason TEXT,updatedAt TEXT);
  `);
  const bill=['D785POD','D785RETURN','D785RETURNING'];
  db.prepare('INSERT INTO unified_import_batches VALUES(?,?,?,?,?)').run('BATCH-785',snap,d,'VALID','2026-10-09T00:00:00Z');
  const addState=db.prepare('INSERT INTO shipment_current_state VALUES(?,?,?,?,?,?,?,?,?)');
  const addScan=db.prepare('INSERT INTO business_scan_results VALUES(?,?,?,?,?,?)');
  const addDaily=db.prepare('INSERT INTO business_daily_parse_rows VALUES(?,?,?)');
  const addCarry=db.prepare('INSERT INTO carryover_open_items VALUES(?,?,?,?)');
  for(let i=0;i<bill.length;i++){
    const type=['60','81','80'][i];
    addState.run(bill[i],'WHPP','OPEN','SUCCESS','2026-10-09T10:00:00Z',
      JSON.stringify({shipmentStatus:type,currentState:'OPEN'}),'',refresh,d);
    addDaily.run(bill[i],'WHPP',d);
    addScan.run(bill[i],'WHPP',0,1,'','');
    addCarry.run(bill[i],'WHPP',d,'');
  }
  const published=publishManualRefreshTruth(refresh,{db});
  assert.equal(published.published,3,'WHPP daily parse members must bind even without unified membership');
  assert.equal(published.unbound,0,'none of three independent WHPP members may be unbound');
  assert.equal(published.terminalScanLocks,2,'status60/81 terminate, status80 must not close');
  const saved=db.prepare('SELECT shipmentCode,isPod,needsTrackQuery,skipTrackReason FROM business_scan_results ORDER BY shipmentCode').all();
  const by=new Map(saved.map(x=>[x.shipmentCode,x]));
  assert.equal(by.get('D785POD').isPod,1);
  assert.equal(by.get('D785POD').skipTrackReason,'MANUAL_TERMINAL_POD');
  assert.equal(by.get('D785RETURN').skipTrackReason,'MANUAL_TERMINAL_RETURNED');
  assert.equal(by.get('D785RETURNING').needsTrackQuery,1,'return-in-progress needs future refresh');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM shipment_current_state WHERE snapshotId=? AND reportDate=?').get(snap,d).n,3,
    'manual refreshes must bind back to dated business provenance for export/timing');
  console.log('[V785 JULY 2 END-TO-END] 515+156 source 3/3 guard; 60 POD; 81 returned; 80 remains open; dated WHPP 3/3 manual refresh publication; OPEN queue not QC-only PASS');
}finally{db.close()}
