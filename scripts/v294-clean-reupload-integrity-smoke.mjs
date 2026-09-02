import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// V377's same-date lifecycle regression is a real isolated-SQLite runtime gate,
// not only a source-string contract. Run it here because this smoke is directly
// executed by test:golive before Managed Launcher is allowed to install.
execFileSync(process.execPath, ['scripts/v375-import-metadata-zero-shopee-smoke.mjs'], { stdio: 'inherit' });

for (const file of [
  'src/v317CcslIncompleteRecoveryPatch.js',
  'src/v311ShopeeIncompleteRecoveryPatch.js',
  'src/v137WhppUnifiedBusinessStatePatch.js',
  'src/v132WhppFastIntegrationPatch.js',
  'src/v322WebAvailabilityPatch.js',
  'public/v159-current-import-stability.js',
  'public/v168-seven-business-status.js'
]) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });

const cleanSource = fs.readFileSync(new URL('../src/v294CleanReuploadIntegrity.js', import.meta.url), 'utf8');
const activationSource = fs.readFileSync(new URL('../src/v147TrackTimeoutConfig.js', import.meta.url), 'utf8');
const purgeSource = fs.readFileSync(new URL('../src/dataPurge.js', import.meta.url), 'utf8');
const purgeWorkerSource = fs.readFileSync(new URL('./CE_QC_PurgeDeleteWorker.mjs', import.meta.url), 'utf8');
const bootstrapSource = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
const ccslRecoverySource = fs.readFileSync(new URL('../src/v317CcslIncompleteRecoveryPatch.js', import.meta.url), 'utf8');
const shopeeRecoverySource = fs.readFileSync(new URL('../src/v311ShopeeIncompleteRecoveryPatch.js', import.meta.url), 'utf8');
const whppStateSource = fs.readFileSync(new URL('../src/v137WhppUnifiedBusinessStatePatch.js', import.meta.url), 'utf8');
const whppCanonicalSource = fs.readFileSync(new URL('../src/v132WhppFastIntegrationPatch.js', import.meta.url), 'utf8');
const v322StatusSource = fs.readFileSync(new URL('../src/v322WebAvailabilityPatch.js', import.meta.url), 'utf8');
const currentImportUiSource = fs.readFileSync(new URL('../public/v159-current-import-stability.js', import.meta.url), 'utf8');
const sevenBusinessSource = fs.readFileSync(new URL('../public/v168-seven-business-status.js', import.meta.url), 'utf8');

assert.match(cleanSource, /qc_tracking_ledger/);
assert.match(cleanSource, /qc_tracking_audit/);
assert.match(cleanSource, /installV294CleanSlateTargets\(\)/);
assert.match(activationSource, /v294CleanReuploadIntegrity\.js/);
assert.match(purgeSource, /BUSINESS_DATA_TABLES/);
assert.match(purgeSource, /BUSINESS_DATA_TABLES\.filter/);
assert.match(purgeWorkerSource, /v294CleanReuploadIntegrity\.js/);
assert.match(purgeWorkerSource, /BUSINESS_DATA_TABLES\.filter/);

