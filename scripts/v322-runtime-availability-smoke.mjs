import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath,['scripts/v375-import-metadata-zero-shopee-smoke.mjs'],{stdio:'inherit'});
for(const file of ['src/rangeDashboardStoreV320.js','src/v322WebAvailabilityPatch.js','src/v418StatusProofFastPath.js','src/v147TrackTimeoutConfig.js','src/v295FirstAttemptTruth.js','src/v375UnifiedImportMetadataPatch.js','src/v311ShopeeIncompleteRecoveryPatch.js','public/v168-seven-business-status.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const rangeSource=fs.readFileSync('src/rangeDashboardStoreV320.js','utf8');
const progressSource=fs.readFileSync('src/v322WebAvailabilityPatch.js','utf8');
const fastProofSource=fs.readFileSync('src/v418StatusProofFastPath.js','utf8');
const statusUiSource=fs.readFileSync('public/v168-seven-business-status.js','utf8');
const activation=fs.readFileSync('src/v147TrackTimeoutConfig.js','utf8');
const firstAttemptSource=fs.readFileSync('src/v295FirstAttemptTruth.js','utf8');
assert.match(rangeSource,/V322_SINGLE_DAY_DASHBOARD_CACHE_ONLY/);
assert.match(rangeSource,/readV236CurrentSummary\(date,\{cacheOnly:true\}\)/,'single-day period dashboard must use the tiny completed-cache reader');
assert.match(rangeSource,/requestedFrom===requestedTo\)return fastSingleDay\(requestedTo\)/,'single-day must return before historical V295/V294 work');
assert.ok(rangeSource.indexOf('return fastSingleDay(requestedTo)')<rangeSource.indexOf('const range=loadRangeDashboardV295'),'heavy historical range owner must be unreachable for a one-day request');

// V419 keeps V322 as the one persisted exact-date status endpoint for CCSL + SHOPEE + WHPP.
// The normal web path is scalar-only: current membership, compact run/snapshot markers and
// exact current-member SUCCESS set joins. Legacy large snapshot/state JSON stays unread.
assert.match(progressSource,/V322_WEB_AVAILABILITY_ID='2026-09-02-v414-persisted-three-stage-status-v1'/);
assert.match(progressSource,/V322_SEVEN_BUSINESS_STATUS_ID='2026-09-02-v414-one-read-seven-business-status-v1'/);
assert.match(progressSource,/V322_WHPP_COMPLETION_PARITY_ID='2026-09-02-v414-whpp-success-evidence-parity-v1'/);
assert.match(progressSource,/V322_COMPLETED_FAST_PATH_ID='2026-09-02-v322-unified-completed-snapshot-fast-path-v1'/);
assert.match(progressSource,/V418_V322_LIGHTWEIGHT_COMPLETED_CLAIM_ID='2026-09-02-v418-v322-no-payload-completed-claim-v1'/);
assert.match(progressSource,/V419_SCALAR_STATUS_PRIORITY_ID='2026-09-02-v419-scalar-status-priority-no-json-v1'/);
assert.match(progressSource,/V419_STATUS_TIMING_ID='2026-09-02-v419-status-substage-timing-v1'/);
assert.match(progressSource,/function unifiedCompletionClaim\(db,batch\)/,'current unified completion claim must stay a compact exact snapshot-status read');
assert.match(progressSource,/SELECT status FROM unified_snapshots WHERE snapshotId=\? AND reportDate=\? LIMIT 1/,'terminal claim must read only the exact current unified snapshot status');
assert.doesNotMatch(progressSource,/SELECT[^`\n]*(?:payloadJson|stateJson|summaryJson|valueJson)/,'V419 status SQL must never materialize large JSON payload columns');
assert.match(progressSource,/readV418CurrentMembershipCounts\(db,batch\|\|\{\}\)/,'V419 must anchor status to the exact current seven-business cohort');
assert.match(progressSource,/readV418CcslProcessingProof/,'CCSL completion must use the V418 current-member scalar proof');
assert.match(progressSource,/readV418BusinessSuccessCoverage/,'SHOPEE and WHPP completion must use V418 current-member SUCCESS coverage');
assert.doesNotMatch(progressSource,/readV415CurrentProcessingProof\(/,'V419 normal status must not invoke the legacy second proof chain');
assert.match(progressSource,/V418_CURRENT_MEMBER_PROCESSING_PROOF/,'terminal publication must identify current-member proof ownership');
assert.match(progressSource,/V418_NO_PAYLOAD_COMPLETED_CLAIM/,'terminal publication must expose the no-payload V418 claim source');
assert.match(progressSource,/function readV322SevenBusinessStatus/);
assert.match(progressSource,/stages:\{CCSL,SHOPEE,WHPP\}/,'one V322 read must return all three persisted execution stages');
assert.match(progressSource,/PERSISTED_DAILY_HEADER_RUN_LOCK_SNAPSHOT/,'CCSL and SHOPEE completion must remain compact persisted lock/snapshot based while incomplete');
assert.match(progressSource,/PERSISTED_WHPP_V414_SUCCESS_AND_RESTART_PROOF/,'WHPP status must expose V414 current-member SUCCESS and restart-proof truth while incomplete');
assert.match(progressSource,/const whppMembershipOk=counts\._whppMembershipOk!==false/,'WHPP completion must fail closed when standard and unified current membership disagree');
assert.match(progressSource,/const lockClaim=COMPLETE_LOCK\.has\(text\(whppLock\?\.status\)\.toLowerCase\(\)\),unifiedClaim=unifiedCompletionClaim\(db,batch\)/,'WHPP positive proof requires a current compact completion claim before SUCCESS coverage');
assert.match(progressSource,/readV418BusinessSuccessCoverage\(db,\{businessType:'WHPP',date,snapshotId,boundary,memberTypes:\['WHPP'\]\}\)/,'WHPP completion must use the exact current WHPP cohort');
assert.match(progressSource,/coverage\?\.ok&&n\(coverage\.count\)>=n\(counts\.WHPP\)/,'WHPP completion requires full current-member SUCCESS coverage');
assert.match(fastProofSource,/V418_STATUS_PROOF_FAST_PATH_ID='2026-09-02-v418-large-db-set-join-status-proof-v1'/);
assert.match(fastProofSource,/UPPER\(COALESCE\(f\.apiStatus,''\)\)='SUCCESS'/,'positive completion proof must count only successful current-member processing evidence');
assert.match(fastProofSource,/FROM business_daily_parse_rows d[\s\S]*JOIN business_final_rows f[\s\S]*f\.shipmentCode=d\.shipmentCode/,'WHPP current-member proof must remain a set join');
assert.match(fastProofSource,/FROM unified_import_rows u[\s\S]*JOIN business_final_rows f[\s\S]*f\.shipmentCode=u\.shipmentCode/,'SHOPEE current-member proof must remain an exact-snapshot set join');
assert.match(progressSource,/restartInterrupted/,'persisted WHPP status must expose restart interruption truth');
assert.match(progressSource,/PROCESS_RESTART_INTERRUPTED/,'generic incomplete WHPP must not become automatic-run eligible without exact restart proof');
assert.doesNotMatch(progressSource,/FROM\s+(?:scan_results|business_scan_results|track_events|business_track_events|business_shipment_tracks|business_exception_items)\b/i,'web run-progress must never reconstruct scan/track/event facts');
assert.match(progressSource,/code:'V322_PERSISTED_STATUS_READ_FAILED'/,'status read errors must preserve the canonical fail-closed compatibility code');
assert.match(progressSource,/detailCode:'V419_SCALAR_STATUS_READ_FAILED'/,'V419 scalar diagnostics must remain visible alongside the canonical code');
assert.match(progressSource,/ok:false,code:'V322_PERSISTED_STATUS_READ_FAILED'/,'failed status reads must be visibly non-ok');
assert.match(progressSource,/this\.route\(pathValue\)\.get\(progressHandler\)/,'V419 must own the run-progress route directly and avoid a duplicate proof wrapper');
assert.match(progressSource,/\/api\/v33\/run-progress/,'V322 must replace the legacy progress handler');
assert.match(activation,/v322WebAvailabilityPatch\.js/,'V322 web availability guard must activate before server route registration');
assert.match(activation,/v375UnifiedImportMetadataPatch\.js/,'V375 import metadata owner must activate before server route registration');

// Once one exact-date read proves all seven businesses complete, the browser must
// stop its 10s status polling until a new import/date lifecycle requires recheck.
assert.match(statusUiSource,/TERMINAL_READ_POLICY = '2026-09-02-v168-stop-polling-completed-date-v1'/);
assert.match(statusUiSource,/function terminalTruthFor\(target\)/);
assert.match(statusUiSource,/if \(!options\.force && terminalTruthFor\(target\)\)/,'completed exact-date truth must short-circuit explicit refreshes');
assert.match(statusUiSource,/terminalDate = lastTruth\.complete \? target : ''/,'fresh complete truth must latch the exact report date');
assert.match(statusUiSource,/!terminalTruthFor\(target\)\) void refreshTruth\(\)/,'10s poll must skip an exact completed report date');
assert.match(statusUiSource,/ce-qc-unified-import-committed[\s\S]*clearTerminal\(\)/,'new committed import must invalidate the previous terminal latch');

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
const {readV415CurrentProcessingProof}=await import('../src/v415RetroactiveCompletionGuard.js');
const db=getDb(),date='2026-08-06',snapshotId='V322-S',batchId='V322-B',now=`${date}T23:00:00.000Z`,after=`${date}T23:30:00.000Z`;
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
db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)').run(snapshotId,batchId,date,'VALID','{}',now);
db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)').run(batchId,snapshotId,date,'v322.xlsx','v322-hash','VALID','{}','[]',now);
const insRow=db.prepare('INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
const types=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
for(let i=0;i<types.length;i++)insRow.run(batchId,snapshotId,date,types[i],`V322-${types[i]}`,'PP',types[i],types[i],'日报',i+1,'V322','{}',now);
const cache=db.prepare('INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)');
for(const type of types)cache.run(date,type,'',JSON.stringify({total:1,pod:1,returned:0,cancelled:0,sameDayPod:1,ocCurrent:0,pending1:0,pending2:0,pending3:0,pendingNonContinuous:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,delivery1:0,deliveryStay:0,provinceOpen:0,attempt1:type.startsWith('SHOPEE')?1:0,attempt2:0,attempt3:0}),snapshotId,'COMPLETED','V322',now);
// V414 requires the WHPP standard daily membership and the current unified WHPP cohort
// to agree. The header, parse-row membership and unified row therefore all carry the
// same one WHPP shipment. Without SUCCESS evidence it must remain incomplete.
db.prepare('INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)').run('WHPP',date,'v322-whpp.xlsx',1,JSON.stringify({total:1,pod:1,sameDayPod:1,ocCurrent:0}),now,now);
db.prepare('INSERT INTO business_daily_parse_rows(businessType,reportDate,shipmentCode,rowJson,createdAt) VALUES(?,?,?,?,?)').run('WHPP',date,'V322-WHPP',JSON.stringify({shipmentCode:'V322-WHPP',businessType:'WHPP',reportDate:date,regionCode:'PP'}),now);

let started=performance.now();const range=loadRangeDashboard(date,date),rangeMs=performance.now()-started;
assert.equal(range.queryMode,'V322_SINGLE_DAY_DASHBOARD_CACHE_ONLY');assert.equal(range.dates.length,1);assert.equal(range.dates[0],date);assert.equal(range.sourceTotal,7);assert.ok(rangeMs<500,`single-day period dashboard must stay sub-500ms in fixture, got ${rangeMs.toFixed(1)}ms`);
started=performance.now();const progress=readV322RunProgress('CCSL',db,date),progressMs=performance.now()-started;
assert.equal(progress.version,'2026-09-02-v414-persisted-three-stage-status-v1');
assert.equal(progress.statusVersion,'2026-09-02-v414-one-read-seven-business-status-v1');
assert.equal(progress.whppCompletionPolicy,'2026-09-02-v414-whpp-success-evidence-parity-v1');
assert.equal(progress.businessType,'CCSL');
assert.equal(progress.reportDate,date);
assert.equal(progress.dailyTotal,4);
assert.equal(progress.statusSource,'PERSISTED_DAILY_HEADER_RUN_LOCK_SNAPSHOT');
assert.ok(progressMs<200,`persisted run progress must stay sub-200ms in fixture, got ${progressMs.toFixed(1)}ms`);
const all=readV322SevenBusinessStatus({reportDate:date,db});
assert.equal(all.ok,true);
assert.equal(all.reportDate,date);
assert.equal(all.statusVersion,'2026-09-02-v414-one-read-seven-business-status-v1');
assert.deepEqual(Object.keys(all.stages),['CCSL','SHOPEE','WHPP']);
assert.equal(all.stages.WHPP.completionPolicy,'2026-09-02-v414-whpp-success-evidence-parity-v1');
assert.match(String(all.stages.WHPP.statusSource||''),/PERSISTED_WHPP_V414_SUCCESS_AND_RESTART_PROOF/);
assert.equal(all.stages.WHPP.complete,false,'a current WHPP member with no SUCCESS row must remain incomplete rather than inheriting cache/final placeholders');

// A legacy COMPLETED marker alone must still be rejected. V419 terminal truth is
// released only after all exact current members carry real current-lifecycle proof.
db.prepare("UPDATE unified_snapshots SET status='COMPLETED',payloadJson=? WHERE snapshotId=?").run('x'.repeat(8*1024*1024),snapshotId);
db.prepare('INSERT INTO run_locks(reportDate,runId,status,currentStage,batchIndex,totalBatches,lockedAt,completedAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)').run(date,'V322-CCSL-RUN','finished','完成',1,1,after,after,after);
db.prepare("INSERT INTO export_snapshots(snapshotId,reportDate,runId,snapshotType,status,reconciliationStatus,generatedAt,createdAt) VALUES(?,?,?,?,?,?,?,?)").run('V322-CCSL-FINAL',date,'V322-CCSL-RUN','dashboard','VALID','COMPLETED',after,after);
for(const type of ['CE','CEAF','TBKH','ALI1688'])db.prepare('INSERT INTO pod_locks(shipmentCode,source,podTime,lastSeenReportDate,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(`V322-${type}`,'V322',after,date,after,after);
db.prepare('INSERT INTO business_run_locks(businessType,reportDate,runId,status,currentStage,batchIndex,totalBatches,lockedAt,completedAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)').run('SHOPEE',date,'V322-SHOPEE-RUN','finished','完成',1,1,after,after,after);
db.prepare("INSERT INTO business_export_snapshots(snapshotId,businessType,reportDate,runId,status,reconciliationStatus,generatedAt,createdAt) VALUES(?,?,?,?,?,?,?,?)").run('V322-SHOPEE-FINAL','SHOPEE',date,'V322-SHOPEE-RUN','VALID','COMPLETED',after,after);
for(const type of ['SHOPEECN','SHOPEEVN'])db.prepare('INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)').run('SHOPEE',`V322-${type}`,date,0,'派送中','SUCCESS',after,after);
db.prepare('INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)').run('WHPP','V322-WHPP',date,0,'派送中','SUCCESS',after,after);

const proof=readV415CurrentProcessingProof({db,reportDate:date,force:true});
assert.equal(proof.ok,true,'V418 current-member proof fixture must resolve');
for(const key of ['CCSL','SHOPEE','WHPP']){
  assert.equal(proof.stages[key].complete,true,`${key} exact current-member proof must be complete: ${JSON.stringify(proof.stages[key])}`);
}
started=performance.now();const terminal=readV322SevenBusinessStatus({reportDate:date,db,force:true}),terminalMs=performance.now()-started;
assert.equal(terminal.complete,true,'legacy COMPLETED marker may publish only after exact current-member proof succeeds');
assert.equal(terminal.completedFastPath,'2026-09-02-v322-unified-completed-snapshot-fast-path-v1+2026-09-02-v418-v322-no-payload-completed-claim-v1');
assert.equal(terminal.v418FastPathId,'2026-09-02-v418-large-db-set-join-status-proof-v1');
assert.equal(terminal.stages.CCSL.complete,true);assert.equal(terminal.stages.SHOPEE.complete,true);assert.equal(terminal.stages.WHPP.complete,true);
assert.equal(terminal.stages.CCSL.sourceTotal,4);assert.equal(terminal.stages.SHOPEE.sourceTotal,2);assert.equal(terminal.stages.WHPP.sourceTotal,1);
for(const key of ['CCSL','SHOPEE','WHPP']){
  assert.equal(terminal.stages[key].statusSource,'V418_NO_PAYLOAD_COMPLETED_CLAIM');
  assert.equal(terminal.stages[key].completionSource,'V418_CURRENT_MEMBER_PROCESSING_PROOF');
}
assert.ok(terminalMs<100,`V419 completed unified status must stay sub-100ms without reading the 8MB payload, got ${terminalMs.toFixed(1)}ms`);

closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});
console.log(`[V419/V418/V414/V374/V375/V322/V335] runtime availability smoke passed · V375 import reload + zero-Shopee gate chained · V295 membership + shipment lookups remain index-friendly · exact seven-business unified cohort includes WHPP=1 · incomplete WHPP requires current-member SUCCESS/restart proof · legacy COMPLETED + 8MB payload stays unread until exact current-member scalar proof releases terminal truth · V168 completed date stops polling · single-day period=${rangeMs.toFixed(1)}ms · persisted progress=${progressMs.toFixed(1)}ms · completed-status=${terminalMs.toFixed(1)}ms · no scan/track/event reconstruction`);