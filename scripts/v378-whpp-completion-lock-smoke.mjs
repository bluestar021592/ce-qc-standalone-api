import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v378-whpp-lock-'));
process.env.DATA_DIR=root;
process.env.DB_FILE=path.join(root,'v378.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.NODE_ENV='test';
process.env.CE_QC_DISABLE_V246_TRACKING='1';

const {getDb,closeDb}=await import('../src/db.js');
const {inspectV378WhppCompletionLock,V378_WHPP_COMPLETION_LOCK_REVISION}=await import('../src/v134WhppRunSupervisorPatch.js');
const {saveWhppDailyImport,saveWhppState}=await import('../src/whppStore.js');
const db=getDb();
const date='2026-08-24';
const now='2026-08-31T05:00:00.000Z';

// Seed a coherent normalized WHPP daily exactly the same way a genuine import
// does. Its original classificationSource deliberately is NOT a replay marker;
// V397 must rely only on V366's explicit preserveFinalizedLifecycle intent.
const seedState=saveWhppDailyImport({
  reportDate:date,
  sourceName:'8-24.xls',
  rows:[{shipmentCode:'CE0001',classificationSource:'SHIPMENT_PREFIX',classificationMatchedValue:'CE'}],
  batchId:'BATCH-0824-A',
  snapshotId:'SOURCE-0824-A'
});
assert.equal(seedState.processing.phase,'待处理');
assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?").get(date)?.count||0),1);

const finalizedSummary={
  batchId:'BATCH-0824-A',snapshotId:'SOURCE-0824-A',total:1,
  completed:true,snapshotStatus:'COMPLETED',reconciliationStatus:'COMPLETED',
  finalizedSnapshotId:'WHPP-FINAL-0824-A',finalizedAt:now
};
const finalizedState={
  ...seedState,
  businessType:'WHPP',
  reportDate:date,
  sourceName:'8-24.xls',
  batchId:'BATCH-0824-A',
  sourceSnapshotId:'SOURCE-0824-A',
  snapshotId:'WHPP-FINAL-0824-A',
  snapshotStatus:'COMPLETED',
  dailyReportReady:true,
  processing:{running:false,paused:false,phase:'完成'},
  lastRunSummary:null,
  lastRun:null
};
db.prepare(`INSERT INTO business_export_snapshots(snapshotId,businessType,reportDate,runId,payloadJson,generatedAt,createdAt)
  VALUES(?,?,?,?,?,?,?)`).run('WHPP-FINAL-0824-A','WHPP',date,'',JSON.stringify({state:finalizedState,status:'VALID',reconciliationStatus:'COMPLETED'}),now,now);
db.prepare("UPDATE business_daily_reports SET summaryJson=?,updatedAt=? WHERE businessType='WHPP' AND reportDate=?")
  .run(JSON.stringify(finalizedSummary),now,date);

// Give the current shipment a nonterminal live fact. A rehydrate-only replay must
// not regress it to PENDING_SCAN. A genuine direct re-import below is allowed to.
db.prepare("UPDATE shipment_current_state SET state='IN_TRANSIT',apiStatus='SUCCESS',stateJson=?,updatedAt=? WHERE shipmentCode='CE0001'")
  .run(JSON.stringify({marker:'KEEP_FINALIZED_FACT'}),now);

// Simulate a cold process whose mutable WHPP state points somewhere else. The
// persisted finalized daily + immutable snapshot must still be enough to restore
// the exact completed lifecycle.
saveWhppState({reportDate:'2026-08-25',dailyReportReady:true,processing:{running:false,paused:false,phase:'待处理'}});

const sameLifecycle=inspectV378WhppCompletionLock(date,{reportDate:date,sourceSnapshotId:'SOURCE-0824-A'},db);
assert.equal(sameLifecycle.revision,V378_WHPP_COMPLETION_LOCK_REVISION);
assert.equal(sameLifecycle.locked,true);
assert.equal(sameLifecycle.reason,'CURRENT_DAILY_ALREADY_FINALIZED');
assert.equal(sameLifecycle.finalizedSnapshotId,'WHPP-FINAL-0824-A');

// The persisted daily completion marker is authoritative. A transient in-memory
// source mismatch must never reopen a finalized daily before a real direct
// re-import replaces business_daily_reports.summaryJson.
const transientDifferentState=inspectV378WhppCompletionLock(date,{reportDate:date,sourceSnapshotId:'SOURCE-0824-B'},db);
assert.equal(transientDifferentState.sourceMatches,false);
assert.equal(transientDifferentState.locked,true);
assert.equal(transientDifferentState.reason,'CURRENT_DAILY_ALREADY_FINALIZED');

// V366 can replay the already-normalized WHPP membership while staging a new
// six-business unified snapshot. The original row still says SHIPMENT_PREFIX;
// only the explicit preserveFinalizedLifecycle flag identifies this as rehydrate.
const replayState=saveWhppDailyImport({
  reportDate:date,
  sourceName:'8-24-replayed.xls',
  rows:[{shipmentCode:'CE0001',classificationSource:'SHIPMENT_PREFIX',classificationMatchedValue:'CE'}],
  batchId:'BATCH-0824-REPLAY',
  snapshotId:'SOURCE-0824-REPLAY',
  preserveFinalizedLifecycle:true
});
assert.equal(replayState.reportDate,date);
assert.equal(replayState.dailyReportReady,true);
assert.equal(replayState.snapshotId,'WHPP-FINAL-0824-A');
assert.equal(replayState.snapshotStatus,'COMPLETED');
assert.equal(replayState.processing.running,false);
assert.equal(replayState.processing.phase,'完成');
const afterReplay=inspectV378WhppCompletionLock(date,replayState,db);
assert.equal(afterReplay.locked,true);
assert.equal(afterReplay.finalizedSnapshotId,'WHPP-FINAL-0824-A');
const replaySummary=JSON.parse(db.prepare("SELECT summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=?").get(date).summaryJson);
assert.equal(replaySummary.completed,true);
assert.equal(replaySummary.snapshotStatus,'COMPLETED');
assert.equal(replaySummary.finalizedSnapshotId,'WHPP-FINAL-0824-A');
assert.equal(replaySummary.snapshotId,'SOURCE-0824-A');
const replayCurrent=db.prepare("SELECT state,apiStatus,stateJson FROM shipment_current_state WHERE shipmentCode='CE0001'").get();
assert.equal(replayCurrent.state,'IN_TRANSIT','rehydrate-only replay must not regress live state to PENDING_SCAN');
assert.equal(replayCurrent.apiStatus,'SUCCESS');
assert.equal(JSON.parse(replayCurrent.stateJson).marker,'KEEP_FINALIZED_FACT');
assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?").get(date)?.count||0),1,'rehydrate-only replay must not rewrite normalized membership');

// A genuine direct parser same-date re-import is authoritative. It omits the
// preserve flag, durably replaces the old completion marker and opens a new run.
const directState=saveWhppDailyImport({
  reportDate:date,
  sourceName:'8-24-direct.xls',
  rows:[{shipmentCode:'CE0001',classificationSource:'SHIPMENT_PREFIX',classificationMatchedValue:'CE'}],
  batchId:'BATCH-0824-B',
  snapshotId:'SOURCE-0824-B'
});
assert.equal(directState.reportDate,date);
assert.equal(directState.dailyReportReady,true);
assert.equal(directState.processing.phase,'待处理');
const afterReimport=inspectV378WhppCompletionLock(date,directState,db);
assert.equal(afterReimport.locked,false);
assert.equal(afterReimport.finalized,false);
assert.equal(afterReimport.reason,'CURRENT_DAILY_NOT_FINALIZED');
const directSummary=JSON.parse(db.prepare("SELECT summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=?").get(date).summaryJson);
assert.equal(directSummary.snapshotId,'SOURCE-0824-B');
assert.equal(directSummary.completed,undefined);
assert.equal(directSummary.finalizedSnapshotId,undefined);
assert.equal(db.prepare("SELECT state FROM shipment_current_state WHERE shipmentCode='CE0001'").get()?.state,'PENDING_SCAN','genuine direct re-import may open a fresh nonterminal lifecycle');

const source=fs.readFileSync(new URL('../src/v134WhppRunSupervisorPatch.js',import.meta.url),'utf8');
assert.match(source,/V378_WHPP_COMPLETION_LOCK_REVISION/);
assert.match(source,/locked: finalized/,
  'durable normalized-daily finalization must remain authoritative until a genuine direct re-import replaces the marker');
assert.match(source,/const completionLock = inspectV378WhppCompletionLock\(state\.reportDate, state\)/,
  'every explicit WHPP launch must check the durable daily finalization marker before CE network work');
assert.match(source,/if \(persistedCompletion\.locked\) return false;/,
  'backend 5s continuity owner must not restart a finalized WHPP lifecycle');
assert.match(source,/if \(afterPersistedCompletion\.locked\) return false;/,
  'backend continuity must recheck the lock after recovery before launching');
assert.match(source,/error\?\.code === 'WHPP_ALREADY_FINALIZED'/,
  'duplicate start/resume must be a completed no-op instead of a new run');
assert.match(source,/accepted: false,[\s\S]*completed: true/,
  'duplicate finalized start must answer success without entering processing');

const store=fs.readFileSync(new URL('../src/whppStore.js',import.meta.url),'utf8');
assert.match(store,/preserveFinalizedLifecycle = false/,
  'WHPP storage must require explicit rehydrate intent instead of inferring it from mutable row fields');
assert.match(store,/if \(preserveFinalizedLifecycle === true\)/,
  'only an explicit V366 rehydrate may preserve a finalized lifecycle');
assert.match(store,/WHPP_FINALIZED_REHYDRATE_SNAPSHOT_MISSING/,
  'missing immutable completion evidence must fail closed instead of reopening WHPP');
assert.match(store,/WHPP_FINALIZED_REHYDRATE_NOOP/,
  'completed preserved membership must restore immutable state without rewriting the daily lifecycle');

const importer=fs.readFileSync(new URL('../src/v42WhppPatch.js',import.meta.url),'utf8');
assert.match(importer,/preserveFinalizedLifecycle:\s*true/,
  'V366 preserved-membership branch must explicitly request finalized lifecycle preservation');
assert.match(importer,/const whppLifecycleChanged = !\(preservedWhpp\.present && String\(whppState\.snapshotStatus \|\| ''\)\.toUpperCase\(\) === 'COMPLETED'\)/,
  'V366 must distinguish a finalized no-op replay from an incomplete/new WHPP lifecycle');
assert.match(importer,/invalidateMutableSameDatePointers\(parsed\.reportDate, \{ whppChanged: whppLifecycleChanged \}\)/,
  'V366 must not delete WHPP run/history pointers when the finalized lifecycle was preserved');

const runner=fs.readFileSync(new URL('../public/v67-resilient-run-guard.js',import.meta.url),'utf8');
assert.match(runner,/2026-08-31-v396-sticky-three-stage-completion-v1/,
  'V396 must keep a verified same-page completion latch so the 2.5s watch cannot re-enter a finished lifecycle');
assert.match(runner,/2026-08-31-v396-live-import-carry-refresh-v1/,
  'V396 must refresh the import summary from live SQLite carry truth after all three stages finish');
assert.match(runner,/async function readWhppCompletionLock\(target\)/,
  'V67 must read the persisted V378 WHPP completion lock before trusting a transient summary');
assert.match(runner,/if \(persistedLock\) return persistedLock;/,
  'persisted WHPP completion must short-circuit transient summary lag');
assert.match(runner,/completionLatchMatches\(target\)/,
  'visible-import auto recovery must suppress same-page duplicate completion re-entry');
assert.match(runner,/\[data-testid="combined-daily-import"\][\s\S]*clearCompletionLatch\(\)/,
  'an explicit new daily import must clear only the browser completion latch so same-date reimports can run again');
assert.match(runner,/\/api\/import\/unified-latest\?compact=1/,
  'completed runs must reread current today/historical OPEN counts instead of leaving the import-time carry summary stale');
assert.match(runner,/const truth = await canonicalStageTruth\(stage, target\);[\s\S]*if \(truth\.done\)[\s\S]*continue;[\s\S]*setUnifiedStage\(stage\.key, true, target\);/,
  'a canonical-complete CCSL/SHOPEE/WHPP stage must never be painted as processing before its completion check');

closeDb();
fs.rmSync(root,{recursive:true,force:true});
console.log('[V397/V396/V378] WHPP finalized replay lock passed · V366 explicit rehydrate is a no-op · completed live facts stay immutable · cold start restores final snapshot · genuine direct re-import alone unlocks · completed stages cannot auto-reenter');
