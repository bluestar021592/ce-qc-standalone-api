import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v252-life-'));
process.env.DATA_DIR=tempRoot;
process.env.DB_FILE=path.join(tempRoot,'v252-life.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.CE_QC_DISABLE_V246_TRACKING='1';

const runtimeSource=fs.readFileSync('src/v206InteractiveFirstRuntimePatch.js','utf8');
const lifecycleSource=fs.readFileSync('src/v252LifecycleCoordinator.js','utf8');
const carrySource=fs.readFileSync('src/carryoverRefreshScheduler.js','utf8');
const trendSource=fs.readFileSync('src/v244ShopeeTrendRuntimePatch.js','utf8');

assert.match(runtimeSource,/import '\.\/v252LifecycleCoordinator\.js';/,'interactive runtime must activate the V252 lifecycle coordinator before server registration');
assert.match(lifecycleSource,/\/api\/import\/unified-daily-report/,'successful daily import must be intercepted for immediate ledger admission');
assert.match(lifecycleSource,/V252_IMPORT_IMMEDIATE_ADMISSION/,'daily import must immediately lock every admitted shipment into the QC ledger');
assert.match(lifecycleSource,/carry_refresh_last_success_at/,'V252 must observe successful legacy two-hour OPEN refresh completion');
assert.match(lifecycleSource,/V252_AFTER_TWO_HOUR_OPEN_REFRESH/,'two-hour OPEN refresh must immediately trigger ledger\/POD\/attempt synchronization');
assert.match(lifecycleSource,/V252_AFTER_CARRY_STATE_CHANGE/,'manual\/daily processing state changes must also synchronize the lifecycle ledger without waiting two hours');
assert.match(lifecycleSource,/sourceUpdatedAt/,'OPEN attempt evidence must be reconsidered when refreshed state is newer than its last trajectory check');
assert.match(lifecycleSource,/applyV252OpenAttemptEvidence/,'open Shopee parcels must retain a strict current attempt before POD');
assert.match(lifecycleSource,/V252_FINAL_POD_ATTEMPT/,'newly POD Shopee parcels must be finalized with strict full-history attempt evidence');
assert.match(lifecycleSource,/STRICT_MAX_PER_SYNC/,'continuous trajectory enrichment must be bounded and must not flood CE tracking APIs');
assert.match(lifecycleSource,/collectV200Rows/,'post-refresh lifecycle sync must lock actual POD date and signing-day evidence');
assert.match(lifecycleSource,/lightweightLedgerAudit/,'idle anti-leak checks must not repeatedly launch heavy trajectory work');
assert.match(carrySource,/CARRY_REFRESH_INTERVAL_MS = 2 \* 60 \* 60 \* 1000/,'online OPEN parcels must retain the existing two-hour network refresh cadence');
assert.match(carrySource,/WHERE status='OPEN'/,'two-hour scheduler must refresh only non-terminal carryover parcels');
assert.match(trendSource,/includeRegions = options\?\.includeRegions !== false/,'Shopee lifecycle reader must support skipping historical PP\/PV joins');
assert.match(trendSource,/includeRegions\?ledgerRegions/,'PP\/PV SQL must only run when explicitly needed');
assert.match(trendSource,/exact=String\(req\.query\.exact/,'exact-date lightweight reads must be supported');

const {getDb,closeDb}=await import('../src/db.js');
const {ensureV246TrackingSchema,applyV246StrictAttemptEvidence}=await import('../src/v246TrackingLedgerCore.js');
const {V252_LIFECYCLE_TEST_API}=await import('../src/v252LifecycleCoordinator.js');
const db=getDb();ensureV246TrackingSchema(db);
const now='2026-08-23T00:00:00.000Z';
const reportDate='2026-08-21',snapshotId='V252-IMPORT-S1',batchId='V252-IMPORT-B1';
db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)').run(snapshotId,batchId,reportDate,'COMPLETED','{}',now);
db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)').run(batchId,snapshotId,reportDate,'v252-import.xlsx','v252-hash','VALID','{}','[]',now);
const insert=db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
insert.run(batchId,snapshotId,reportDate,'SHOPEECN','CN-V252-LIFE-1','PP','SHOPEECN','SHOPEECN','日报',1,'SMOKE','{}',now);
insert.run(batchId,snapshotId,reportDate,'SHOPEEVN','VN-V252-LIFE-1','PV','SHOPEEVN','SHOPEEVN','日报',2,'SMOKE','{}',now);

