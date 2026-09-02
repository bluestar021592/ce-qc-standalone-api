import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  V415_RETROACTIVE_COMPLETION_GUARD_ID,
  V415_STALE_COMPLETION_REOPEN_ID,
  V416_FAST_FAILCLOSED_PROOF_ID,
  readV415CurrentProcessingProof,
  applyV415StatusGuard
} from '../src/v415RetroactiveCompletionGuard.js';
import {
  V415_IMPORT_OPEN_GUARD_ID,
  V416_OPEN_CLOSURE_SEPARATION_ID,
  applyV415ImportOpenGuard
} from '../src/v415ImportCarryoverGuard.js';

execFileSync(process.execPath,['--check','src/v415RetroactiveCompletionGuard.js'],{stdio:'pipe'});
execFileSync(process.execPath,['--check','src/v415ImportCarryoverGuard.js'],{stdio:'pipe'});
execFileSync(process.execPath,['--check','src/v384CcslProcessingProof.js'],{stdio:'pipe'});
execFileSync(process.execPath,['--check','public/v168-seven-business-status.js'],{stdio:'pipe'});
const source=fs.readFileSync('src/v415RetroactiveCompletionGuard.js','utf8');
const openSource=fs.readFileSync('src/v415ImportCarryoverGuard.js','utf8');
const statusUi=fs.readFileSync('public/v168-seven-business-status.js','utf8');
const activation=fs.readFileSync('src/v317CcslRecoveryPolicy.js','utf8');
assert.match(V415_RETROACTIVE_COMPLETION_GUARD_ID,/v415-current-member-processing-proof-v1/);
assert.match(V415_STALE_COMPLETION_REOPEN_ID,/v415-stale-completion-reopen-v1/);
assert.match(V415_IMPORT_OPEN_GUARD_ID,/v415-stale-completion-open-fallback-v1/);
assert.match(V416_FAST_FAILCLOSED_PROOF_ID,/v416-large-db-fast-failclosed-proof-v1/);
assert.match(V416_OPEN_CLOSURE_SEPARATION_ID,/v416-processing-complete-does-not-close-open-v1/);
assert.match(activation,/import '\.\/v415RetroactiveCompletionGuard\.js';/,'V415 must load before V317/V322 status registration');
assert.match(activation,/import '\.\/v415ImportCarryoverGuard\.js';/,'V415 import OPEN guard must load before web route registration');
assert.match(source,/UNIFIED_SNAPSHOT_IMMUTABLE_CLASSIFICATION_COUNTS/,'large-db proof must reuse immutable import classification counts before row regrouping');
assert.match(source,/includeMissingBills:false/,'status proof must use count-only V384 mode instead of building missing-bill diagnostics');
assert.match(source,/NO_CURRENT_COMPLETION_SNAPSHOT/,'missing current completion snapshot must fail closed before deep CCSL proof');
assert.match(source,/UPPER\(COALESCE\(f\.apiStatus,''\)\)='SUCCESS'/,'SHOPEE/WHPP completion must require persisted SUCCESS rows');
assert.match(source,/V416_FAIL_CLOSED_STATUS_PROOF/,'proof errors/unavailability must never preserve stale completed stages');
assert.match(source,/completedFastPath:[\s\S]*V415_PROOF_GUARD/,'legacy unified COMPLETED fast path must be proof-guarded');
assert.match(source,/status='failed'[\s\S]*V415_REOPEN_STALE_COMPLETION_MISSING_CURRENT_PROCESSING_PROOF/,'stale finished run pointers must become recoverable');
assert.match(source,/snapshotStatus:'IMPORTED'/,'stale WHPP mutable state must return to imported/pending state before a real rerun');
assert.match(openSource,/processingCompleteDoesNotCloseOpen:true/,'OPEN truth must be independent from processing-stage completion');
assert.match(openSource,/V416_CURRENT_MEMBERSHIP_MINUS_HARD_TERMINALS/,'zero OPEN must reconcile exact current membership minus hard terminals');
assert.match(openSource,/HARD_TERMINALS/,'OPEN fallback must preserve explicit hard terminal facts');
assert.match(statusUi,/v416-never-display-stale-completed-while-unconfirmed-v1/,'browser status must fail closed while persistence proof is unconfirmed');
assert.match(statusUi,/state: 'unknown'[\s\S]*complete: false/,'transient status must never carry forward a stale done stage');
assert.match(statusUi,/本轮处理已完成/,'UI must distinguish processing-cycle completion from business closure');
assert.doesNotMatch(source,/DELETE FROM (?:export_snapshots|business_export_snapshots|unified_snapshots|scan_results|track_events|final_rows|business_final_rows|business_scan_results|business_track_events|pod_locks|business_pod_locks)/,'V415/V416 must preserve business facts and audit snapshots');
assert.doesNotMatch(openSource,/(?:UPDATE|DELETE|INSERT)\s+(?:INTO\s+)?(?:carryover_open_items|shipment_current_state|unified_import_rows)/i,'V415/V416 import OPEN fallback must remain read-only');

