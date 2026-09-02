import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import {
  V415_RETROACTIVE_COMPLETION_GUARD_ID,
  V415_STALE_COMPLETION_REOPEN_ID,
  V416_FAST_FAILCLOSED_PROOF_ID,
  V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID,
  V418_STATUS_PROOF_FAST_PATH_ID,
  readV415CurrentProcessingProof,
  applyV415StatusGuard
} from '../src/v415RetroactiveCompletionGuard.js';
import {
  V415_IMPORT_OPEN_GUARD_ID,
  V416_OPEN_CLOSURE_SEPARATION_ID,
  applyV415ImportOpenGuard
} from '../src/v415ImportCarryoverGuard.js';
import {
  V417_OPEN_RUNTIME_TRUTH_ID,
  reconcileV417Carryover
} from '../src/v417OpenTruth.js';

for(const file of [
  'src/v415RetroactiveCompletionGuard.js','src/v415ImportCarryoverGuard.js','src/v417OpenTruth.js',
  'src/v418StatusProofFastPath.js','src/v161UnifiedImportRuntimeTruthPatch.js','src/v384CcslProcessingProof.js',
  'src/v322WebAvailabilityPatch.js','public/v159-current-import-stability.js','public/v168-seven-business-status.js'
])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});

const source=fs.readFileSync('src/v415RetroactiveCompletionGuard.js','utf8');
const helperSource=fs.readFileSync('src/v418StatusProofFastPath.js','utf8');
const openSource=fs.readFileSync('src/v415ImportCarryoverGuard.js','utf8');
const runtimeImportSource=fs.readFileSync('src/v161UnifiedImportRuntimeTruthPatch.js','utf8');
const v417OpenSource=fs.readFileSync('src/v417OpenTruth.js','utf8');
const v322Source=fs.readFileSync('src/v322WebAvailabilityPatch.js','utf8');
const importUi=fs.readFileSync('public/v159-current-import-stability.js','utf8');
const statusUi=fs.readFileSync('public/v168-seven-business-status.js','utf8');
const activation=fs.readFileSync('src/v317CcslRecoveryPolicy.js','utf8');
assert.match(V415_RETROACTIVE_COMPLETION_GUARD_ID,/v415-current-member-processing-proof-v1/);
assert.match(V415_STALE_COMPLETION_REOPEN_ID,/v415-stale-completion-reopen-v1/);
assert.match(V415_IMPORT_OPEN_GUARD_ID,/v415-stale-completion-open-fallback-v1/);
assert.match(V416_FAST_FAILCLOSED_PROOF_ID,/v416-large-db-fast-failclosed-proof-v1/);
assert.match(V416_OPEN_CLOSURE_SEPARATION_ID,/v416-processing-complete-does-not-close-open-v1/);
assert.match(V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID,/v417-membership-anchored-success-proof-v1/);
assert.match(V417_OPEN_RUNTIME_TRUTH_ID,/v417-current-and-historical-open-reconciliation-v1/);
assert.match(V418_STATUS_PROOF_FAST_PATH_ID,/v418-large-db-set-join-status-proof-v1/);
assert.match(activation,/import '\.\/v415RetroactiveCompletionGuard\.js';/,'V415/V418 must load before V317/V322 status registration');
assert.match(activation,/import '\.\/v415ImportCarryoverGuard\.js';/,'V415 import OPEN guard must load before web route registration');

