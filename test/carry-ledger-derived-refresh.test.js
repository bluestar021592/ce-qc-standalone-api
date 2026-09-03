import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ensureV246TrackingSchema } from '../src/v246TrackingLedgerCore.js';
import { syncCarryRowsToV246Ledger } from '../src/carryLedgerSync.js';

const NOW='2026-09-03T00:00:00Z';

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE carryover_open_items(
      shipmentCode TEXT PRIMARY KEY,businessType TEXT,sourceReportDate TEXT,lastReportDate TEXT,
      sourceSnapshotId TEXT,lastSnapshotId TEXT,status TEXT,apiStatus TEXT,closeReason TEXT,stateJson TEXT,createdAt TEXT,updatedAt TEXT
    );
    CREATE TABLE shipment_current_state(
      shipmentCode TEXT PRIMARY KEY,businessType TEXT,reportDate TEXT,snapshotId TEXT,state TEXT,
      apiStatus TEXT,lastEventTime TEXT,stateJson TEXT,updatedAt TEXT
    );
    CREATE TABLE final_rows(
      shipmentCode TEXT,reportDate TEXT,isPod INTEGER,category TEXT,qcConclusion TEXT,lastEventTime TEXT,primaryCategory TEXT,rawJson TEXT,
      pendingDays INTEGER,ocDays INTEGER,cycleCountDays INTEGER,assignDays INTEGER,deliveringDays INTEGER,
      shopRetentionNaturalDays INTEGER,shopState TEXT,shopStateReason TEXT,updatedAt TEXT,
      PRIMARY KEY(shipmentCode,reportDate)
    );
    CREATE TABLE business_final_rows(
      businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER,primaryCategory TEXT,currentMainCategory TEXT,apiStatus TEXT,carryStatus TEXT,
      latestEventTime TEXT,latestEventDesc TEXT,rawJson TEXT,shopRetentionNaturalDays INTEGER,shopState TEXT,shopStateReason TEXT,
      currentAttemptNo INTEGER,podAttemptNo INTEGER,attemptStatus TEXT,updatedAt TEXT,
      PRIMARY KEY(businessType,shipmentCode,reportDate)
    );
  `);
  ensureV246TrackingSchema(db);
  return db;
}
function insertCarry(db,bill,type,sourceDate,lastDate,payload,status='OPEN',closeReason=''){
  db.prepare('INSERT INTO carryover_open_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(bill,type,sourceDate,lastDate,'S1','S2',status,'SUCCESS',closeReason,JSON.stringify(payload),NOW,NOW);
}
function insertCurrent(db,bill,type,date,state,payload){
  db.prepare('INSERT INTO shipment_current_state VALUES(?,?,?,?,?,?,?,?,?)')
    .run(bill,type,date,'S2',state,'SUCCESS',payload.latestEventTime||'',JSON.stringify(payload),NOW);
}
function insertLedger(db,{bill,type,terminalReason='POD',attemptNo=0,attemptSource='',podDate='2026-08-02'}){
  db.prepare(`INSERT INTO qc_tracking_ledger(
    shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,
    currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    bill,type,'2026-08-01','2026-08-02','S1','S2','TERMINAL',terminalReason,NOW,
    terminalReason==='POD'?'POD':'RETURNED',terminalReason==='POD'?'POD':'退回','',podDate,attemptNo,attemptSource,2,'{}','{}',NOW,'fixture',NOW,NOW
  );
}

