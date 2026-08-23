import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
process.env.NODE_ENV='test';
const {readV263DeliveryKpiTrends,V263_DELIVERY_KPI_TREND_ID}=await import('../src/v263DeliveryKpiTrendPatch.js');

const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE dashboard_daily_cache(
  businessType TEXT NOT NULL, reportDate TEXT NOT NULL, snapshotStatus TEXT NOT NULL, metricsJson TEXT NOT NULL DEFAULT '{}'
);`);
const insertCache=db.prepare(`INSERT INTO dashboard_daily_cache(businessType,reportDate,snapshotStatus,metricsJson) VALUES(?,?,?,?)`);
insertCache.run('TBKH','2026-08-20','COMPLETED',JSON.stringify({total:4,pod:3,ocCurrent:1}));
insertCache.run('TBKH','2026-08-21','COMPLETED',JSON.stringify({total:4,pod:4,ocCurrent:0}));

// The V246 schema is created by the reader. Seed locked lifecycle truth afterwards.
try{readV263DeliveryKpiTrends('TBKH','2026-08-21','2026-08-21',db);}catch{}
const now='2026-08-23T00:00:00.000Z';
const ins=db.prepare(`INSERT INTO qc_tracking_ledger(
 shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt
) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
function add(bill,date,{attempt=0,days=null,pod=true,oc=false}={}){
 ins.run(bill,'TBKH',date,date,'S','S',pod?'TERMINAL':'OPEN',pod?'POD':'',pod?now:'',pod?'POD':(oc?'OC':'OPEN'),oc?'OC':'',now,pod?date:'',attempt,attempt?`V246_STRICT_TRACK:test`:'',days,'{}','{}',now,'TEST',now,now);
}
add('T20-1','2026-08-20',{attempt:1,days:1});add('T20-2','2026-08-20',{attempt:2,days:2});add('T20-3','2026-08-20',{attempt:0,days:1});add('T20-4','2026-08-20',{pod:false,oc:true});
add('T21-1','2026-08-21',{attempt:1,days:1});add('T21-2','2026-08-21',{attempt:1,days:1});add('T21-3','2026-08-21',{attempt:2,days:2});add('T21-4','2026-08-21',{attempt:3,days:3});
const data=readV263DeliveryKpiTrends('TBKH','2026-08-20','2026-08-21',db);
assert.equal(data.id,V263_DELIVERY_KPI_TREND_ID);
assert.deepEqual(data.dates,['2026-08-20','2026-08-21']);
assert.equal(data.daily[0].total,4);assert.equal(data.daily[0].pod,3);assert.equal(data.daily[0].oc,1);
assert.equal(data.daily[0].attempt1,1);assert.equal(data.daily[0].attempt2,1);assert.equal(data.daily[0].attemptUnknown,1);
assert.equal(data.daily[0].attemptCoverageRate,66.67);assert.equal(data.daily[0].avgSigningDays,1.33);assert.equal(data.daily[0].signingCoverageRate,100);
assert.equal(data.daily[1].attempt1,2);assert.equal(data.daily[1].attempt2,1);assert.equal(data.daily[1].attempt3,1);assert.equal(data.daily[1].attemptUnknown,0);assert.equal(data.daily[1].attemptCoverageRate,100);assert.equal(data.daily[1].avgSigningDays,1.75);
assert.throws(()=>readV263DeliveryKpiTrends('CE','2026-08-21','2026-08-21',db),/仅支持TBKH、SHOPEECN、SHOPEEVN/);
console.log('[V263] delivery KPI trend smoke passed: TBKH strict attempts + inclusive signing-day average + exact three-business scope');
