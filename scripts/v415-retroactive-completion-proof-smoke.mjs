import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  V415_RETROACTIVE_COMPLETION_GUARD_ID,
  V415_STALE_COMPLETION_REOPEN_ID,
  readV415CurrentProcessingProof,
  applyV415StatusGuard
} from '../src/v415RetroactiveCompletionGuard.js';
import {
  V415_IMPORT_OPEN_GUARD_ID,
  applyV415ImportOpenGuard
} from '../src/v415ImportCarryoverGuard.js';

execFileSync(process.execPath,['--check','src/v415RetroactiveCompletionGuard.js'],{stdio:'pipe'});
execFileSync(process.execPath,['--check','src/v415ImportCarryoverGuard.js'],{stdio:'pipe'});
const source=fs.readFileSync('src/v415RetroactiveCompletionGuard.js','utf8');
const openSource=fs.readFileSync('src/v415ImportCarryoverGuard.js','utf8');
const activation=fs.readFileSync('src/v317CcslRecoveryPolicy.js','utf8');
assert.match(V415_RETROACTIVE_COMPLETION_GUARD_ID,/v415-current-member-processing-proof-v1/);
assert.match(V415_STALE_COMPLETION_REOPEN_ID,/v415-stale-completion-reopen-v1/);
assert.match(V415_IMPORT_OPEN_GUARD_ID,/v415-stale-completion-open-fallback-v1/);
assert.match(activation,/import '\.\/v415RetroactiveCompletionGuard\.js';/,'V415 must load before V317/V322 status registration');
assert.match(activation,/import '\.\/v415ImportCarryoverGuard\.js';/,'V415 import OPEN guard must load before web route registration');
assert.match(source,/readV384CcslProcessingProof/,'CCSL must reuse V384 current-member proof');
assert.match(source,/UPPER\(COALESCE\(f\.apiStatus,''\)\)='SUCCESS'/,'SHOPEE/WHPP completion must require persisted SUCCESS rows');
assert.match(source,/completedFastPath:[\s\S]*V415_PROOF_GUARD/,'legacy unified COMPLETED fast path must be proof-guarded');
assert.match(source,/status='failed'[\s\S]*V415_REOPEN_STALE_COMPLETION_MISSING_CURRENT_PROCESSING_PROOF/,'stale finished run pointers must become recoverable');
assert.match(source,/snapshotStatus:'IMPORTED'/,'stale WHPP mutable state must return to imported/pending state before a real rerun');
assert.match(openSource,/V415_CURRENT_MEMBERSHIP_OPEN_FALLBACK/,'stale zero OPEN display must have a current-membership fallback');
assert.match(openSource,/HARD_TERMINALS/,'OPEN fallback must preserve explicit hard terminal facts');
assert.doesNotMatch(source,/DELETE FROM (?:export_snapshots|business_export_snapshots|unified_snapshots|scan_results|track_events|final_rows|business_final_rows|business_scan_results|business_track_events|pod_locks|business_pod_locks)/,'V415 must preserve business facts and audit snapshots');
assert.doesNotMatch(openSource,/(?:UPDATE|DELETE|INSERT)\s+(?:INTO\s+)?(?:carryover_open_items|shipment_current_state|unified_import_rows)/i,'V415 import OPEN fallback must remain read-only');

