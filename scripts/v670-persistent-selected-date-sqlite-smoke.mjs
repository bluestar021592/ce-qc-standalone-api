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
db.prepare('INSERT INTO unified_import_batches VALUES(?,?,?,?,?)').run('BATCH-OLD','SNAP-OLD',date,'SUPERSEDED','2026-07-01T00:00:00Z');
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
db.prepare(`INSERT INTO business_export_snapshots(
  businessType,reportDate,snapshotId,status,reconciliationStatus,invalidReason,payloadJson,generatedAt,createdAt
) VALUES(?,?,?,?,?,?,?,?,?)`).run(
  'SHOPEE',date,'SHOPEE-SNAP','VALID','COMPLETED','',
  JSON.stringify({snapshotId:'SHOPEE-SNAP',view:{detailTabs:{
    VN_all:{rows:vnAllRows,total:vnAllRows.length},
    VN_pod:{rows:vnPodRows,total:vnPodRows.length},
    byRecipientGroup:{VN:{all:{rows:vnAllRows,total:vnAllRows.length},pod:{rows:vnPodRows,total:vnPodRows.length}}}
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
assert.equal(completion.completionSource,'UNIFIED_COMPLETED');
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
assert.equal(persistentSelectedDatePodBills(db,'SHOPEECN',date).length,0);

// Same date old/superseded source and historical carry rows must not inflate the denominator.
assert.equal(vn.bills.includes('OLD-CARRY-POD'),false);

// Unified COMPLETED is a terminal receipt: even if runtime/final-row-only counters are imperfect,
// selected-date WHPP progress must remain complete.
db.prepare("DELETE FROM business_final_rows WHERE businessType='WHPP' AND reportDate=?").run(date);
const completionAfterLossyFinalRows=persistentWhppCompletionTruth(db,date);
assert.equal(completionAfterLossyFinalRows.locked,true);
assert.equal(completionAfterLossyFinalRows.completionSource,'UNIFIED_COMPLETED');

console.log('[V681] real SQLite truth passed · unified COMPLETED=>WHPP complete · WHPP 190/166 · VN 588/545 recovered from exact completed snapshot even when normalized POD evidence is zero · stale batch/carry excluded');
