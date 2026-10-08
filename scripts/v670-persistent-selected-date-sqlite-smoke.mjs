import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { persistentSelectedDatePodBills, persistentSelectedDatePodTruth, persistentWhppCompletionTruth } from '../src/selectedDatePersistentTruth.js';

const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE unified_import_batches(batchId TEXT,snapshotId TEXT,reportDate TEXT,status TEXT,createdAt TEXT);
CREATE TABLE unified_snapshots(snapshotId TEXT,status TEXT,payloadJson TEXT,createdAt TEXT);
CREATE TABLE unified_import_rows(batchId TEXT,snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT,regionCode TEXT,rowJson TEXT,rowNumber INTEGER);
CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,rowJson TEXT,rowNumber INTEGER);
CREATE TABLE business_final_rows(
  businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER,primaryCategory TEXT,apiStatus TEXT,carryStatus TEXT,
  latestEventTime TEXT,latestEventDesc TEXT,latestNode TEXT,recipient_group TEXT,rawJson TEXT
);
CREATE TABLE shipment_current_state(shipmentCode TEXT,businessType TEXT,reportDate TEXT,state TEXT,apiStatus TEXT,lastEventTime TEXT,stateJson TEXT);
CREATE TABLE business_scan_results(businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER,orderStatus TEXT,rawJson TEXT);
CREATE TABLE business_pod_locks(businessType TEXT,shipmentCode TEXT);
CREATE TABLE business_daily_reports(businessType TEXT,reportDate TEXT,totalCount INTEGER,summaryJson TEXT,updatedAt TEXT);
CREATE TABLE business_history_summary(businessType TEXT,reportDate TEXT,summaryJson TEXT,updatedAt TEXT);
CREATE TABLE business_export_snapshots(
  id INTEGER PRIMARY KEY AUTOINCREMENT,businessType TEXT,reportDate TEXT,snapshotId TEXT,status TEXT,reconciliationStatus TEXT,
  invalidReason TEXT,payloadJson TEXT,generatedAt TEXT,createdAt TEXT
);
`);

const date='2026-07-01';
db.prepare('INSERT INTO unified_import_batches VALUES(?,?,?,?,?)').run('BATCH-NEW','SNAP-NEW',date,'VALID','2026-07-01T01:00:00Z');
db.prepare('INSERT INTO unified_snapshots VALUES(?,?,?,?)').run(
  'SNAP-NEW','COMPLETED',
  JSON.stringify({parentRun:{children:{WHPP:{status:'COMPLETED'}}},sourceSnapshots:{WHPP:'WHPP-SNAP'},validationStatus:'VALID_COMPLETED',reconciliationStatus:'PASSED'}),
  '2026-07-01T03:00:00Z'
);
db.prepare(`INSERT INTO business_export_snapshots(
  businessType,reportDate,snapshotId,status,reconciliationStatus,invalidReason,payloadJson,generatedAt,createdAt
) VALUES(?,?,?,?,?,?,?,?,?)`).run(
  'WHPP',date,'WHPP-SNAP','VALID','COMPLETED','',
  JSON.stringify({snapshotId:'WHPP-SNAP',reportDate:date}),
  '2026-07-01T02:55:00Z','2026-07-01T02:55:00Z'
);
db.prepare('INSERT INTO unified_import_batches VALUES(?,?,?,?,?)').run('BATCH-OLD','SNAP-OLD',date,'SUPERSEDED','2026-07-01T00:00:00Z');
db.prepare('INSERT INTO unified_import_batches VALUES(?,?,?,?,?)').run('BATCH-LATER','SNAP-LATER','2026-07-02','VALID','2026-07-02T01:00:00Z');
db.prepare('INSERT INTO unified_import_rows VALUES(?,?,?,?,?,?,?,?)').run('BATCH-OLD','SNAP-OLD',date,'WHPP','OLD-BATCH-ONLY','PP',JSON.stringify({shipmentCode:'OLD-BATCH-ONLY'}),1);

const insertSource=db.prepare('INSERT INTO unified_import_rows VALUES(?,?,?,?,?,?,?,?)');
const insertFinal=db.prepare('INSERT INTO business_final_rows VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
const insertCurrent=db.prepare('INSERT INTO shipment_current_state VALUES(?,?,?,?,?,?,?)');
const insertScan=db.prepare('INSERT INTO business_scan_results VALUES(?,?,?,?,?,?)');

// WHPP: 190 source members, 166 POD. final_rows.isPod is intentionally zero;
// POD truth must be recovered from the same current/scan evidence used by the formal dashboard.
for(let i=1;i<=190;i++){
  const bill='W'+String(i).padStart(3,'0');
  insertSource.run('BATCH-NEW','SNAP-NEW',date,'WHPP',bill,i%2?'PP':'PV',JSON.stringify({shipmentCode:bill}),i);
  insertFinal.run('WHPP',bill,date,0,i<=166?'POD':'退回','SUCCESS','',date+'T09:00:00','', '', 'WHPP',JSON.stringify({shipmentCode:bill,currentState:i<=166?'POD':'RETURN_COMPLETED'}));
  insertCurrent.run(bill,'WHPP',date,i<=166?'POD':'RETURN_COMPLETED','SUCCESS',date+'T09:00:00',JSON.stringify({shipmentCode:bill,currentState:i<=166?'POD':'RETURN_COMPLETED'}));
  insertScan.run('WHPP',bill,date,0,i<=166?'85':'R',JSON.stringify({shipmentCode:bill,orderStatus:i<=166?'85':'R'}));
}
db.prepare('INSERT INTO business_history_summary VALUES(?,?,?,?)')
  .run('WHPP',date,JSON.stringify({total:190,accounting:{total:190,balanced:true}}),'2026-07-01T02:21:00Z');

// SHOPEE VN: 588 source members. Current normalized tables deliberately contain ZERO POD evidence,
// while the exact completed business snapshot retains 545 POD members. This reproduces the live failure
// where the business result survives but timing denominator incorrectly falls to zero.
const vnAllRows=[],vnPodRows=[];
for(let i=1;i<=588;i++){
  const bill='V'+String(i).padStart(3,'0');
  const row={shipmentCode:bill,运单号:bill,recipient_group:'VN',currentState:i<=545?'POD':'RETURN_COMPLETED'};
  vnAllRows.push(row);
  if(i<=545)vnPodRows.push(row);
  insertSource.run('BATCH-NEW','SNAP-NEW',date,'SHOPEEVN',bill,i%2?'PP':'PV',JSON.stringify({shipmentCode:bill}),1000+i);
  insertFinal.run('SHOPEE',bill,date,0,i<=545?'POD':'退回','SUCCESS','',date+'T10:00:00','','','VN',JSON.stringify({shipmentCode:bill,recipient_group:'VN'}));
  insertCurrent.run(bill,'SHOPEEVN',date,i<=545?'DELIVERY':'RETURN_COMPLETED','SUCCESS',date+'T10:00:00',JSON.stringify({shipmentCode:bill,currentState:i<=545?'DELIVERY':'RETURN_COMPLETED'}));
  insertScan.run('SHOPEE',bill,date,0,i<=545?'':'R',JSON.stringify({shipmentCode:bill,orderStatus:i<=545?'':'R'}));
}

// SHOPEE CN regression: selected-date completed snapshot has exact CN_all membership but a stale
// empty CN_pod tab. A later VALID daily report proves POD for 4 of the same 5 exact July-1 members.
// The selected-date member set must stay frozen while terminal POD status recovers from later reports.
const cnAllRows=[],cnPodRows=[];
for(let i=1;i<=5;i++){
  const bill='C'+String(i).padStart(3,'0');
  const row={shipmentCode:bill,运单号:bill,recipient_group:'CN',currentState:'DELIVERY'};
  cnAllRows.push(row);
  insertSource.run('BATCH-NEW','SNAP-NEW',date,'SHOPEECN',bill,i%2?'PP':'PV',JSON.stringify({shipmentCode:bill,'状态标识':'N'}),2000+i);
  insertSource.run('BATCH-LATER','SNAP-LATER','2026-07-02','SHOPEECN',bill,i%2?'PP':'PV',
    JSON.stringify({shipmentCode:bill,'状态标识':i<=4?'Y':'N','下单时间':'2026-07-01 08:00:00','派件时间':i<=4?'2026-07-02 12:00:00':''}),3000+i);
}
db.prepare(`INSERT INTO business_export_snapshots(
  businessType,reportDate,snapshotId,status,reconciliationStatus,invalidReason,payloadJson,generatedAt,createdAt
) VALUES(?,?,?,?,?,?,?,?,?)`).run(
  'SHOPEE',date,'SHOPEE-SNAP','VALID','COMPLETED','',
  JSON.stringify({snapshotId:'SHOPEE-SNAP',view:{detailTabs:{
    VN_all:{rows:vnAllRows,total:vnAllRows.length},
    VN_pod:{rows:vnPodRows,total:vnPodRows.length},
    CN_all:{rows:cnAllRows,total:cnAllRows.length},
    CN_pod:{rows:cnPodRows,total:cnPodRows.length},
    byRecipientGroup:{
      VN:{all:{rows:vnAllRows,total:vnAllRows.length},pod:{rows:vnPodRows,total:vnPodRows.length}},
      CN:{all:{rows:cnAllRows,total:cnAllRows.length},pod:{rows:cnPodRows,total:cnPodRows.length}}
    }
  }}}),
  '2026-07-01T02:30:00Z','2026-07-01T02:30:00Z'
);

// A historical carry row is deliberately persisted on the same reportDate but is not a member
// of the latest VALID import batch, so it must not enter the selected-date POD denominator.
insertFinal.run('SHOPEE','OLD-CARRY-POD',date,1,'POD','SUCCESS','',date+'T08:00:00','','','VN',JSON.stringify({shipmentCode:'OLD-CARRY-POD',currentState:'POD'}));
insertCurrent.run('OLD-CARRY-POD','SHOPEEVN',date,'POD','SUCCESS',date+'T08:00:00',JSON.stringify({shipmentCode:'OLD-CARRY-POD',currentState:'POD'}));
insertScan.run('SHOPEE','OLD-CARRY-POD',date,1,'85',JSON.stringify({shipmentCode:'OLD-CARRY-POD',orderStatus:'85'}));

const completion=persistentWhppCompletionTruth(db,date);
assert.equal(completion.locked,true);
assert.equal(completion.unifiedCompleted,true);
assert.equal(completion.unifiedWhppCompleted,true);
assert.equal(completion.completionSource,'UNIFIED_VERIFIED_WHPP_CHILD');
assert.equal(completion.sourceCount,190);
assert.equal(completion.canonicalTotal,190);

const whpp=persistentSelectedDatePodTruth(db,'WHPP',date);
assert.equal(whpp.authoritative,true);
assert.equal(whpp.sourceCount,190);
assert.equal(whpp.bills.length,166);

const vn=persistentSelectedDatePodTruth(db,'SHOPEEVN',date);
assert.equal(vn.authoritative,true);
assert.equal(vn.sourceCount,588);
assert.equal(vn.bills.length,545);
assert.equal(vn.source,'IMMUTABLE_SHOPEE_COMPLETED_SNAPSHOT');

const cn=persistentSelectedDatePodTruth(db,'SHOPEECN',date);
assert.equal(cn.authoritative,true);
assert.equal(cn.sourceCount,5);
assert.equal(cn.bills.length,4);
assert.equal(cn.source,'IMMUTABLE_SHOPEE_COMPLETED_SNAPSHOT_RECOVERED_BY_LATEST_DAILY_POD');
assert.equal(cn.recoveredFromEmptySnapshot,true);
assert.deepEqual(cn.bills,['C001','C002','C003','C004']);

// Same date old/superseded source and historical carry rows must not inflate the denominator.
assert.equal(vn.bills.includes('OLD-CARRY-POD'),false);

// Unified COMPLETED is a terminal receipt: even if runtime/final-row-only counters are imperfect,
// selected-date WHPP progress must remain complete.
db.prepare("DELETE FROM business_final_rows WHERE businessType='WHPP' AND reportDate=?").run(date);
const completionAfterLossyFinalRows=persistentWhppCompletionTruth(db,date);
assert.equal(completionAfterLossyFinalRows.locked,true);
assert.equal(completionAfterLossyFinalRows.completionSource,'UNIFIED_VERIFIED_WHPP_CHILD');


// V754 regression: an aggregate unified COMPLETED receipt without a real persisted WHPP child
// must not lock WHPP. This is the live failure that produced "3/3 complete" while 190 WHPP
// members were still PENDING_SCAN.
const falseDate='2026-07-03';
db.prepare('INSERT INTO unified_import_batches VALUES(?,?,?,?,?)').run('BATCH-FALSE','SNAP-FALSE',falseDate,'VALID','2026-07-03T01:00:00Z');
db.prepare('INSERT INTO unified_snapshots VALUES(?,?,?,?)').run(
  'SNAP-FALSE','COMPLETED',
  JSON.stringify({
    parentRun:{children:{WHPP:{status:'COMPLETED'}}},
    sourceSnapshots:{WHPP:'WHPP-SNAPSHOT-DOES-NOT-EXIST'},
    validationStatus:'VALID_COMPLETED',
    reconciliationStatus:'PASSED'
  }),
  '2026-07-03T02:00:00Z'
);
for(let i=1;i<=3;i++){
  insertSource.run('BATCH-FALSE','SNAP-FALSE',falseDate,'WHPP','WF'+i,'PP',JSON.stringify({shipmentCode:'WF'+i}),i);
}
const falseCompletion=persistentWhppCompletionTruth(db,falseDate);
assert.equal(falseCompletion.unifiedCompleted,true);
assert.equal(falseCompletion.unifiedWhppCompleted,false);
assert.equal(falseCompletion.locked,false);

// V757: an invalidated/no-longer-referenceable WHPP child must not force a
// second remote scan when all exact daily members retain full terminal
// scan+final evidence. Mere 190/190 classification is insufficient.
for(let i=1;i<=3;i++){
  const bill='WF'+i,returned=i===3;
  insertFinal.run('WHPP',bill,falseDate,returned?0:1,returned?'退回':'POD',
    'SUCCESS','CLOSED',falseDate+'T08:00:00','','','WHPP',
    JSON.stringify({shipmentCode:bill,currentState:returned?'RETURN_COMPLETED':'POD'}));
  insertCurrent.run(bill,'WHPP',falseDate,returned?'RETURN_COMPLETED':'POD',
    'SUCCESS',falseDate+'T08:00:00',JSON.stringify({shipmentCode:bill,currentState:returned?'RETURN_COMPLETED':'POD'}));
  insertScan.run('WHPP',bill,falseDate,returned?0:1,returned?'R':'85',
    JSON.stringify({shipmentCode:bill,orderStatus:returned?'R':'85'}));
}
const recoveredCompletion=persistentWhppCompletionTruth(db,falseDate);
assert.equal(recoveredCompletion.locked,true);
assert.equal(recoveredCompletion.unifiedWhppCompleted,false);
assert.equal(recoveredCompletion.terminalEvidenceVerified,true);
assert.equal(recoveredCompletion.completionSource,'EXACT_WHPP_TERMINAL_SCAN_FINAL_EVIDENCE');
assert.equal(recoveredCompletion.terminalEvidenceCoverage.scanRows,3);
assert.equal(recoveredCompletion.terminalEvidenceCoverage.finalRows,3);
assert.equal(recoveredCompletion.terminalEvidenceCoverage.podRows,2);
assert.equal(recoveredCompletion.terminalEvidenceCoverage.returnedRows,1);

// A missing scan, a live API retry, or an open/nonterminal member each prevent
// false 3-of-3 completion, even when source membership still balances.
db.prepare("DELETE FROM business_scan_results WHERE businessType='WHPP' AND reportDate=? AND shipmentCode='WF3'").run(falseDate);
assert.equal(persistentWhppCompletionTruth(db,falseDate).locked,false);
insertScan.run('WHPP','WF3',falseDate,0,'R',JSON.stringify({shipmentCode:'WF3',orderStatus:'R'}));
db.prepare("UPDATE business_final_rows SET apiStatus='API_PENDING_RETRY' WHERE businessType='WHPP' AND reportDate=? AND shipmentCode='WF3'").run(falseDate);
assert.equal(persistentWhppCompletionTruth(db,falseDate).locked,false);
db.prepare("UPDATE business_final_rows SET apiStatus='SUCCESS',carryStatus='OPEN' WHERE businessType='WHPP' AND reportDate=? AND shipmentCode='WF3'").run(falseDate);
assert.equal(persistentWhppCompletionTruth(db,falseDate).locked,false);
db.prepare("UPDATE business_final_rows SET carryStatus='CLOSED' WHERE businessType='WHPP' AND reportDate=? AND shipmentCode='WF3'").run(falseDate);
assert.equal(persistentWhppCompletionTruth(db,falseDate).locked,true);

// V763: reproduce the July-04 historical WHPP screenshot:
// legacy sourceCount=0, all four scan/final rows exist, but two neither POD
// nor returned. A "VALID/COMPLETED" snapshot can prove 4/4 scan/final processing\n// without fabricating POD/return closure for the two unknown customer statuses.
const whppStaleDate='2026-07-04';
db.prepare('INSERT INTO unified_import_batches VALUES(?,?,?,?,?)').run('BATCH-V763','SNAP-V763',whppStaleDate,'VALID','2026-07-04T01:00:00Z');
db.prepare('INSERT INTO unified_snapshots VALUES(?,?,?,?)').run('SNAP-V763','COMPLETED',JSON.stringify({parentRun:{children:{WHPP:{status:'WAIT'}}}}),'2026-07-04T02:00:00Z');
db.prepare(`INSERT INTO business_export_snapshots(
 businessType,reportDate,snapshotId,status,reconciliationStatus,invalidReason,payloadJson,generatedAt,createdAt
) VALUES(?,?,?,?,?,?,?,?,?)`).run('WHPP',whppStaleDate,'WHPP-V763-OLD','VALID','COMPLETED','',
  JSON.stringify({snapshotId:'WHPP-V763-OLD'}),'2026-07-04T02:50:00Z','2026-07-04T02:50:00Z');
for(let i=1;i<=4;i++){
  const code='WST'+i,pod=i<=2,state=pod?'POD':'PENDING';
  db.prepare('INSERT INTO business_daily_parse_rows VALUES(?,?,?,?,?)').run('WHPP',whppStaleDate,code,JSON.stringify({shipmentCode:code}),i);
  insertFinal.run('WHPP',code,whppStaleDate,pod?1:0,pod?'POD':'待核验','SUCCESS','CLOSED',
    whppStaleDate+'T08:00:00','','','WHPP',JSON.stringify({shipmentCode:code,currentState:state}));
  insertCurrent.run(code,'WHPP',whppStaleDate,state,'SUCCESS',whppStaleDate+'T08:00:00',JSON.stringify({shipmentCode:code,currentState:state}));
  insertScan.run('WHPP',code,whppStaleDate,pod?1:0,pod?'85':'OPEN',JSON.stringify({shipmentCode:code,orderStatus:pod?'85':'OPEN'}));
}
const incompleteLegacy=persistentWhppCompletionTruth(db,whppStaleDate);
assert.equal(incompleteLegacy.sourceCount,0);
assert.equal(incompleteLegacy.canonicalTotal,4);
assert.equal(incompleteLegacy.terminalEvidenceCoverage.scanRows,4);
assert.equal(incompleteLegacy.terminalEvidenceCoverage.finalRows,4);
assert.equal(incompleteLegacy.terminalEvidenceCoverage.podRows,2);
assert.equal(incompleteLegacy.terminalEvidenceCoverage.returnedRows,0);
assert.equal(incompleteLegacy.terminalEvidenceCoverage.unverifiedRows,2);
assert.equal(incompleteLegacy.locked,true,'4/4 scanned and finalized proves processing completion');\nassert.equal(incompleteLegacy.processingEvidenceVerified,true);\nassert.equal(incompleteLegacy.terminalEvidenceVerified,false,'2/4 POD/return terminal statuses must remain open');
assert.equal(incompleteLegacy.reason,'PERSISTED_WHPP_COMPLETED');
assert.deepEqual(incompleteLegacy.terminalEvidenceGaps.map(row=>row.shipmentCode),['WST3','WST4']);

// Updating exact two statuses in local evidence (never inventing a status)
// must restore verified legacy completion without reimporting the daily report.
for(const code of ['WST3','WST4']){
  db.prepare("UPDATE business_final_rows SET primaryCategory='退回',rawJson=? WHERE businessType='WHPP' AND reportDate=? AND shipmentCode=?")
    .run(JSON.stringify({shipmentCode:code,currentState:'RETURN_COMPLETED'}),whppStaleDate,code);
  db.prepare("UPDATE shipment_current_state SET state='RETURN_COMPLETED',stateJson=? WHERE businessType='WHPP' AND reportDate=? AND shipmentCode=?")
    .run(JSON.stringify({shipmentCode:code,currentState:'RETURN_COMPLETED'}),whppStaleDate,code);
}
const completeLegacy=persistentWhppCompletionTruth(db,whppStaleDate);
assert.equal(completeLegacy.terminalEvidenceVerified,true);
assert.equal(completeLegacy.locked,true);
assert.equal(completeLegacy.terminalEvidenceGaps.length,0);
assert.equal(completeLegacy.terminalEvidenceCoverage.returnedRows,2);

console.log('[V764/V757/V754/V751] July-04 WHPP 4/4 scan/final complete while two customer statuses remain explicitly unclosed; trusted later terminal facts close gaps; older V757 child and VN/CN proof retained');
