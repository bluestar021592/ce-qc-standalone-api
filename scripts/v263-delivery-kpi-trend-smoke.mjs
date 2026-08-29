import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
process.env.NODE_ENV='test';
const {readV263DeliveryKpiTrends,V263_DELIVERY_KPI_TREND_ID}=await import('../src/v263DeliveryKpiTrendPatch.js');
const {applyV264TbkhOpenEvidence,v264ShouldTrackTbkhOpen,V264_TBKH_OPEN_ATTEMPT_ID}=await import('../src/v264TbkhOpenAttemptLifecycle.js');
const {ensureV246TrackingSchema}=await import('../src/v246TrackingLedgerCore.js');
const {writeV329ThreeBusinessDailyCache}=await import('../src/v329ThreeBusinessDailyCache.js');

const db=new DatabaseSync(':memory:');
ensureV246TrackingSchema(db);

// V263 reads V284 latest-VALID daily membership/status truth, while signing averages
// are overlaid from V329 real START->POD cache before V294 completeness publication.
db.exec(`
  CREATE TABLE unified_import_batches(
    batchId INTEGER PRIMARY KEY AUTOINCREMENT,
    reportDate TEXT NOT NULL,
    snapshotId TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    status TEXT NOT NULL
  );
  CREATE TABLE unified_import_rows(
    snapshotId TEXT NOT NULL,
    reportDate TEXT NOT NULL,
    businessType TEXT NOT NULL,
    shipmentCode TEXT NOT NULL,
    regionCode TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE final_rows(
    shipmentCode TEXT,reportDate TEXT,isPod INTEGER DEFAULT 0,rawJson TEXT DEFAULT '{}',
    primaryCategory TEXT DEFAULT '',category TEXT DEFAULT '',lastEventTime TEXT DEFAULT '',
    pendingDays INTEGER DEFAULT 0,ocDays INTEGER DEFAULT 0,cycleCountDays INTEGER DEFAULT 0,
    shopState TEXT DEFAULT '',shopRetentionNaturalDays INTEGER DEFAULT 0
  );
  CREATE TABLE business_final_rows(
    businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER DEFAULT 0,rawJson TEXT DEFAULT '{}',
    currentMainCategory TEXT DEFAULT '',primaryCategory TEXT DEFAULT '',latestEventTime TEXT DEFAULT '',
    podAttemptNo INTEGER DEFAULT 0,currentAttemptNo INTEGER DEFAULT 0,
    shopState TEXT DEFAULT '',shopRetentionNaturalDays INTEGER DEFAULT 0
  );
  CREATE TABLE business_daily_parse_rows(
    businessType TEXT,reportDate TEXT,shipmentCode TEXT
  );
`);
const batch=db.prepare(`INSERT INTO unified_import_batches(reportDate,snapshotId,createdAt,status) VALUES(?,?,?,'VALID')`);
const member=db.prepare(`INSERT INTO unified_import_rows(snapshotId,reportDate,businessType,shipmentCode,regionCode) VALUES(?,?,?,?,?)`);
for(const [date,snapshot,bills] of [
  ['2026-08-20','S20',['T20-1','T20-2','T20-3','T20-4']],
  ['2026-08-21','S21',['T21-1','T21-2','T21-3','T21-4']]
]){
  batch.run(date,snapshot,`${date}T01:00:00.000Z`);
  for(const bill of bills)member.run(snapshot,date,'TBKH',bill,'PP');
}