// Same-date reupload keeps immutable audit snapshots. Completion must therefore
// be tied to the newly-created current run for CCSL/SHOPEE, never to any older
// same-date snapshot. V377 additionally binds both run and snapshot freshness to
// the newest VALID unified import createdAt boundary. The legacy WHPP business-
// state route continues to keep its own current-run binding rule.
assert.match(ccslRecoverySource, /WHERE reportDate=\? AND runId=\? AND snapshotType='dashboard'/);
assert.ok(ccslRecoverySource.includes('V377_CCSL_IMPORT_LIFECYCLE_ID'), 'CCSL recovery must expose the V377 import lifecycle policy');
assert.ok(
  ccslRecoverySource.includes("latestValidSnapshot(db,date,lock?.runId||'',validBatch?.createdAt||'')"),
  'CCSL completion lookup must include the newest VALID import createdAt boundary'
);
assert.ok(ccslRecoverySource.includes('retireStaleCcslRunPointers'), 'CCSL prepare must retire stale pre-import run pointers without deleting audit snapshots');
assert.match(shopeeRecoverySource, /businessType=\? AND reportDate=\? AND runId=\?/);
assert.ok(shopeeRecoverySource.includes('V377_SHOPEE_IMPORT_LIFECYCLE_ID'), 'SHOPEE recovery must expose the V377 import lifecycle policy');
assert.ok(
  shopeeRecoverySource.includes("validSnapshot(db,date,lock?.runId||'',boundary)"),
  'SHOPEE completion lookup must include the newest VALID import createdAt boundary'
);
assert.ok(shopeeRecoverySource.includes('retireStaleShopeeRunPointers'), 'SHOPEE prepare must retire stale pre-import run pointers without deleting audit snapshots');
assert.match(whppStateSource, /businessType='WHPP' AND reportDate=\? AND runId=\?/);
assert.match(whppStateSource, /const completed=Boolean\(snapshot\)/);
assert.doesNotMatch(whppStateSource, /const completed=Boolean\(snapshot\|\|history\)/);

