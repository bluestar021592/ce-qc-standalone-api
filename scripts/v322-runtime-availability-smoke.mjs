import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath,['scripts/v375-import-metadata-zero-shopee-smoke.mjs'],{stdio:'inherit'});
for(const file of ['src/rangeDashboardStoreV320.js','src/v322WebAvailabilityPatch.js','src/v147TrackTimeoutConfig.js','src/v295FirstAttemptTruth.js','src/v375UnifiedImportMetadataPatch.js','src/v311ShopeeIncompleteRecoveryPatch.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const rangeSource=fs.readFileSync('src/rangeDashboardStoreV320.js','utf8');
const progressSource=fs.readFileSync('src/v322WebAvailabilityPatch.js','utf8');
const activation=fs.readFileSync('src/v147TrackTimeoutConfig.js','utf8');
const firstAttemptSource=fs.readFileSync('src/v295FirstAttemptTruth.js','utf8');
assert.match(rangeSource,/V322_SINGLE_DAY_DASHBOARD_CACHE_ONLY/);
assert.match(rangeSource,/readV236CurrentSummary\(date,\{cacheOnly:true\}\)/,'single-day period dashboard must use the tiny completed-cache reader');
assert.match(rangeSource,/requestedFrom===requestedTo\)return fastSingleDay\(requestedTo\)/,'single-day must return before historical V295/V294 work');
assert.ok(rangeSource.indexOf('return fastSingleDay(requestedTo)')<rangeSource.indexOf('const range=loadRangeDashboardV295'),'heavy historical range owner must be unreachable for a one-day request');

// V322 now owns one persisted exact-date status read for CCSL + SHOPEE + WHPP.
// The old V322_TINY_LOCK_CHECKPOINT_NO_FACT_TABLE_SCAN marker predated WHPP/V132
// completion parity. Current WHPP parity may perform only an indexed EXISTS check
// against final evidence for the exact current member set; it must never rebuild
// scan/track/event truth in the web status path.
assert.match(progressSource,/V322_WEB_AVAILABILITY_ID='2026-09-02-v322-persisted-three-stage-status-v5'/);
assert.match(progressSource,/V322_SEVEN_BUSINESS_STATUS_ID='2026-09-02-v322-one-read-seven-business-status-v1'/);
assert.match(progressSource,/V322_WHPP_COMPLETION_PARITY_ID='2026-09-02-v322-whpp-v132-current-cohort-parity-v1'/);
assert.match(progressSource,/function readV322SevenBusinessStatus/);
assert.match(progressSource,/stages:\{CCSL,SHOPEE,WHPP\}/,'one V322 read must return all three persisted execution stages');
assert.match(progressSource,/PERSISTED_DAILY_HEADER_RUN_LOCK_SNAPSHOT/,'CCSL and SHOPEE completion must remain persisted-header/run-lock/snapshot based');
assert.match(progressSource,/PERSISTED_WHPP_V132_COMPLETION_PARITY/,'WHPP status must explicitly expose V132 current-cohort completion parity');
assert.match(progressSource,/CURRENT_DAILY_FINALIZATION_MARKER/,'WHPP current daily finalization marker must close an already finalized cohort');
assert.match(progressSource,/CURRENT_FINALIZED_WHPP_STATE/,'WHPP exact current lifecycle completion must survive browser/backend restart');
assert.match(progressSource,/EXACT_ZERO_CURRENT_UNIFIED_MEMBERSHIP/,'exact current zero membership must remain a safe no-work completion path');
assert.match(progressSource,/FULL_MEMBER_FINAL_EVIDENCE/,'full exact current-member final evidence must remain a safe zero-work completion path');
assert.match(progressSource,/COUNT\(DISTINCT d\.shipmentCode\)[\s\S]*EXISTS\(SELECT 1 FROM business_final_rows f[\s\S]*f\.shipmentCode=d\.shipmentCode AND f\.reportDate=\?/,'standard WHPP final-evidence check must stay membership-bound and date-bound');
assert.match(progressSource,/COUNT\(DISTINCT u\.shipmentCode\)[\s\S]*u\.snapshotId=\?[\s\S]*EXISTS\(SELECT 1 FROM business_final_rows f[\s\S]*f\.shipmentCode=u\.shipmentCode AND f\.reportDate=\?/,'unified WHPP fallback evidence check must stay exact-snapshot/member/date bound');
assert.doesNotMatch(progressSource,/FROM\s+(?:scan_results|business_scan_results|track_events|business_track_events|business_shipment_tracks|business_exception_items)\b/i,'web run-progress must never reconstruct scan/track/event facts');
assert.match(progressSource,/code:'V322_PERSISTED_STATUS_READ_FAILED'/,'status read errors must fail closed rather than fabricating pending/complete truth');
assert.match(progressSource,/ok:false,code:'V322_PERSISTED_STATUS_READ_FAILED'/,'failed status reads must be visibly non-ok');
assert.match(progressSource,/\/api\/v33\/run-progress/,'V322 must replace the legacy progress handler');
assert.match(activation,/v322WebAvailabilityPatch\.js/,'V322 web availability guard must activate before server route registration');
assert.match(activation,/v375UnifiedImportMetadataPatch\.js/,'V375 import metadata owner must activate before server route registration');

// V374 supersedes the earlier V344 lookup policy. Large first-attempt fact/event AND
// membership lookups must keep normalized businessType/shipmentCode columns bare so
// the existing SQLite indexes remain usable. Function-wrapped indexed columns cause
// full scans on the production database.
assert.match(firstAttemptSource,/V295_FIRST_ATTEMPT_QUERY_POLICY_ID\s*=\s*'2026-08-31-v374-index-friendly-membership-v2'/);
assert.match(firstAttemptSource,/SELECT DISTINCT r\.reportDate,u\.businessType businessType,u\.shipmentCode shipmentCode/);
assert.match(firstAttemptSource,/u\.businessType IN \('CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'\)/);
assert.match(firstAttemptSource,/u\.shipmentCode<>''/);
assert.match(firstAttemptSource,/WHERE p\.businessType='WHPP'/);
assert.match(firstAttemptSource,/AND p\.shipmentCode<>''/);
assert.match(firstAttemptSource,/AND u\.businessType='CEAF'/);
assert.match(firstAttemptSource,/AND u\.shipmentCode=p\.shipmentCode/);
assert.match(firstAttemptSource,/FROM track_events WHERE shipmentCode IN/);
assert.match(firstAttemptSource,/businessType='SHOPEE' AND shipmentCode IN/);
assert.match(firstAttemptSource,/businessType='WHPP' AND shipmentCode IN/);
assert.match(firstAttemptSource,/FROM final_rows WHERE reportDate BETWEEN \? AND \? AND shipmentCode IN/);
assert.doesNotMatch(firstAttemptSource,/FROM track_events WHERE UPPER\(TRIM\(shipmentCode\)\) IN/,'V295 track-event reads must not disable shipment indexes');
assert.doesNotMatch(firstAttemptSource,/FROM business_track_events[\s\S]{0,120}UPPER\(TRIM\(shipmentCode\)\) IN/,'V295 business event reads must not disable shipment indexes');
assert.doesNotMatch(firstAttemptSource,/FROM (?:business_)?final_rows[\s\S]{0,160}UPPER\(TRIM\(shipmentCode\)\) IN/,'V295 final-row reads must not disable shipment indexes');
assert.doesNotMatch(firstAttemptSource,/unified_import_rows[\s\S]{0,420}UPPER\(TRIM\((?:u\.)?(?:businessType|shipmentCode)\)\)/,'V374 unified membership reads must not disable normalized membership indexes');
assert.doesNotMatch(firstAttemptSource,/business_daily_parse_rows[\s\S]{0,700}UPPER\((?:TRIM\()?\s*(?:p\.)?(?:businessType|shipmentCode)/,'V374 WHPP membership reads must not disable normalized membership indexes');

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v322-'));
process.env.DATA_DIR=tempRoot;process.env.DB_FILE=path.join(tempRoot,'v322.db');process.env.ACCESS_MODE='LOCAL';process.env.SQLITE_MMAP_BYTES='0';process.env.SQLITE_CACHE_KIB='8192';process.env.NODE_ENV='test';process.env.CE_QC_DISABLE_V246_TRACKING='1';
const {getDb,closeDb}=await import('../src/db.js');
const {loadRangeDashboard}=await import('../src/rangeDashboardStoreV320.js');
const {readV322RunProgress,readV322SevenBusinessStatus}=await import('../src/v322WebAvailabilityPatch.js');
const db=getDb(),date='2026-08-06',snapshotId='V322-S',batchId='V322-B',now=`${date}T23:00:00.000Z`;
// dashboard_daily_cache is a runtime-maintained table rather than a base migration
// table in some isolated test databases. Create only the minimal production-compatible
// shape required by this fixture so the smoke tests the V322 read path, not unrelated
// cache-worker schema creation order.
db.exec(`CREATE TABLE IF NOT EXISTS dashboard_daily_cache(
  reportDate TEXT NOT NULL,
  businessType TEXT NOT NULL,
  regionCode TEXT NOT NULL DEFAULT '',
  metricsJson TEXT NOT NULL,
  snapshotId TEXT NOT NULL DEFAULT '',
  snapshotStatus TEXT NOT NULL DEFAULT '',
  sourceFingerprint TEXT NOT NULL DEFAULT '',
  refreshedAt TEXT NOT NULL,
  PRIMARY KEY(reportDate,businessType,regionCode)
)`);
db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)').run(snapshotId,batchId,date,'COMPLETED','{}',now);
db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)').run(batchId,snapshotId,date,'v322.xlsx','v322-hash','VALID','{}','[]',now);
const insRow=db.prepare('INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
const types=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
for(let i=0;i<types.length;i++)insRow.run(batchId,snapshotId,date,types[i],`V322-${types[i]}`,'PP',types[i],types[i],'日报',i+1,'V322','{}',now);
const cache=db.prepare('INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)');
for(const type of [...types,'WHPP'])cache.run(date,type,'',JSON.stringify({total:1,pod:1,returned:0,cancelled:0,sameDayPod:1,ocCurrent:0,pending1:0,pending2:0,pending3:0,pendingNonContinuous:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,delivery1:0,deliveryStay:0,provinceOpen:0,attempt1:type.startsWith('SHOPEE')?1:0,attempt2:0,attempt3:0}),snapshotId,'COMPLETED','V322',now);
// V335+ requires WHPP standard daily membership to be internally complete: the daily
// header total and the distinct parse-row members must agree exactly. A header-only
// fixture is intentionally rejected as incomplete, just like production 236/235 data.
db.prepare('INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)').run('WHPP',date,'v322-whpp.xlsx',1,JSON.stringify({total:1,pod:1,sameDayPod:1,ocCurrent:0}),now,now);
db.prepare('INSERT INTO business_daily_parse_rows(businessType,reportDate,shipmentCode,rowJson,createdAt) VALUES(?,?,?,?,?)').run('WHPP',date,'V322-WHPP',JSON.stringify({shipmentCode:'V322-WHPP',businessType:'WHPP',reportDate:date,regionCode:'PP'}),now);

let started=performance.now();const range=loadRangeDashboard(date,date),rangeMs=performance.now()-started;
assert.equal(range.queryMode,'V322_SINGLE_DAY_DASHBOARD_CACHE_ONLY');assert.equal(range.dates.length,1);assert.equal(range.dates[0],date);assert.equal(range.sourceTotal,7);assert.ok(rangeMs<500,`single-day period dashboard must stay sub-500ms in fixture, got ${rangeMs.toFixed(1)}ms`);
started=performance.now();const progress=readV322RunProgress('CCSL',db,date),progressMs=performance.now()-started;
assert.equal(progress.version,'2026-09-02-v322-persisted-three-stage-status-v5');
assert.equal(progress.statusVersion,'2026-09-02-v322-one-read-seven-business-status-v1');
assert.equal(progress.whppCompletionPolicy,'2026-09-02-v322-whpp-v132-current-cohort-parity-v1');
assert.equal(progress.businessType,'CCSL');
assert.equal(progress.reportDate,date);
assert.equal(progress.dailyTotal,4);
assert.equal(progress.statusSource,'PERSISTED_DAILY_HEADER_RUN_LOCK_SNAPSHOT');
assert.ok(progressMs<200,`persisted run progress must stay sub-200ms in fixture, got ${progressMs.toFixed(1)}ms`);
const all=readV322SevenBusinessStatus({reportDate:date,db});
assert.equal(all.ok,true);
assert.equal(all.reportDate,date);
assert.equal(all.statusVersion,'2026-09-02-v322-one-read-seven-business-status-v1');
assert.deepEqual(Object.keys(all.stages),['CCSL','SHOPEE','WHPP']);
assert.equal(all.stages.WHPP.completionPolicy,'2026-09-02-v322-whpp-v132-current-cohort-parity-v1');
assert.match(String(all.stages.WHPP.statusSource||''),/PERSISTED_WHPP_V132_COMPLETION_PARITY/);
closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});
console.log(`[V374/V375/V322/V335] runtime availability smoke passed · V375 import reload + zero-Shopee gate chained · V295 membership + shipment lookups remain index-friendly · exact 1/1 WHPP standard membership + six unified businesses = 7 · V322 one-read persisted three-stage status + V132 WHPP completion parity · single-day period=${rangeMs.toFixed(1)}ms · persisted progress=${progressMs.toFixed(1)}ms · no scan/track/event reconstruction`);
