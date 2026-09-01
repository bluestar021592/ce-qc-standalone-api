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

db.prepare("UPDATE shipment_current_state SET state='IN_TRANSIT',apiStatus='SUCCESS',stateJson=?,updatedAt=? WHERE shipmentCode='CE0001'")
  .run(JSON.stringify({marker:'KEEP_FINALIZED_FACT'}),now);

saveWhppState({reportDate:'2026-08-25',dailyReportReady:true,processing:{running:false,paused:false,phase:'待处理'}});

const sameLifecycle=inspectV378WhppCompletionLock(date,{reportDate:date,sourceSnapshotId:'SOURCE-0824-A'},db);
assert.equal(sameLifecycle.revision,V378_WHPP_COMPLETION_LOCK_REVISION);
assert.equal(sameLifecycle.locked,true);
assert.equal(sameLifecycle.reason,'CURRENT_DAILY_ALREADY_FINALIZED');
assert.equal(sameLifecycle.finalizedSnapshotId,'WHPP-FINAL-0824-A');

const transientDifferentState=inspectV378WhppCompletionLock(date,{reportDate:date,sourceSnapshotId:'SOURCE-0824-B'},db);
assert.equal(transientDifferentState.sourceMatches,false);
assert.equal(transientDifferentState.locked,true);
assert.equal(transientDifferentState.reason,'CURRENT_DAILY_ALREADY_FINALIZED');

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
assert.equal(replayState.finalizedLifecyclePreserved,true);
assert.equal(replayState.finalizedLifecyclePreserveReason,'EXPLICIT_REHYDRATE');
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

// V399: a normal direct same-date reupload containing the exact same WHPP
// membership is also a no-op. The workbook may be uploaded again, but a completed
// WHPP lifecycle must not be reopened just because those same rows appeared again.
const identicalDirectState=saveWhppDailyImport({
  reportDate:date,
  sourceName:'8-24-direct-same.xls',
  rows:[{shipmentCode:'CE0001',classificationSource:'SHIPMENT_PREFIX',classificationMatchedValue:'CE'}],
  batchId:'BATCH-0824-SAME',
  snapshotId:'SOURCE-0824-SAME'
});
assert.equal(identicalDirectState.snapshotId,'WHPP-FINAL-0824-A');
assert.equal(identicalDirectState.snapshotStatus,'COMPLETED');
assert.equal(identicalDirectState.processing.phase,'完成');
assert.equal(identicalDirectState.finalizedLifecyclePreserved,true);
assert.equal(identicalDirectState.finalizedLifecyclePreserveReason,'IDENTICAL_MEMBERSHIP_REUPLOAD');
const afterIdenticalDirect=inspectV378WhppCompletionLock(date,identicalDirectState,db);
assert.equal(afterIdenticalDirect.locked,true,'identical direct reupload must keep the durable completion lock');
const identicalSummary=JSON.parse(db.prepare("SELECT summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=?").get(date).summaryJson);
assert.equal(identicalSummary.finalizedSnapshotId,'WHPP-FINAL-0824-A');
assert.equal(identicalSummary.completed,true);
assert.equal(db.prepare("SELECT state FROM shipment_current_state WHERE shipmentCode='CE0001'").get()?.state,'IN_TRANSIT','identical direct reupload must keep current WHPP facts immutable');

// A genuine membership change remains authoritative and is the only same-date
// direct reimport that may open a fresh WHPP lifecycle.
const changedState=saveWhppDailyImport({
  reportDate:date,
  sourceName:'8-24-direct-changed.xls',
  rows:[
    {shipmentCode:'CE0001',classificationSource:'SHIPMENT_PREFIX',classificationMatchedValue:'CE'},
    {shipmentCode:'CE0002',classificationSource:'SHIPMENT_PREFIX',classificationMatchedValue:'CE'}
  ],
  batchId:'BATCH-0824-B',
  snapshotId:'SOURCE-0824-B'
});
assert.equal(changedState.reportDate,date);
assert.equal(changedState.dailyReportReady,true);
assert.equal(changedState.processing.phase,'待处理');
assert.notEqual(changedState.snapshotStatus,'COMPLETED');
const afterChanged=inspectV378WhppCompletionLock(date,changedState,db);
assert.equal(afterChanged.locked,false);
assert.equal(afterChanged.finalized,false);
assert.equal(afterChanged.reason,'CURRENT_DAILY_NOT_FINALIZED');
const changedSummary=JSON.parse(db.prepare("SELECT summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=?").get(date).summaryJson);
assert.equal(changedSummary.snapshotId,'SOURCE-0824-B');
assert.equal(changedSummary.completed,undefined);
assert.equal(changedSummary.finalizedSnapshotId,undefined);
assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?").get(date)?.count||0),2);
assert.equal(db.prepare("SELECT state FROM shipment_current_state WHERE shipmentCode='CE0001'").get()?.state,'PENDING_SCAN','changed membership may open a fresh nonterminal lifecycle');

