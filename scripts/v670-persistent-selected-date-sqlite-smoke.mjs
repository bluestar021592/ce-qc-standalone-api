import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { persistentSelectedDatePodBills, persistentSelectedDatePodTruth, persistentWhppCompletionTruth } from '../src/selectedDatePersistentTruth.js';

const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE business_final_rows(businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER,recipient_group TEXT,rawJson TEXT);
CREATE TABLE business_daily_reports(businessType TEXT,reportDate TEXT,totalCount INTEGER,summaryJson TEXT,updatedAt TEXT);
CREATE TABLE business_history_summary(businessType TEXT,reportDate TEXT,summaryJson TEXT,updatedAt TEXT);
CREATE TABLE business_export_snapshots(businessType TEXT,reportDate TEXT,snapshotId TEXT,status TEXT,reconciliationStatus TEXT,generatedAt TEXT,createdAt TEXT);
CREATE TABLE unified_import_rows(reportDate TEXT,businessType TEXT,shipmentCode TEXT);
`);

const date='2026-07-01';
const insertSource=db.prepare('INSERT INTO unified_import_rows VALUES(?,?,?)');
const insertFinal=db.prepare('INSERT INTO business_final_rows VALUES(?,?,?,?,?,?)');

for(let i=1;i<=190;i++){
  const bill='W'+String(i).padStart(3,'0');
  insertSource.run(date,'WHPP',bill);
  insertFinal.run('WHPP',bill,date,i<=166?1:0,'WHPP',JSON.stringify({currentState:i<=166?'POD':'RETURN_COMPLETED'}));
}
for(let i=1;i<=588;i++){
  const bill='V'+String(i).padStart(3,'0');
  insertSource.run(date,'SHOPEEVN',bill);
  insertFinal.run('SHOPEE',bill,date,0,'VN',JSON.stringify({recipient_group:'VN',orderStatus:i<=545?'85':'',currentState:i<=545?'POD':'RETURN_COMPLETED'}));
}
insertFinal.run('SHOPEE','OLD-CARRY-POD',date,0,'VN',JSON.stringify({recipient_group:'VN',orderStatus:'85',currentState:'POD'}));
db.prepare('INSERT INTO business_history_summary VALUES(?,?,?,?)')
  .run('WHPP',date,JSON.stringify({total:190,accounting:{total:190,balanced:true}}),'2026-07-01T02:21:00Z');

const completion=persistentWhppCompletionTruth(db,date);
assert.equal(completion.locked,true);
assert.equal(completion.sourceCount,190);
assert.equal(completion.finalCount,190);
assert.equal(completion.completionSource,'FINAL_ROWS_HISTORY');
assert.equal(persistentSelectedDatePodBills(db,'WHPP',date).length,166);
assert.equal(persistentSelectedDatePodBills(db,'SHOPEEVN',date).length,545);
assert.equal(persistentSelectedDatePodBills(db,'SHOPEECN',date).length,0);
insertSource.run(date,'SHOPEECN','ZERO-CN');
insertFinal.run('SHOPEE','ZERO-CN',date,0,'CN',JSON.stringify({recipient_group:'CN',currentState:'RETURN_COMPLETED'}));
const zeroCn=persistentSelectedDatePodTruth(db,'SHOPEECN',date);
assert.equal(zeroCn.authoritative,true);
assert.equal(zeroCn.bills.length,0);

// Restart simulation: no in-memory business state and no export snapshot are needed.
assert.equal(persistentWhppCompletionTruth(db,date).locked,true);

// Same-date re-import changed source membership: stale completion must fail closed.
insertSource.run(date,'WHPP','W191');
assert.equal(persistentWhppCompletionTruth(db,date).locked,false);

console.log('[V672] SQLite restart fixture passed · WHPP 190/166 · VN 588/545 · raw POD semantics · old carry POD excluded · stale same-date reimport fails closed');