const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE unified_import_batches(batchId TEXT,snapshotId TEXT,reportDate TEXT,status TEXT,createdAt TEXT);
CREATE TABLE unified_import_rows(snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT);
CREATE TABLE unified_snapshots(snapshotId TEXT,reportDate TEXT,status TEXT,payloadJson TEXT);
CREATE TABLE run_locks(reportDate TEXT,runId TEXT,status TEXT,currentStage TEXT,batchIndex INTEGER,totalBatches INTEGER,errorMessage TEXT,lockedAt TEXT,updatedAt TEXT,completedAt TEXT);
CREATE TABLE export_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,snapshotId TEXT,runId TEXT,reportDate TEXT,snapshotType TEXT,status TEXT,reconciliationStatus TEXT,generatedAt TEXT);
CREATE TABLE scan_results(reportDate TEXT,shipmentCode TEXT,updatedAt TEXT,scanCategory TEXT,orderStatus TEXT,isPod INTEGER);
CREATE TABLE final_rows(reportDate TEXT,shipmentCode TEXT,updatedAt TEXT,primaryCategory TEXT,category TEXT,qcConclusion TEXT);
CREATE TABLE pod_locks(shipmentCode TEXT);
CREATE TABLE business_states(businessType TEXT,valueJson TEXT,updatedAt TEXT);
CREATE TABLE business_run_locks(businessType TEXT,reportDate TEXT,runId TEXT,status TEXT,currentStage TEXT,batchIndex INTEGER,totalBatches INTEGER,errorMessage TEXT,lockedAt TEXT,updatedAt TEXT,completedAt TEXT);
CREATE TABLE business_export_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,snapshotId TEXT,businessType TEXT,reportDate TEXT,runId TEXT,status TEXT,reconciliationStatus TEXT,generatedAt TEXT);
CREATE TABLE business_final_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,apiStatus TEXT,updatedAt TEXT);
`);
const date='2026-09-01',boundary='2026-09-01T01:00:00.000Z',after='2026-09-01T02:00:00.000Z';
db.prepare("INSERT INTO unified_import_batches VALUES(?,?,?,?,?)").run('B1','S1',date,'VALID',boundary);
const classificationCounts={CE:1,CEAF:0,TBKH:0,ALI1688:0,SHOPEECN:1,SHOPEEVN:0,WHPP:1};
db.prepare('INSERT INTO unified_snapshots VALUES(?,?,?,?)').run('S1',date,'COMPLETED',JSON.stringify({classificationCounts}));
for(const [type,bill] of [['CE','CE1'],['SHOPEECN','CN1'],['WHPP','WH1']])db.prepare('INSERT INTO unified_import_rows VALUES(?,?,?,?)').run('S1',date,type,bill);
db.prepare('INSERT INTO run_locks VALUES(?,?,?,?,?,?,?,?,?,?)').run(date,'RC','finished','完成',1,1,'',after,after,after);
db.prepare("INSERT INTO export_snapshots(snapshotId,runId,reportDate,snapshotType,status,reconciliationStatus,generatedAt) VALUES(?,?,?,?,?,?,?)").run('XC','RC',date,'dashboard','VALID','COMPLETED',after);
for(const [type,runId] of [['SHOPEE','RS'],['WHPP','RW']])db.prepare('INSERT INTO business_run_locks VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(type,date,runId,'finished','完成',1,1,'',after,after,after);
db.prepare("INSERT INTO business_export_snapshots(snapshotId,businessType,reportDate,runId,status,reconciliationStatus,generatedAt) VALUES(?,?,?,?,?,?,?)").run('XS','SHOPEE',date,'RS','VALID','COMPLETED',after);

const auditBefore={
  ccsl:db.prepare('SELECT COUNT(*) count FROM export_snapshots').get().count,
  business:db.prepare('SELECT COUNT(*) count FROM business_export_snapshots').get().count
};
const staleProof=readV415CurrentProcessingProof({db,reportDate:date,force:true});
assert.equal(staleProof.counts.CCSL,1);
assert.equal(staleProof.counts.SHOPEE,1);
assert.equal(staleProof.counts.WHPP,1);
assert.equal(staleProof.membershipSource,'UNIFIED_SNAPSHOT_IMMUTABLE_CLASSIFICATION_COUNTS');
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
assert.deepEqual({
  ccsl:db.prepare('SELECT COUNT(*) count FROM export_snapshots').get().count,
  business:db.prepare('SELECT COUNT(*) count FROM business_export_snapshots').get().count
},auditBefore,'read/status guard must preserve old audit snapshots');

// A processed shipment may still be OPEN/unclosed. Processing completion and
// business closure are deliberately separate truths.
db.prepare('INSERT INTO scan_results VALUES(?,?,?,?,?,?)').run(date,'CE1',after,'NORMAL','60',0);
db.prepare('INSERT INTO final_rows VALUES(?,?,?,?,?,?)').run(date,'CE1',after,'派送中','派送中','正常处理');
db.prepare('INSERT INTO business_final_rows VALUES(?,?,?,?,?)').run('SHOPEE',date,'CN1','SUCCESS',after);
db.prepare('INSERT INTO business_final_rows VALUES(?,?,?,?,?)').run('WHPP',date,'WH1','SUCCESS',after);
const processedOpenProof=readV415CurrentProcessingProof({db,reportDate:date,force:true});
assert.equal(processedOpenProof.stages.CCSL.complete,true,'CCSL nonterminal but processed member may complete processing');
assert.equal(processedOpenProof.stages.SHOPEE.complete,true,'SHOPEE nonterminal but SUCCESS-processed member may complete processing');
assert.equal(processedOpenProof.stages.WHPP.complete,true,'WHPP nonterminal but SUCCESS-processed member may complete processing');
const accepted=applyV415StatusGuard(legacyFast,processedOpenProof);
assert.equal(accepted.complete,true,'processing completion must not require business closure');
const completedImport=applyV415ImportOpenGuard({reportDate:date,snapshotId:'S1',classificationCounts,summary:{validUniqueWaybills:3},carryover:{todayOpen:0,historicalOpen:0,currentOpen:0}},processedOpenProof,{db,hardClosed:0});
assert.equal(completedImport.carryover.currentOpen,3,'processing completion must never fabricate business closure; nonterminal current members remain OPEN');
assert.equal(completedImport.carryover.processingCompleteDoesNotCloseOpen,true);

console.log('[V416/V415] retroactive completion + OPEN separation smoke passed · immutable classification counts avoid large-db regrouping · stale or failed status proof never reuses completed badges · processing-cycle completion remains separate from business OPEN/closure truth · zero persisted OPEN reconciles current membership minus hard terminals · audit facts preserved');