const admission=await V252_LIFECYCLE_TEST_API.admitImportedDate(reportDate);
assert.equal(admission.expected,2,'successful daily import must admit both CN/VN shipments immediately');
for(const bill of ['CN-V252-LIFE-1','VN-V252-LIFE-1']){
  const row=db.prepare('SELECT * FROM qc_tracking_ledger WHERE shipmentCode=?').get(bill);
  assert.ok(row,`${bill} must exist in lifecycle ledger immediately after import`);
  assert.equal(row.firstReportDate,reportDate,'first report date must lock on import day');
  assert.equal(row.trackingStatus,'OPEN','fresh non-terminal daily shipment must stay OPEN for future refreshes');
}

const firstClient={trackQuery:async bills=>bills.map(bill=>({shipmentCode:bill,eventCode:'70',eventTime:'2026-08-21 09:00:00',trackingEventDescZh:'开始派送'}))};
const firstStrict=await V252_LIFECYCLE_TEST_API.refreshStrictAttempts({businessType:'ALL',fromDate:'2026-08-21',toDate:'2026-08-21',days:1},firstClient);
assert.equal(firstStrict.open.known,2,'both fresh OPEN Shopee parcels must persist current attempt 1 from real START evidence');
let cn=db.prepare("SELECT * FROM qc_tracking_ledger WHERE shipmentCode='CN-V252-LIFE-1'").get();
assert.equal(Number(cn.attemptNo),1);
assert.match(cn.attemptSource,/^V246_STRICT_TRACK:V252_OPEN:/,'OPEN attempt must be explicitly marked provisional-current, not final POD evidence');

// The next-day state refresh changes only CN. Because carryover updatedAt is newer
// than the last strict-track check, V252 must query this OPEN parcel again and see
// Pending/failure -> new START as the current second attempt before POD exists.
db.prepare("UPDATE carryover_open_items SET updatedAt='2026-08-24T00:00:00.000Z' WHERE shipmentCode='CN-V252-LIFE-1'").run();
const secondClient={trackQuery:async bills=>bills.flatMap(bill=>bill==='CN-V252-LIFE-1'?[
  {shipmentCode:bill,eventCode:'70',eventTime:'2026-08-21 09:00:00',trackingEventDescZh:'开始派送'},
  {shipmentCode:bill,eventCode:'150',eventTime:'2026-08-21 18:00:00',trackingEventDescZh:'Pending 无人接听'},
  {shipmentCode:bill,eventCode:'70',eventTime:'2026-08-22 09:00:00',trackingEventDescZh:'再次开始派送'}
]:[{shipmentCode:bill,eventCode:'70',eventTime:'2026-08-21 09:00:00'}])};
const secondStrict=await V252_LIFECYCLE_TEST_API.refreshStrictAttempts({businessType:'ALL',fromDate:'2026-08-21',toDate:'2026-08-22',days:2},secondClient);
assert.ok(secondStrict.open.changed>=1,'refreshed OPEN state must trigger a new strict trajectory evaluation');
cn=db.prepare("SELECT * FROM qc_tracking_ledger WHERE shipmentCode='CN-V252-LIFE-1'").get();
assert.equal(Number(cn.attemptNo),2,'OPEN parcel must become current attempt 2 after Pending/failure then a new START');

// Now the same next-day lifecycle becomes POD. Final POD evidence must replace the
// provisional OPEN marker, keep attempt 2, and calculate first-report -> POD = 2 days.
db.prepare("UPDATE qc_tracking_ledger SET trackingStatus='TERMINAL',terminalReason='POD',podDate='2026-08-22',signingDays=2 WHERE shipmentCode='CN-V252-LIFE-1'").run();
const finalApplied=applyV246StrictAttemptEvidence([{shipmentCode:'CN-V252-LIFE-1',attemptNo:2,source:'轨迹70严格START/失败循环',podDate:'2026-08-22',startMode:'TRACK_70',starts:[{time:'2026-08-21 09:00:00',code:'70'},{time:'2026-08-22 09:00:00',code:'70'}],failures:[{time:'2026-08-21 18:00:00',code:'150'}]}],{db,reason:'V252_FINAL_SMOKE'});
assert.equal(finalApplied.updated,1);
cn=db.prepare("SELECT * FROM qc_tracking_ledger WHERE shipmentCode='CN-V252-LIFE-1'").get();
assert.equal(Number(cn.attemptNo),2,'next-day POD is attempt 2 only when full trajectory contains failure then a new START');
assert.equal(Number(cn.signingDays),2,'signing days must remain first report date -> actual POD date inclusive');
assert.match(cn.attemptSource,/^V246_STRICT_TRACK:/);
assert.doesNotMatch(cn.attemptSource,/V252_OPEN:/,'POD must replace provisional current-attempt evidence with final full-history evidence');

closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});
console.log('[V252] lifecycle smoke passed: import admission -> OPEN attempt1 -> refreshed OPEN attempt2 -> final attempt2 POD + 2-day signing');