const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE unified_import_batches(batchId TEXT,snapshotId TEXT,reportDate TEXT,status TEXT,createdAt TEXT);
CREATE TABLE unified_import_rows(snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT);
CREATE TABLE run_locks(reportDate TEXT,runId TEXT,status TEXT,currentStage TEXT,batchIndex INTEGER,totalBatches INTEGER,errorMessage TEXT,lockedAt TEXT,updatedAt TEXT,completedAt TEXT);
CREATE TABLE export_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,snapshotId TEXT,runId TEXT,reportDate TEXT,snapshotType TEXT,status TEXT,reconciliationStatus TEXT,generatedAt TEXT);
CREATE TABLE scan_results(reportDate TEXT,shipmentCode TEXT,updatedAt TEXT,scanCategory TEXT,orderStatus TEXT,isPod INTEGER);
CREATE TABLE final_rows(reportDate TEXT,shipmentCode TEXT,updatedAt TEXT,primaryCategory TEXT,category TEXT,qcConclusion TEXT);
CREATE TABLE pod_locks(shipmentCode TEXT);
CREATE TABLE business_run_locks(businessType TEXT,reportDate TEXT,runId TEXT,status TEXT,currentStage TEXT,batchIndex INTEGER,totalBatches INTEGER,errorMessage TEXT,lockedAt TEXT,updatedAt TEXT,completedAt TEXT);
CREATE TABLE business_export_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,snapshotId TEXT,businessType TEXT,reportDate TEXT,runId TEXT,status TEXT,reconciliationStatus TEXT,generatedAt TEXT);
CREATE TABLE business_final_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,apiStatus TEXT,updatedAt TEXT);
`);
const date='2026-09-01',boundary='2026-09-01T01:00:00.000Z',after='2026-09-01T02:00:00.000Z';
db.prepare("INSERT INTO unified_import_batches VALUES(?,?,?,?,?)").run('B1','S1',date,'VALID',boundary);
for(const [type,bill] of [['CE','CE1'],['SHOPEECN','CN1'],['WHPP','WH1']])db.prepare('INSERT INTO unified_import_rows VALUES(?,?,?,?)').run('S1',date,type,bill);
db.prepare('INSERT INTO run_locks VALUES(?,?,?,?,?,?,?,?,?,?)').run(date,'RC','finished','完成',1,1,'',after,after,after);
db.prepare("INSERT INTO export_snapshots(snapshotId,runId,reportDate,snapshotType,status,reconciliationStatus,generatedAt) VALUES(?,?,?,?,?,?,?)").run('XC','RC',date,'dashboard','VALID','COMPLETED',after);
for(const [type,runId] of [['SHOPEE','RS'],['WHPP','RW']])db.prepare('INSERT INTO business_run_locks VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(type,date,runId,'finished','完成',1,1,'',after,after,after);
db.prepare("INSERT INTO business_export_snapshots(snapshotId,businessType,reportDate,runId,status,reconciliationStatus,generatedAt) VALUES(?,?,?,?,?,?,?)").run('XS','SHOPEE',date,'RS','VALID','COMPLETED',after);

const auditBefore={
  ccsl:db.prepare('SELECT COUNT(*) count FROM export_snapshots').get().count,
  business:db.prepare('SELECT COUNT(*) count FROM business_export_snapshots').get().count
};
const staleProof=readV415CurrentProcessingProof({db,reportDate:date});
assert.equal(staleProof.counts.CCSL,1);
assert.equal(staleProof.counts.SHOPEE,1);
assert.equal(staleProof.counts.WHPP,1);
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
const staleImport=applyV415ImportOpenGuard({reportDate:date,carryover:{todayOpen:0,historicalOpen:2,currentOpen:2}},staleProof,{db,hardClosed:0});
assert.equal(staleImport.carryover.todayOpen,3,'rejected stale completion with zero persisted OPEN must expose all unclosed current fixture members');
assert.equal(staleImport.carryover.currentOpen,5,'current OPEN must equal repaired today + persisted historical');
assert.equal(staleImport.carryover.source,'V415_CURRENT_MEMBERSHIP_OPEN_FALLBACK');
const terminalAware=applyV415ImportOpenGuard({reportDate:date,carryover:{todayOpen:0,historicalOpen:0,currentOpen:0}},staleProof,{db,hardClosed:1});
assert.equal(terminalAware.carryover.todayOpen,2,'hard terminal facts must never be reopened by display fallback');
assert.deepEqual({
  ccsl:db.prepare('SELECT COUNT(*) count FROM export_snapshots').get().count,
  business:db.prepare('SELECT COUNT(*) count FROM business_export_snapshots').get().count
},auditBefore,'read/status guard must preserve old audit snapshots');

// A processed shipment may still be OPEN/unclosed. Completion means every current
// member has real processing evidence, not that every shipment must POD/return.
db.prepare('INSERT INTO scan_results VALUES(?,?,?,?,?,?)').run(date,'CE1',after,'NORMAL','60',0);
db.prepare('INSERT INTO final_rows VALUES(?,?,?,?,?,?)').run(date,'CE1',after,'派送中','派送中','正常处理');
db.prepare('INSERT INTO business_final_rows VALUES(?,?,?,?,?)').run('SHOPEE',date,'CN1','SUCCESS',after);
db.prepare('INSERT INTO business_final_rows VALUES(?,?,?,?,?)').run('WHPP',date,'WH1','SUCCESS',after);
const processedOpenProof=readV415CurrentProcessingProof({db,reportDate:date});
assert.equal(processedOpenProof.stages.CCSL.complete,true,'CCSL nonterminal but processed member may complete processing');
assert.equal(processedOpenProof.stages.SHOPEE.complete,true,'SHOPEE nonterminal but SUCCESS-processed member may complete processing');
assert.equal(processedOpenProof.stages.WHPP.complete,true,'WHPP nonterminal but SUCCESS-processed member may complete processing');
const accepted=applyV415StatusGuard(legacyFast,processedOpenProof);
assert.equal(accepted.complete,true,'processing completion must not require business closure');
const completedImport=applyV415ImportOpenGuard({reportDate:date,carryover:{todayOpen:0,historicalOpen:0,currentOpen:0}},processedOpenProof,{db,hardClosed:0});
assert.equal(completedImport.carryover.currentOpen,0,'completed processing must not fabricate OPEN merely because shipments remain nonterminal in this processing-proof fixture');

console.log('[V415] retroactive completion proof smoke passed · stale unified/business/WHPP COMPLETED markers cannot bypass current-member proof · zero persisted OPEN falls back read-only to current membership minus hard terminals · legacy audit snapshots preserved · legitimately processed OPEN shipments may still complete processing');
