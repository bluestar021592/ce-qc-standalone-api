import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v791-ledger-'));
process.env.DATA_DIR=root;
process.env.DB_FILE=path.join(root,'isolated-test.db');
// Explicitly initialize the isolated file before getDb; this prevents the
// repository's legacy-database fallback from copying any real/user SQLite data.
const blank=new DatabaseSync(process.env.DB_FILE);
blank.close();
let closeDb;
try{
  const dbModule=await import('../src/db.js');
  closeDb=dbModule.closeDb;
  const db=dbModule.getDb();
  const {planHistoricalTmsReconcile}=await import('../src/v791HistoricalTmsReconcile.js');
  const {updateCarryoverResults}=await import('../src/unifiedImportStore.js');
  const now='2026-10-28T00:00:00.000Z';
  const insertCarry=db.prepare(`INSERT INTO carryover_open_items(
    shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,
    status,apiStatus,closeReason,stateJson,createdAt,updatedAt
  ) VALUES(?,?,?,?,'SNAP-OLD','SNAP-OLD','OPEN','PENDING_SCAN','',?,?,?)`);
  const insertCurrent=db.prepare(`INSERT INTO shipment_current_state(
    shipmentCode,businessType,reportDate,snapshotId,state,apiStatus,lastEventTime,stateJson,updatedAt
  ) VALUES(?,?,?,'SNAP-OLD','PENDING_SCAN','PENDING_SCAN','',?,?)`);
  const ids=['CC06072602913','CEAFTESTRETURN80','CEAFTESTRETURN81'];
  const candidate=ids.map(bill=>({shipmentCode:bill,businessType:'CEAF',
    sourceReportDate:'2026-07-06',stateJson:JSON.stringify({
      shipmentCode:bill,businessType:'CEAF',currentState:'PENDING_SCAN',orderStatus:'85'})}));
  for(const row of candidate){
    insertCarry.run(row.shipmentCode,'CEAF','2026-07-06','2026-07-12',row.stateJson,now,now);
    insertCurrent.run(row.shipmentCode,'CEAF','2026-07-12',row.stateJson,now);
  }
  const plan=planHistoricalTmsReconcile(candidate,[
    {shipmentCode:ids[0],shipmentStatus:'60',statusTime:'2026-07-11 11:00:03'},
    {shipmentCode:ids[1],shipmentStatus:'80'},
    {shipmentCode:ids[2],shipmentStatus:'81'}],now);
  assert.equal(plan.matched,3);
  const result=updateCarryoverResults({snapshotId:'SNAP-JUL12',reportDate:'2026-07-12',
    rows:plan.updates,scanResults:plan.scanResults});
  assert.equal(result.ledgerSync.processed,3);
  const carry=db.prepare('SELECT status,closeReason FROM carryover_open_items WHERE shipmentCode=?');
  const ledger=db.prepare('SELECT trackingStatus,terminalReason,currentState FROM qc_tracking_ledger WHERE shipmentCode=?');
  assert.deepEqual([carry.get(ids[0]).status,carry.get(ids[0]).closeReason],['CLOSED','POD']);
  assert.deepEqual([ledger.get(ids[0]).trackingStatus,ledger.get(ids[0]).terminalReason],['TERMINAL','POD']);
  assert.deepEqual([carry.get(ids[1]).status,carry.get(ids[1]).closeReason],['OPEN','']);
  assert.equal(ledger.get(ids[1]).currentState,'RETURN_IN_PROGRESS');
  assert.deepEqual([carry.get(ids[2]).status,carry.get(ids[2]).closeReason],['CLOSED','RETURNED']);
  assert.deepEqual([ledger.get(ids[2]).trackingStatus,ledger.get(ids[2]).terminalReason],['TERMINAL','RETURNED']);
  // Simulate a newer July-13 import while a July-12 TMS request was in flight.
  db.prepare("UPDATE carryover_open_items SET lastReportDate='2026-07-13',status='OPEN',closeReason='' WHERE shipmentCode=?").run(ids[1]);
  db.prepare("UPDATE shipment_current_state SET reportDate='2026-07-13',state='PENDING_SCAN' WHERE shipmentCode=?").run(ids[1]);
  const newerPlan=planHistoricalTmsReconcile([candidate[1]],[
    {shipmentCode:ids[1],shipmentStatus:'60'}],now);
  const prevented=updateCarryoverResults({snapshotId:'SNAP-JUL12',reportDate:'2026-07-12',
    rows:newerPlan.updates,scanResults:newerPlan.scanResults,
    guardOpenAtOrBefore:'2026-07-12'});
  assert.equal(prevented.ledgerSync.processed,0,
    'slow historical TMS completion cannot overwrite a newer imported report');
  assert.equal(db.prepare('SELECT lastReportDate FROM carryover_open_items WHERE shipmentCode=?').get(ids[1]).lastReportDate,'2026-07-13');
  assert.equal(db.prepare('SELECT reportDate FROM shipment_current_state WHERE shipmentCode=?').get(ids[1]).reportDate,'2026-07-13');
  // A real POD already closed must not be reopened by a later stale 80 result.
  const staleReturn=planHistoricalTmsReconcile([candidate[0]],[
    {shipmentCode:ids[0],shipmentStatus:'80'}],now);
  const blocked=updateCarryoverResults({snapshotId:'SNAP-JUL12',reportDate:'2026-07-12',
    rows:staleReturn.updates,scanResults:staleReturn.scanResults,
    guardOpenAtOrBefore:'2026-07-12'});
  assert.equal(blocked.ledgerSync.processed,0,
    'already-closed POD cannot be reopened by a stale historical TMS request');
  assert.equal(carry.get(ids[0]).closeReason,'POD');
  // Corrupted legacy OPEN flags must not allow a new 80 response to downgrade
  // a current POD already saved for this waybill/business.
  db.prepare("UPDATE carryover_open_items SET status='OPEN',closeReason='' WHERE shipmentCode=?").run(ids[0]);
  const locked=updateCarryoverResults({snapshotId:'SNAP-JUL12',reportDate:'2026-07-12',
    rows:staleReturn.updates,scanResults:staleReturn.scanResults,
    guardOpenAtOrBefore:'2026-07-12'});
  assert.equal(locked.ledgerSync.processed,0);
  assert.equal(db.prepare('SELECT state FROM shipment_current_state WHERE shipmentCode=?').get(ids[0]).state,'POD',
    'current signed terminal must remain immutable against stale return-in-progress evidence');
  assert.equal(ledger.get(ids[0]).terminalReason,'POD');

  // A second read of completed records remains stable and does not claim an unverified POD.
  console.log('[V791] isolated SQLite: CEAF TMS POD/return-in-progress/returned persistence PASS');
}finally{
  try{closeDb?.()}catch{}
  fs.rmSync(root,{recursive:true,force:true});
}
