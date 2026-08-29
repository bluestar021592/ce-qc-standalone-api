import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

for (const file of [
  'src/v317CcslIncompleteRecoveryPatch.js',
  'src/v311ShopeeIncompleteRecoveryPatch.js',
  'src/v137WhppUnifiedBusinessStatePatch.js',
  'src/v132WhppFastIntegrationPatch.js',
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
// same-date snapshot. The legacy WHPP business-state route follows the same rule.
assert.match(ccslRecoverySource, /WHERE reportDate=\? AND runId=\? AND snapshotType='dashboard'/);
assert.match(ccslRecoverySource, /latestValidSnapshot\(db,date,lock\?\.runId\|\|''\)/);
assert.match(shopeeRecoverySource, /businessType=\? AND reportDate=\? AND runId=\?/);
assert.match(shopeeRecoverySource, /validSnapshot\(db,date,lock\?\.runId\|\|''\)/);
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
assert.match(sevenBusinessSource, /\/api\/v132\/whpp-fast-summary\?reportDate=\$\{encoded\}/,
  'V168 must read the same canonical WHPP summary as the visible board');
assert.doesNotMatch(sevenBusinessSource, /readJson\(`\/api\/business-state\/WHPP\?reportDate=\$\{encoded\}`\)/,
  'V168 must not use the legacy snapshot-only WHPP status route');
assert.match(sevenBusinessSource, /payload\?\.completed === true/,
  'V168 must accept canonical current-membership completion without requiring a duplicate run snapshot');

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

console.log('[V295.8/V294] clean reupload integrity smoke passed · current-run snapshot binding + fresh-import date synchronization + canonical lifecycle-aware zero-work WHPP completion verified · retained same-date audit snapshots cannot falsely close the new lifecycle');
