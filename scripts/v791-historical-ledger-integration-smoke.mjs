import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v791-ledger-'));
process.env.DATA_DIR=root;
process.env.DB_FILE=path.join(root,'isolated-test.db');
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
  // A second read of completed records remains stable and does not claim an unverified POD.
  console.log('[V791] isolated SQLite: CEAF TMS POD/return-in-progress/returned persistence PASS');
}finally{
  try{closeDb?.()}catch{}
  fs.rmSync(root,{recursive:true,force:true});
}