// V419 large-db contract: current membership and SUCCESS coverage are read from
// current-member indexed/set-join tables. Old giant snapshot/state JSON cannot be
// materialized on the normal status path.
assert.match(source,/readV418CurrentMembershipCounts/,'V415 status proof must delegate membership to V418 fast current-member reader');
assert.match(source,/readV418CcslProcessingProof/,'CCSL proof must use V418 set-join fast path');
assert.match(source,/readV418BusinessSuccessCoverage/,'SHOPEE/WHPP proof must use V418 set-join SUCCESS coverage');
assert.match(helperSource,/UNIFIED_SNAPSHOT_IMMUTABLE_CLASSIFICATION_COUNTS/,'V418 keeps the compatibility membership truth contract');
assert.match(helperSource,/V418_INDEXED_CURRENT_MEMBERSHIP_COUNTS/,'V418 must expose indexed current-membership source');
assert.match(helperSource,/UPPER\(COALESCE\(f\.apiStatus,''\)\)='SUCCESS'/,'SHOPEE/WHPP completion must still require persisted SUCCESS rows');
assert.match(helperSource,/FROM business_daily_parse_rows d[\s\S]*JOIN business_final_rows f[\s\S]*f\.shipmentCode=d\.shipmentCode/,'WHPP SUCCESS proof must be anchored on exact current WHPP daily membership');
assert.match(helperSource,/LEFT JOIN scan_results s[\s\S]*LEFT JOIN final_rows f/,'CCSL proof must use one bounded current-member set join');
assert.doesNotMatch(source,/SELECT payloadJson FROM unified_snapshots/,'V418 status proof must never materialize old unified snapshot payload JSON');
assert.doesNotMatch(v322Source,/SELECT status,payloadJson FROM unified_snapshots/,'V322 legacy completed check must not materialize old snapshot payload JSON');
assert.match(v322Source,/SELECT status FROM unified_snapshots/,'V322 may read only the lightweight snapshot status claim');
assert.match(v322Source,/V418_V322_LIGHTWEIGHT_COMPLETED_CLAIM_ID/,'V322 legacy completed claim must be guarded by V418 current-member proof');
assert.doesNotMatch(v322Source,/\bSELECT\b[^;\n]*\bvalueJson\b/i,'V419 status owner must never select legacy business_states.valueJson');
assert.doesNotMatch(v322Source,/JSON\.parse\([^\n]*valueJson/i,'V419 status owner must never parse legacy business_states.valueJson');
assert.doesNotMatch(source,/\bSELECT\b[^;\n]*\bvalueJson\b/i,'V415 completion proof hot path must not select legacy business state JSON');
assert.match(source,/includeMissingBills:false/,'small-fixture compatibility fallback may use count-only V384 mode, never missing-bill diagnostics');
assert.match(source,/NO_CURRENT_COMPLETION_SNAPSHOT/,'missing current completion snapshot must fail closed before CCSL proof');
assert.match(source,/V416_FAIL_CLOSED_STATUS_PROOF/,'proof errors/unavailability must never preserve stale completed stages');
assert.match(source,/completedFastPath:[\s\S]*V415_PROOF_GUARD/,'legacy unified COMPLETED fast path must remain proof-guarded');
assert.match(source,/status='failed'[\s\S]*V415_REOPEN_STALE_COMPLETION_MISSING_CURRENT_PROCESSING_PROOF/,'stale finished run pointers must become recoverable');
assert.match(source,/snapshotStatus:'IMPORTED'/,'stale WHPP mutable state must return to imported/pending state before a real rerun');

assert.match(openSource,/processingCompleteDoesNotCloseOpen:true/,'OPEN truth must be independent from processing-stage completion');
assert.match(openSource,/V416_CURRENT_MEMBERSHIP_MINUS_HARD_TERMINALS/,'zero OPEN must reconcile exact current membership minus hard terminals');
assert.match(openSource,/HARD_TERMINALS/,'OPEN fallback must preserve explicit hard terminal facts');
assert.match(runtimeImportSource,/reconcileV417Carryover/,'V161 current import owner must apply V417 OPEN reconciliation after reading persisted carryover rows');
assert.match(runtimeImportSource,/openTruthPatch: V417_OPEN_RUNTIME_TRUTH_ID/,'current import payload must expose V417 OPEN truth revision');
assert.match(v417OpenSource,/HISTORICAL_NONTERMINAL_RECONCILIATION/,'historical rows closed without hard terminal truth must remain visible as OPEN read-only truth');
assert.match(v417OpenSource,/processingCompleteDoesNotCloseOpen:true/,'V417 OPEN reconciliation must remain independent from processing completion');
assert.match(importUi,/v418-current-import-stability-v4-open-split-display/,'import UI must own V418 read-only split display');
assert.match(importUi,/conservativeCurrentOpen/,'today OPEN display must consume backend closure-reconciled current OPEN');
assert.match(importUi,/historicalReconciledOpen/,'historical OPEN display must consume backend closure-reconciled historical OPEN');
assert.match(importUi,/V418_READONLY_CLOSURE_RECONCILED_DISPLAY/,'OPEN split UI must identify read-only reconciled display truth');
assert.doesNotMatch(importUi,/carryover\.(?:todayOpen|historicalOpen|currentOpen)\s*=/,'browser must never mutate backend OPEN truth');
assert.match(statusUi,/v416-never-display-stale-completed-while-unconfirmed-v1/,'browser status must fail closed while persistence proof is unconfirmed');
assert.match(statusUi,/v417-hide-stale-legacy-detail-while-status-unconfirmed-v1/,'legacy detail panel must have a V417 fail-closed owner');
assert.match(statusUi,/v417-legacy-run-status-guard/,'unconfirmed status must replace the lower legacy run-detail block');
assert.match(statusUi,/旧“已完成\/处理完成”明细已隐藏/,'legacy completed detail must not remain visible during an unconfirmed read');
assert.match(statusUi,/state: 'unknown'[\s\S]*complete: false/,'transient status must never carry forward a stale done stage');
assert.match(statusUi,/本轮处理已完成/,'UI must distinguish processing-cycle completion from business closure');
assert.doesNotMatch(source,/DELETE FROM (?:export_snapshots|business_export_snapshots|unified_snapshots|scan_results|track_events|final_rows|business_final_rows|business_scan_results|business_track_events|pod_locks|business_pod_locks)/,'V415-V418 must preserve business facts and audit snapshots');
assert.doesNotMatch(openSource,/(?:UPDATE|DELETE|INSERT)\s+(?:INTO\s+)?(?:carryover_open_items|shipment_current_state|unified_import_rows)/i,'V415/V416 import OPEN fallback must remain read-only');
assert.doesNotMatch(v417OpenSource,/(?:UPDATE|DELETE|INSERT)\s+(?:INTO\s+)?(?:carryover_open_items|shipment_current_state|unified_import_rows|business_final_rows|business_pod_locks)/i,'V417 runtime OPEN reconciliation must remain read-only');

const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE unified_import_batches(batchId TEXT,snapshotId TEXT,reportDate TEXT,status TEXT,createdAt TEXT);
CREATE TABLE unified_import_rows(snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT);
CREATE INDEX idx_test_unified_snapshot ON unified_import_rows(snapshotId,businessType,shipmentCode);
CREATE TABLE unified_snapshots(snapshotId TEXT,reportDate TEXT,status TEXT,payloadJson TEXT);
CREATE TABLE run_locks(reportDate TEXT,runId TEXT,status TEXT,currentStage TEXT,batchIndex INTEGER,totalBatches INTEGER,errorMessage TEXT,lockedAt TEXT,updatedAt TEXT,completedAt TEXT);
CREATE TABLE export_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,snapshotId TEXT,runId TEXT,reportDate TEXT,snapshotType TEXT,status TEXT,reconciliationStatus TEXT,generatedAt TEXT);
CREATE TABLE scan_results(reportDate TEXT,shipmentCode TEXT,updatedAt TEXT,scanCategory TEXT,orderStatus TEXT,isPod INTEGER);
CREATE TABLE final_rows(reportDate TEXT,shipmentCode TEXT,updatedAt TEXT,primaryCategory TEXT,category TEXT,qcConclusion TEXT);
CREATE TABLE pod_locks(shipmentCode TEXT);
CREATE TABLE business_states(businessType TEXT,valueJson TEXT,updatedAt TEXT);
CREATE TABLE business_run_locks(businessType TEXT,reportDate TEXT,runId TEXT,status TEXT,currentStage TEXT,batchIndex INTEGER,totalBatches INTEGER,errorMessage TEXT,lockedAt TEXT,updatedAt TEXT,completedAt TEXT);
CREATE TABLE business_export_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,snapshotId TEXT,businessType TEXT,reportDate TEXT,runId TEXT,status TEXT,reconciliationStatus TEXT,generatedAt TEXT);
CREATE TABLE business_final_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,apiStatus TEXT,updatedAt TEXT,isPod INTEGER DEFAULT 0,primaryCategory TEXT DEFAULT '',PRIMARY KEY(businessType,shipmentCode,reportDate));
CREATE TABLE business_daily_parse_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,businessType TEXT,reportDate TEXT,shipmentCode TEXT);
CREATE TABLE business_pod_locks(businessType TEXT,shipmentCode TEXT,podTime TEXT);
CREATE TABLE shipment_current_state(shipmentCode TEXT PRIMARY KEY,businessType TEXT,reportDate TEXT,snapshotId TEXT,state TEXT,apiStatus TEXT,lastEventTime TEXT,stateJson TEXT,updatedAt TEXT);
CREATE TABLE carryover_open_items(shipmentCode TEXT PRIMARY KEY,businessType TEXT,sourceReportDate TEXT,lastReportDate TEXT,sourceSnapshotId TEXT,lastSnapshotId TEXT,status TEXT,apiStatus TEXT,closeReason TEXT,stateJson TEXT,createdAt TEXT,updatedAt TEXT);
`);
const date='2026-09-01',boundary='2026-09-01T01:00:00.000Z',after='2026-09-01T02:00:00.000Z';
db.prepare("INSERT INTO unified_import_batches VALUES(?,?,?,?,?)").run('B1','S1',date,'VALID',boundary);
const classificationCounts={CE:1,CEAF:0,TBKH:0,ALI1688:0,SHOPEECN:1,SHOPEEVN:0,WHPP:1};
// Deliberately store a giant legacy snapshot payload. V418 status proof must not
// materialize this field; the timed proof below stays bounded because membership
// is read from current indexed tables instead.
const giantLegacyPayload=JSON.stringify({classificationCounts,padding:'x'.repeat(8*1024*1024)});
db.prepare('INSERT INTO unified_snapshots VALUES(?,?,?,?)').run('S1',date,'COMPLETED',giantLegacyPayload);
for(const [type,bill] of [['CE','CE1'],['SHOPEECN','CN1'],['WHPP','WH1']])db.prepare('INSERT INTO unified_import_rows VALUES(?,?,?,?)').run('S1',date,type,bill);
db.prepare("INSERT INTO business_daily_parse_rows(businessType,reportDate,shipmentCode) VALUES('WHPP',?,?)").run(date,'WH1');
db.prepare('INSERT INTO run_locks VALUES(?,?,?,?,?,?,?,?,?,?)').run(date,'RC','finished','完成',1,1,'',after,after,after);
db.prepare("INSERT INTO export_snapshots(snapshotId,runId,reportDate,snapshotType,status,reconciliationStatus,generatedAt) VALUES(?,?,?,?,?,?,?)").run('XC','RC',date,'dashboard','VALID','COMPLETED',after);
for(const [type,runId] of [['SHOPEE','RS'],['WHPP','RW']])db.prepare('INSERT INTO business_run_locks VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(type,date,runId,'finished','完成',1,1,'',after,after,after);
db.prepare("INSERT INTO business_export_snapshots(snapshotId,businessType,reportDate,runId,status,reconciliationStatus,generatedAt) VALUES(?,?,?,?,?,?,?)").run('XS','SHOPEE',date,'RS','VALID','COMPLETED',after);

const auditBefore={
  ccsl:db.prepare('SELECT COUNT(*) count FROM export_snapshots').get().count,
  business:db.prepare('SELECT COUNT(*) count FROM business_export_snapshots').get().count
};
const staleStarted=performance.now();
const staleProof=readV415CurrentProcessingProof({db,reportDate:date,force:true});
const staleElapsedMs=performance.now()-staleStarted;
assert.ok(staleElapsedMs<1000,`V418 giant legacy snapshot proof must remain bounded; got ${staleElapsedMs.toFixed(1)}ms`);
assert.equal(staleProof.v418FastPathId,V418_STATUS_PROOF_FAST_PATH_ID);
assert.equal(staleProof.counts.CCSL,1);
assert.equal(staleProof.counts.SHOPEE,1);
assert.equal(staleProof.counts.WHPP,1);
assert.equal(staleProof.membershipSource,'UNIFIED_SNAPSHOT_IMMUTABLE_CLASSIFICATION_COUNTS');
assert.equal(staleProof.membershipFastSource,'V418_INDEXED_CURRENT_MEMBERSHIP_COUNTS');
assert.equal(staleProof.stages.CCSL.complete,false,'legacy CCSL snapshot without current processing facts must be rejected');
assert.equal(staleProof.stages.SHOPEE.complete,false,'legacy SHOPEE snapshot without current SUCCESS facts must be rejected');
assert.equal(staleProof.stages.WHPP.complete,false,'legacy WHPP finalized state without current SUCCESS facts must be rejected');

const legacyFast={
  ok:true,reportDate:date,complete:true,completedFastPath:'UNIFIED_COMPLETED_SNAPSHOT_FAST_PATH',
  stages:{CCSL:{key:'CCSL',complete:true,runStatus:'completed'},SHOPEE:{key:'SHOPEE',complete:true,runStatus:'completed'},WHPP:{key:'WHPP',complete:true,runStatus:'completed'}}
};
const guarded=applyV415StatusGuard(legacyFast,staleProof);
assert.equal(guarded.complete,false,'legacy all-done fast path must be downgraded');
for(const key of ['CCSL','SHOPEE','WHPP']){
  assert.equal(guarded.stages[key].complete,false,`${key} must be pending without current proof`);
  assert.equal(guarded.stages[key].completionSource,'V415_CURRENT_MEMBER_PROCESSING_PROOF_REQUIRED');
}
const failedClosed=applyV415StatusGuard(legacyFast,{ok:false,reason:'TEST_PROOF_FAILURE',stages:{}});
assert.equal(failedClosed.complete,false);
for(const key of ['CCSL','SHOPEE','WHPP'])assert.equal(failedClosed.stages[key].complete,false,'proof failure cannot preserve stale complete stage');

const staleImport=applyV415ImportOpenGuard({reportDate:date,snapshotId:'S1',classificationCounts,summary:{validUniqueWaybills:3},carryover:{todayOpen:0,historicalOpen:2,currentOpen:2}},staleProof,{db,hardClosed:0});
assert.equal(staleImport.carryover.todayOpen,3,'zero persisted OPEN must expose all unclosed current fixture members');
assert.equal(staleImport.carryover.currentOpen,5,'current OPEN must equal repaired today + persisted historical');
assert.equal(staleImport.carryover.source,'V416_CURRENT_MEMBERSHIP_MINUS_HARD_TERMINALS');
const terminalAware=applyV415ImportOpenGuard({reportDate:date,snapshotId:'S1',classificationCounts,summary:{validUniqueWaybills:3},carryover:{todayOpen:0,historicalOpen:0,currentOpen:0}},staleProof,{db,hardClosed:1});
assert.equal(terminalAware.carryover.todayOpen,2,'hard terminal facts must never be reopened by display fallback');

const oldDate='2026-08-31';
for(const [bill,status,reason] of [['H1','CLOSED','PROCESSING_COMPLETE'],['H2','CLOSED','POD'],['H3','OPEN','']]){
  db.prepare('INSERT INTO carryover_open_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(bill,'CE',oldDate,oldDate,'OLD','OLD',status,'',reason,'{}',boundary,after);
}
const v417Open=reconcileV417Carryover(db,{batch:{snapshotId:'S1',reportDate:date},counts:classificationCounts,baseCarry:{todayOpen:0,historicalOpen:0,currentOpen:0}});
assert.equal(v417Open.todayOpen,3,'all three current nonterminal members remain OPEN even if persisted todayOpen was zero');
assert.equal(v417Open.historicalOpen,2,'historical OPEN plus CLOSED-without-terminal rows must remain visible while POD-closed row stays closed');
assert.equal(v417Open.currentOpen,5);
assert.equal(v417Open.runtimeTruth,'V417_BUSINESS_CLOSURE_RECONCILED_OPEN');
assert.equal(v417Open.processingCompleteDoesNotCloseOpen,true);
assert.equal(Math.max(0,v417Open.conservativeCurrentOpen)+Math.max(0,v417Open.historicalReconciledOpen),v417Open.currentOpen,'V418 displayed current/historical split must add to the same reconciled OPEN total');

assert.deepEqual({
  ccsl:db.prepare('SELECT COUNT(*) count FROM export_snapshots').get().count,
  business:db.prepare('SELECT COUNT(*) count FROM business_export_snapshots').get().count
},auditBefore,'read/status guard must preserve old audit snapshots');

db.prepare('INSERT INTO scan_results VALUES(?,?,?,?,?,?)').run(date,'CE1',after,'NORMAL','60',0);
db.prepare('INSERT INTO final_rows VALUES(?,?,?,?,?,?)').run(date,'CE1',after,'派送中','派送中','正常处理');
db.prepare("INSERT INTO business_final_rows(businessType,reportDate,shipmentCode,apiStatus,updatedAt,isPod,primaryCategory) VALUES(?,?,?,?,?,?,?)").run('SHOPEE',date,'CN1','SUCCESS',after,0,'派送中');
db.prepare("INSERT INTO business_final_rows(businessType,reportDate,shipmentCode,apiStatus,updatedAt,isPod,primaryCategory) VALUES(?,?,?,?,?,?,?)").run('WHPP',date,'WH1','SUCCESS',after,0,'派送中');
const processedOpenProof=readV415CurrentProcessingProof({db,reportDate:date,force:true});
assert.equal(processedOpenProof.stages.CCSL.complete,true,'CCSL nonterminal but processed member may complete processing');
assert.equal(processedOpenProof.stages.SHOPEE.complete,true,'SHOPEE nonterminal but SUCCESS-processed member may complete processing');
assert.equal(processedOpenProof.stages.WHPP.complete,true,'WHPP nonterminal but SUCCESS-processed member may complete processing');
const accepted=applyV415StatusGuard(legacyFast,processedOpenProof);
assert.equal(accepted.complete,true,'processing completion must not require business closure');
const completedImport=applyV415ImportOpenGuard({reportDate:date,snapshotId:'S1',classificationCounts,summary:{validUniqueWaybills:3},carryover:{todayOpen:0,historicalOpen:0,currentOpen:0}},processedOpenProof,{db,hardClosed:0});
assert.equal(completedImport.carryover.currentOpen,3,'processing completion must never fabricate business closure; nonterminal current members remain OPEN');
assert.equal(completedImport.carryover.processingCompleteDoesNotCloseOpen,true);

console.log(`[V419/V418/V417/V416/V415] large-db status + OPEN split smoke passed · giant legacy snapshot ignored in ${staleElapsedMs.toFixed(1)}ms · current-member set joins preserve SUCCESS/V384 semantics · reconciled current+historical OPEN add to one total · legacy state JSON remains off the status hot path · stale completion stays fail-closed`);