const source=fs.readFileSync(new URL('../src/v134WhppRunSupervisorPatch.js',import.meta.url),'utf8');
assert.match(source,/V378_WHPP_COMPLETION_LOCK_REVISION/);
assert.match(source,/locked: finalized/,
  'durable normalized-daily finalization must remain authoritative until a real membership change replaces the marker');
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
  'WHPP storage keeps explicit rehydrate compatibility');
assert.match(store,/inspectExistingWhppDaily/,
  'WHPP storage must compare same-date shipment membership before reopening a finalized lifecycle');
assert.match(store,/existingDaily\.finalized && \(preserveFinalizedLifecycle === true \|\| existingDaily\.identicalMembership\)/,
  'finalized WHPP must stay completed for explicit rehydrate or exact identical membership reupload');
assert.match(store,/IDENTICAL_MEMBERSHIP_REUPLOAD/,
  'identical direct reupload must be observable as a finalized no-op');
assert.match(store,/WHPP_FINALIZED_REHYDRATE_SNAPSHOT_MISSING/,
  'missing immutable completion evidence must fail closed instead of reopening WHPP');
assert.match(store,/WHPP_FINALIZED_REHYDRATE_NOOP/,
  'completed membership must restore immutable state without rewriting the daily lifecycle');

const importer=fs.readFileSync(new URL('../src/v42WhppPatch.js',import.meta.url),'utf8');
assert.match(importer,/preserveFinalizedLifecycle:\s*true/,
  'V366 preserved-membership branch must explicitly request finalized lifecycle preservation');
assert.match(importer,/IDENTICAL_FINALIZED_WHPP_MEMBERSHIP_REUPLOAD_NOOP/,
  'V366 must expose an identical finalized WHPP reupload as a no-op source');
assert.match(importer,/const whppLifecycleChanged = String\(whppState\.snapshotStatus \|\| ''\)\.toUpperCase\(\) !== 'COMPLETED'/,
  'V366 must preserve WHPP run/history pointers whenever storage returned the completed finalized lifecycle');
assert.match(importer,/invalidateMutableSameDatePointers\(parsed\.reportDate, \{ whppChanged: whppLifecycleChanged \}\)/,
  'V366 must not delete WHPP run/history pointers when the finalized lifecycle was preserved');

const ui=fs.readFileSync(new URL('../public/v68-whpp-classification-stability.js',import.meta.url),'utf8');
assert.match(ui,/v399-seven-business-import-total-v1/,
  'V399 must own the seven-business import total display');
assert.match(ui,/日报导入完成，\\s\*共\\s\*\[\\d,\]\+\\s\*个唯一运单/,
  'upload success text must be rewritten from six-business total to seven-business total');
assert.match(ui,/NodeFilter\.SHOW_TEXT/,
  'status repair must cover the green status text even when it is not wrapped in a paragraph');

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
  'an explicit new daily import clears the browser latch, while the persisted identical-membership lock remains authoritative');
assert.match(runner,/\/api\/import\/unified-latest\?compact=1/,
  'completed runs must reread current today/historical OPEN counts instead of leaving the import-time carry summary stale');
assert.match(runner,/const truth = await canonicalStageTruth\(stage, target\);[\s\S]*if \(truth\.done\)[\s\S]*continue;[\s\S]*setUnifiedStage\(stage\.key, true, target\);/,
  'a canonical-complete CCSL/SHOPEE/WHPP stage must never be painted as processing before its completion check');

closeDb();
fs.rmSync(root,{recursive:true,force:true});
console.log('[V399/V397/V396/V378] WHPP finalized reupload lock passed · explicit rehydrate no-op · identical direct membership reupload no-op · only membership change unlocks · seven-business import total display gated · completed stages cannot auto-reenter');