// Visible WHPP completion is different: after an identical same-day reupload,
// the current normalized membership may already have final evidence for every
// member. A finalized current lifecycle/daily marker is authoritative, while
// full member evidence and exact zero remain safe zero-work completion paths.
assert.match(whppCanonicalSource, /const memberCount=uniqueRows\(membershipRows\)\.length/);
assert.match(whppCanonicalSource, /function completionDecision\(/,
  'V132 must centralize WHPP completion semantics instead of duplicating stale inline predicates');
assert.match(whppCanonicalSource, /standard\?\.finalized/,
  'V132 must honor the persistent current daily finalization marker');
assert.match(whppCanonicalSource, /lifecycle\?\.complete/,
  'V132 must honor the current finalized WHPP lifecycle for the same cohort');
assert.match(whppCanonicalSource, /num\(memberCount\)===0&&Boolean\(standard\?\.present\|\|historyPresent\)/,
  'V132 must retain explicit exact-zero completion semantics');
assert.match(whppCanonicalSource, /num\(memberCount\)>0&&num\(finalEvidenceRows\)>=num\(memberCount\)/,
  'V132 must still accept full current-member final evidence as zero-work completion');
assert.match(whppCanonicalSource, /completionDecision\(\{standard,memberCount,finalEvidenceRows:facts\.length,historyPresent:Boolean\(history\),lifecycle,retryPending\}\)/,
  'visible WHPP summary must use the same centralized lifecycle-aware completion decision');
assert.match(whppCanonicalSource, /Cache-Control','no-store/);

// V168 must no longer run three separate recovery/summary reads. The one V322
// persisted status read is allowed only because V322 itself carries the exact
// current-cohort WHPP completion contract above, rejects stale same-date cohorts,
// and fails closed when persisted status cannot be read.
assert.match(sevenBusinessSource, /businessType: 'ALL', reportDate: target/,
  'V168 must request all persisted three-stage truth in one exact-date read');
assert.match(sevenBusinessSource, /\/api\/v33\/run-progress\?\$\{query\.toString\(\)\}/,
  'V168 must use the single persisted status route');
assert.doesNotMatch(sevenBusinessSource, /\/api\/v132\/whpp-fast-summary|\/api\/v311\/shopee-recovery|\/api\/v317\/ccsl-recovery/,
  'V168 must not trigger separate heavy recovery/WHPP summary reads');
assert.doesNotMatch(sevenBusinessSource, /\/api\/business-state\/WHPP/,
  'V168 must not use the legacy snapshot-only WHPP status route');
assert.match(v322StatusSource, /V322_WHPP_COMPLETION_PARITY_ID='2026-09-02-v322-whpp-v132-current-cohort-parity-v1'/,
  'V322 must explicitly own V132-equivalent WHPP current-cohort completion semantics');
assert.match(v322StatusSource, /function whppCompletionDecision\(/);
for (const source of ['CURRENT_DAILY_FINALIZATION_MARKER','CURRENT_FINALIZED_WHPP_STATE','EXACT_ZERO_CURRENT_UNIFIED_MEMBERSHIP','FULL_MEMBER_FINAL_EVIDENCE']) {
  assert.ok(v322StatusSource.includes(source), `V322 WHPP completion parity missing ${source}`);
}
assert.match(v322StatusSource, /const standardCurrent=Boolean\(standard\.present&&\(!batchSnapshotId\|\|!exactUnified\.ok\|\|standard\.memberCount===exactUnified\.count\)\)/,
  'V322 must reject a stale same-date standard cohort when current unified WHPP membership changed');
assert.match(v322StatusSource, /EXISTS\(SELECT 1 FROM business_final_rows f[\s\S]*f\.businessType='WHPP' AND f\.shipmentCode=d\.shipmentCode AND f\.reportDate=\?\)/,
  'V322 full-evidence completion must stay bound to the exact current WHPP members');
assert.match(v322StatusSource, /ok:false,code:'V322_PERSISTED_STATUS_READ_FAILED'/,
  'V322 unknown status must fail closed so run controls cannot unlock on a read failure');
assert.doesNotMatch(v322StatusSource, /scan_results|business_scan_results|business_track_events|track_events/,
  'V322 status must not reconstruct scan or trajectory facts');

// A successful fresh import owns the active selected date. This prevents the
// homepage range owner from immediately repainting the new 8/15 import with old
// 8/14 range cards, while the one-time gate leaves later historical queries alone.
for (const id of ['reportDate','topRangeFrom','topRangeTo','dashboardRangeFrom','dashboardRangeTo']) {
  assert.ok(currentImportUiSource.includes(`'${id}'`), `V159 must synchronize ${id} to the fresh import date`);
}
assert.match(currentImportUiSource, /syncSelectedDateToCurrentImport\(\{force:true\}\)/);
assert.match(currentImportUiSource, /__CE_QC_V253_DASHBOARD_FAST_OWNER__\?\.refresh/);
assert.match(currentImportUiSource, /selectedDateSyncDone/);

// A raw first-occurrence search for importPhase('server', ...) is misleading because
// the helper function is defined before the startup sequence. Verify both semantics:
// (1) the awaited V147 activation happens before bootstrap invokes the server loader;
// (2) inside the actual importServerInteractiveFirst function body, server.js is loaded.
const v147ActivationIndex = bootstrapSource.indexOf("await importPhase('v147TrackTimeoutConfig'");
const serverActivationIndex = bootstrapSource.indexOf('await importServerInteractiveFirst();');
assert.ok(v147ActivationIndex >= 0, 'bootstrap must explicitly await V147/V294 activation');
assert.ok(serverActivationIndex >= 0, 'bootstrap must explicitly invoke the interactive-first server loader');
assert.ok(v147ActivationIndex < serverActivationIndex, 'V147/V294 must activate before server/dataPurge is loaded');

const serverLoaderStart = bootstrapSource.indexOf('async function importServerInteractiveFirst()');
const serverLoaderEnd = bootstrapSource.indexOf('function scheduleDeferredMaintenance', serverLoaderStart);
const serverImportIndex = bootstrapSource.indexOf("return await importPhase('server', './server.js');", serverLoaderStart);
assert.ok(serverLoaderStart >= 0, 'interactive-first server loader function must exist');
assert.ok(serverLoaderEnd > serverLoaderStart, 'interactive-first server loader must end before deferred maintenance function');
assert.ok(serverImportIndex > serverLoaderStart && serverImportIndex < serverLoaderEnd, 'interactive-first server loader must actually import server.js');

console.log('[V377.1/V295.8/V294] clean reupload integrity smoke passed · isolated V377 lifecycle fixture + current-run/newest VALID import binding verified for CCSL/SHOPEE · V168 one-read V322 status retains V132 WHPP current-cohort completion parity · unknown status fails closed');