const now='2026-08-23T00:00:00.000Z';
const ins=db.prepare(`INSERT INTO qc_tracking_ledger(
 shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt
) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
function add(bill,date,{attempt=0,days=null,pod=true,oc=false}={}){
 ins.run(bill,'TBKH',date,date,'S','S',pod?'TERMINAL':'OPEN',pod?'POD':'',pod?now:'',pod?'POD':(oc?'OC':'OPEN'),oc?'OC':'',now,pod?date:'',attempt,attempt?`V246_STRICT_TRACK:test`:'',days,'{}','{}',now,'TEST',now,now);
}
// Legacy lifecycle signingDays deliberately differ from the strict V329 signing cache below.
add('T20-1','2026-08-20',{attempt:1,days:1});add('T20-2','2026-08-20',{attempt:2,days:2});add('T20-3','2026-08-20',{attempt:0,days:1});add('T20-4','2026-08-20',{pod:false,oc:true});
add('T21-1','2026-08-21',{attempt:1,days:1});add('T21-2','2026-08-21',{attempt:1,days:1});add('T21-3','2026-08-21',{attempt:2,days:2});add('T21-4','2026-08-21',{attempt:3,days:3});

writeV329ThreeBusinessDailyCache('TBKH',[
  {reportDate:'2026-08-20',total:4,pod:3,ocCurrent:1,attempt1:1,attempt2:1,attempt3:0,signingDaysSum:5,signingDaysCount:3,ready:true},
  {reportDate:'2026-08-21',total:4,pod:4,ocCurrent:0,attempt1:2,attempt2:1,attempt3:1,signingDaysSum:6,signingDaysCount:4,ready:true}
],db,'V263_STRICT_START_POD_SMOKE');

assert.match(V264_TBKH_OPEN_ATTEMPT_ID,/v264-tbkh-open-attempt-lifecycle/);
assert.equal(v264ShouldTrackTbkhOpen({businessType:'TBKH',trackingStatus:'OPEN'}),true,'TBKH OPEN must enter continuous attempt tracking');
assert.equal(v264ShouldTrackTbkhOpen({businessType:'CE',trackingStatus:'OPEN'}),false,'CE must not enter the three-board attempt mechanism');
const openApplied=applyV264TbkhOpenEvidence([{shipmentCode:'T20-4',attemptNo:2,source:'TEST_70_PENDING_70',startMode:'70',starts:['2026-08-20','2026-08-21'],failures:['2026-08-20']}],{db,reason:'SMOKE'});
assert.equal(openApplied.updated,1);assert.equal(openApplied.known,1);
const openRow=db.prepare("SELECT attemptNo,attemptSource,trackingStatus FROM qc_tracking_ledger WHERE shipmentCode='T20-4'").get();
assert.equal(openRow.attemptNo,2,'TBKH must update current attempt before POD');
assert.match(openRow.attemptSource,/^V246_STRICT_TRACK:V264_TBKH_OPEN:/,'TBKH OPEN attempt must be persisted as strict evidence');
assert.equal(openRow.trackingStatus,'OPEN','attempt tracking must not falsely close the shipment');

const data=readV263DeliveryKpiTrends('TBKH','2026-08-20','2026-08-21',db);
assert.equal(data.id,V263_DELIVERY_KPI_TREND_ID);
assert.deepEqual(data.dates,['2026-08-20','2026-08-21']);
assert.equal(data.daily[0].total,4);assert.equal(data.daily[0].pod,3);assert.equal(data.daily[0].oc,1);
assert.equal(data.daily[0].attempt1,null,'incomplete POD attempt evidence must not publish partial attempt-1 count');
assert.equal(data.daily[0].attempt2,null,'incomplete POD attempt evidence must not publish partial attempt-2 count');
assert.equal(data.daily[0].attempt3,null,'incomplete POD attempt evidence must not publish partial attempt-3 count');
assert.equal(data.daily[0].attempt1Known,1);assert.equal(data.daily[0].attempt2Known,1);assert.equal(data.daily[0].attempt3Known,0);
assert.equal(data.daily[0].attemptUnknown,1,'OPEN current attempt must not be counted as POD attempt success');
assert.equal(data.daily[0].attemptCoverageRate,66.67);assert.equal(data.daily[0].attemptEvidenceComplete,false);
assert.equal(data.daily[0].avgSigningDays,1.67,'V263 must use strict V329 START-to-POD samples, not legacy lifecycle signingDays');assert.equal(data.daily[0].signingCoverageRate,100);assert.equal(data.daily[0].signingEvidenceComplete,true);
assert.equal(data.daily[1].attempt1,2);assert.equal(data.daily[1].attempt2,1);assert.equal(data.daily[1].attempt3,1);assert.equal(data.daily[1].attemptUnknown,0);assert.equal(data.daily[1].attemptCoverageRate,100);assert.equal(data.daily[1].avgSigningDays,1.5,'second day must also publish strict V329 START-to-POD average');
assert.equal(data.daily[0].strictSigningTruth,'V329_REAL_START_TO_POD_CACHE');
assert.equal(data.evidenceIncomplete,true,'range must disclose any incomplete attempt/signing day');
assert.match(data.definitions.signingDays,/真实首次派送START日期到真实POD日期/);
assert.throws(()=>readV263DeliveryKpiTrends('CE','2026-08-21','2026-08-21',db),/仅支持TBKH、SHOPEECN、SHOPEEVN/);

db.close();
console.log('[V295.3/V264/V263] latest-VALID membership + TBKH OPEN strict attempt lifecycle + V329 START-to-POD signing + complete-POD publication gate + exact three-business scope passed');