test('multi-day carry POD rewrites every legacy CCSL mirror date before synchronous derived refresh',()=>{
  const db=fixture();
  const oldHook=globalThis.__CE_QC_REFRESH_LEDGER_DERIVED_DASHBOARDS__;
  try{
    const bill='CE-MULTIDAY-POD';
    const stale={shipmentCode:bill,businessType:'CE',currentState:'OPEN',primaryCategory:'OC',OC天数:3,Pending天数:3,退回状态:'已退回'};
    insertCarry(db,bill,'CE','2026-08-01','2026-08-04',stale);
    insertCurrent(db,bill,'CE','2026-08-04','POD',{...stale,currentState:'POD',是否POD:'是',latestTrackStatusCode:'80',latestEventTime:'2026-08-04T08:30:00Z'});
    const insert=db.prepare('INSERT INTO final_rows VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for(const date of ['2026-08-01','2026-08-02','2026-08-03']) insert.run(bill,date,0,'OC','OC','', 'OC',JSON.stringify(stale),3,3,2,1,2,3,'SHOP_ARRIVED_CURRENT','OLD',NOW);
    let hookCall=null;
    globalThis.__CE_QC_REFRESH_LEDGER_DERIVED_DASHBOARDS__=(dates,reason)=>{
      const ledger=db.prepare('SELECT terminalReason,currentState,currentCategory FROM qc_tracking_ledger WHERE shipmentCode=?').get(bill);
      const mirror=db.prepare('SELECT isPod,primaryCategory,pendingDays,ocDays,shopState,rawJson FROM final_rows WHERE shipmentCode=? AND reportDate=?').get(bill,'2026-08-02');
      hookCall={dates:[...dates],reason,ledger:{...ledger},mirror:{...mirror}};
      return {ok:true,dates};
    };
    const result=syncCarryRowsToV246Ledger([{...stale,currentState:'POD',是否POD:'是',latestTrackStatusCode:'80',latestEventTime:'2026-08-04T08:30:00Z'}],{db,reason:'TEST_DERIVED_REFRESH'});
    assert.equal(result.changed,1);
    assert.ok(result.mirrorChanged>=3);
    assert.deepEqual(result.affectedDates,['2026-08-01','2026-08-02','2026-08-03','2026-08-04']);
    assert.deepEqual(hookCall.dates,['2026-08-01','2026-08-02','2026-08-03','2026-08-04']);
    assert.equal(hookCall.ledger.terminalReason,'POD');
    assert.equal(hookCall.ledger.currentState,'POD');
    assert.equal(hookCall.mirror.isPod,1);
    assert.equal(hookCall.mirror.primaryCategory,'POD');
    assert.equal(hookCall.mirror.pendingDays,0);
    assert.equal(hookCall.mirror.ocDays,0);
    assert.equal(hookCall.mirror.shopState,'CLOSED');
    const payload=JSON.parse(hookCall.mirror.rawJson);
    assert.equal(payload.是否POD,'是');
    assert.equal(payload.退回状态,'','POD authority must remove stale returned noise from legacy mirror JSON');
    for(const row of db.prepare('SELECT reportDate,isPod,primaryCategory,pendingDays,ocDays FROM final_rows WHERE shipmentCode=? ORDER BY reportDate').all(bill)){
      assert.equal(row.isPod,1);assert.equal(row.primaryCategory,'POD');assert.equal(row.pendingDays,0);assert.equal(row.ocDays,0);
    }
  }finally{
    if(oldHook===undefined) delete globalThis.__CE_QC_REFRESH_LEDGER_DERIVED_DASHBOARDS__; else globalThis.__CE_QC_REFRESH_LEDGER_DERIVED_DASHBOARDS__=oldHook;
    db.close();
  }
});

test('strict Shopee attempt evidence is mirrored into all business_final_rows without downgrade',()=>{
  const db=fixture();
  const oldHook=globalThis.__CE_QC_REFRESH_LEDGER_DERIVED_DASHBOARDS__;
  try{
    const bill='SPE-STRICT-MIRROR';
    const row={shipmentCode:bill,businessType:'SHOPEEVN',currentState:'POD',是否POD:'是',POD时间:'2026-08-02T09:00:00Z',podAttemptNo:1,currentAttemptNo:1,primaryCategory:'POD'};
    insertCarry(db,bill,'SHOPEEVN','2026-08-01','2026-08-02',row);
    insertCurrent(db,bill,'SHOPEEVN','2026-08-02','POD',row);
    insertLedger(db,{bill,type:'SHOPEEVN',attemptNo:2,attemptSource:'V246_STRICT_TRACK:START_FAILURE_CYCLE'});
    const insert=db.prepare('INSERT INTO business_final_rows VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for(const date of ['2026-08-01','2026-08-02']) insert.run('SHOPEE',bill,date,0,'退回','退回','SUCCESS','OPEN','','','{}',2,'SHOP_ARRIVED_CURRENT','OLD',1,1,'OLD',NOW);
    globalThis.__CE_QC_REFRESH_LEDGER_DERIVED_DASHBOARDS__=()=>({ok:true});
    syncCarryRowsToV246Ledger([row],{db,reason:'TEST_STRICT_MIRROR'});
    for(const item of db.prepare("SELECT reportDate,isPod,primaryCategory,currentMainCategory,carryStatus,currentAttemptNo,podAttemptNo,attemptStatus,rawJson FROM business_final_rows WHERE businessType='SHOPEE' AND shipmentCode=? ORDER BY reportDate").all(bill)){
      assert.equal(item.isPod,1);
      assert.equal(item.primaryCategory,'POD');
      assert.equal(item.currentMainCategory,'POD');
      assert.equal(item.carryStatus,'CLOSED');
      assert.equal(item.currentAttemptNo,2);
      assert.equal(item.podAttemptNo,2);
      assert.equal(item.attemptStatus,'V246_STRICT_TRACK:START_FAILURE_CYCLE');
      const payload=JSON.parse(item.rawJson);
      assert.equal(payload.podAttemptNo,2);
    }
  }finally{
    if(oldHook===undefined) delete globalThis.__CE_QC_REFRESH_LEDGER_DERIVED_DASHBOARDS__; else globalThis.__CE_QC_REFRESH_LEDGER_DERIVED_DASHBOARDS__=oldHook;
    db.close();
  }
});

test('range dashboard facade exposes synchronous ledger-derived cache and WHPP summary refresh hook',()=>{
  const source=fs.readFileSync(new URL('../src/rangeDashboardStore.js',import.meta.url),'utf8');
  assert.match(source,/V419_LEDGER_DERIVED_DASHBOARD_REFRESH_ID/);
  assert.match(source,/refreshDashboardCacheDate\(date, \{ force: true \}\)/,'affected date cache must rebuild synchronously from committed mirror facts');
  assert.match(source,/readV284DailyFacts\(reportDate, reportDate, db\)/,'WHPP summary must be rebuilt from V284\/V246 truth');
  assert.match(source,/globalThis\.__CE_QC_REFRESH_LEDGER_DERIVED_DASHBOARDS__ = refreshLedgerDerivedDashboardDates/);
});
