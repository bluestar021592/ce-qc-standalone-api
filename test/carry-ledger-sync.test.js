import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureV246TrackingSchema } from '../src/v246TrackingLedgerCore.js';
import { syncCarryRowsToV246Ledger } from '../src/carryLedgerSync.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE carryover_open_items(
      shipmentCode TEXT PRIMARY KEY,businessType TEXT,sourceReportDate TEXT,lastReportDate TEXT,
      sourceSnapshotId TEXT,lastSnapshotId TEXT,status TEXT,apiStatus TEXT,closeReason TEXT,stateJson TEXT,createdAt TEXT,updatedAt TEXT
    );
    CREATE TABLE shipment_current_state(
      shipmentCode TEXT PRIMARY KEY,businessType TEXT,reportDate TEXT,snapshotId TEXT,state TEXT,
      apiStatus TEXT,lastEventTime TEXT,stateJson TEXT,updatedAt TEXT
    );
  `);
  ensureV246TrackingSchema(db);
  return db;
}

const NOW='2026-09-03T00:00:00Z';
function insertCarry(db,bill,type,sourceDate,lastDate,payload,{status='OPEN',closeReason=''}={}) {
  db.prepare(`INSERT INTO carryover_open_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(bill,type,sourceDate,lastDate,'S1','S2',status,'SUCCESS',closeReason,JSON.stringify(payload),NOW,NOW);
}
function insertCurrent(db,bill,type,date,state,payload) {
  db.prepare(`INSERT INTO shipment_current_state VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(bill,type,date,'S2',state,'SUCCESS',payload.latestEventTime||'',JSON.stringify(payload),NOW);
}
function insertLedger(db,{bill,type,trackingStatus='TERMINAL',terminalReason='POD',state='POD',podDate='',attemptNo=0,attemptSource=''}) {
  db.prepare(`INSERT INTO qc_tracking_ledger(
    shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,
    currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    bill,type,'2026-08-01','2026-08-02','S1','S2',trackingStatus,terminalReason,NOW,state,state,'',podDate,attemptNo,attemptSource,
    podDate?2:null,'{}','{}',NOW,'fixture',NOW,NOW
  );
}

test('next-day POD updates carry/current/V246 ledger immediately while preserving source day', () => {
  const db=fixture();
  try {
    const row={shipmentCode:'WHPP-NEXTDAY-POD',businessType:'WHPP',currentState:'POD',是否POD:'是',latestTrackStatusCode:'80',latestEventTime:'2026-08-02T08:30:00Z',primaryCategory:'POD'};
    insertCarry(db,row.shipmentCode,'WHPP','2026-08-01','2026-08-02',{currentState:'OPEN'});
    insertCurrent(db,row.shipmentCode,'WHPP','2026-08-02','POD',row);
    const result=syncCarryRowsToV246Ledger([row],{db,reason:'TEST_NEXTDAY_POD'});
    const ledger=db.prepare('SELECT * FROM qc_tracking_ledger WHERE shipmentCode=?').get(row.shipmentCode);
    assert.equal(result.processed,1);
    assert.equal(ledger.trackingStatus,'TERMINAL');
    assert.equal(ledger.terminalReason,'POD');
    assert.equal(ledger.firstReportDate,'2026-08-01');
    assert.equal(ledger.lastImportedDate,'2026-08-02');
    assert.equal(ledger.podDate,'2026-08-02');
    assert.equal(db.prepare('SELECT status FROM carryover_open_items WHERE shipmentCode=?').get(row.shipmentCode).status,'CLOSED');
  } finally { db.close(); }
});

test('explicit return-in-progress reopens stale legacy RETURNED closure', () => {
  const db=fixture();
  try {
    const row={shipmentCode:'SPE-RETURN-PROGRESS',businessType:'SHOPEECN',currentState:'RETURN_IN_PROGRESS',退回状态:'退回处理中',primaryCategory:'退回处理中',latestTrackStatusCode:'84'};
    insertCarry(db,row.shipmentCode,'SHOPEECN','2026-08-01','2026-08-02',row,{status:'CLOSED',closeReason:'RETURNED'});
    insertCurrent(db,row.shipmentCode,'SHOPEECN','2026-08-02','RETURNED',row);
    insertLedger(db,{bill:row.shipmentCode,type:'SHOPEECN',terminalReason:'RETURNED',state:'RETURNED'});
    const result=syncCarryRowsToV246Ledger([row],{db,reason:'TEST_RETURN_PROGRESS'});
    assert.equal(result.reopened,1);
    assert.equal(db.prepare('SELECT status FROM carryover_open_items WHERE shipmentCode=?').get(row.shipmentCode).status,'OPEN');
    assert.equal(db.prepare('SELECT state FROM shipment_current_state WHERE shipmentCode=?').get(row.shipmentCode).state,'RETURN_IN_PROGRESS');
    const ledger=db.prepare('SELECT trackingStatus,terminalReason,currentState FROM qc_tracking_ledger WHERE shipmentCode=?').get(row.shipmentCode);
    assert.deepEqual(ledger,{trackingStatus:'OPEN',terminalReason:'',currentState:'RETURN_IN_PROGRESS'});
  } finally { db.close(); }
});

test('strict Shopee attempt evidence and POD locks remain immutable across later carry refresh', () => {
  const db=fixture();
  try {
    const strict={shipmentCode:'SPE-STRICT',businessType:'SHOPEEVN',currentState:'POD',是否POD:'是',POD时间:'2026-08-03T10:00:00Z',podAttemptNo:1};
    insertCarry(db,strict.shipmentCode,'SHOPEEVN','2026-08-01','2026-08-03',strict);
    insertCurrent(db,strict.shipmentCode,'SHOPEEVN','2026-08-03','POD',strict);
    insertLedger(db,{bill:strict.shipmentCode,type:'SHOPEEVN',terminalReason:'POD',state:'POD',podDate:'2026-08-02',attemptNo:2,attemptSource:'V246_STRICT_TRACK:START_FAILURE_CYCLE'});
    syncCarryRowsToV246Ledger([strict],{db,reason:'TEST_STRICT'});
    const strictLedger=db.prepare('SELECT attemptNo,attemptSource,podDate FROM qc_tracking_ledger WHERE shipmentCode=?').get(strict.shipmentCode);
    assert.equal(strictLedger.attemptNo,2);
    assert.equal(strictLedger.attemptSource,'V246_STRICT_TRACK:START_FAILURE_CYCLE');
    assert.equal(strictLedger.podDate,'2026-08-02');

    const locked={shipmentCode:'CE-POD-LOCK',businessType:'CE',currentState:'OPEN',primaryCategory:'正常运输中'};
    insertCarry(db,locked.shipmentCode,'CE','2026-08-01','2026-08-03',locked);
    insertCurrent(db,locked.shipmentCode,'CE','2026-08-03','OPEN',locked);
    insertLedger(db,{bill:locked.shipmentCode,type:'CE',terminalReason:'POD',state:'POD',podDate:'2026-08-02'});
    syncCarryRowsToV246Ledger([locked],{db,reason:'TEST_POD_LOCK'});
    assert.equal(db.prepare('SELECT terminalReason FROM qc_tracking_ledger WHERE shipmentCode=?').get(locked.shipmentCode).terminalReason,'POD');
    assert.equal(db.prepare('SELECT state FROM shipment_current_state WHERE shipmentCode=?').get(locked.shipmentCode).state,'POD');
    assert.equal(db.prepare('SELECT status FROM carryover_open_items WHERE shipmentCode=?').get(locked.shipmentCode).status,'CLOSED');
  } finally { db.close(); }
});

test('transaction-aware mode never commits outside caller transaction', () => {
  const db=fixture();
  try {
    const row={shipmentCode:'ALI-ATOMIC',businessType:'ALI1688',currentState:'POD',是否POD:'是',POD时间:'2026-08-04T01:00:00Z'};
    insertCarry(db,row.shipmentCode,'ALI1688','2026-08-01','2026-08-04',row);
    insertCurrent(db,row.shipmentCode,'ALI1688','2026-08-04','POD',row);
    db.exec('BEGIN IMMEDIATE');
    syncCarryRowsToV246Ledger([row],{db,reason:'TEST_OUTER_TX',manageTransaction:false,invalidateCaches:false});
    assert.equal(db.prepare('SELECT terminalReason FROM qc_tracking_ledger WHERE shipmentCode=?').get(row.shipmentCode).terminalReason,'POD');
    db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT 1 ok FROM qc_tracking_ledger WHERE shipmentCode=?').get(row.shipmentCode),undefined);
    assert.equal(db.prepare('SELECT status FROM carryover_open_items WHERE shipmentCode=?').get(row.shipmentCode).status,'OPEN');
  } finally { db.close(); }
});
