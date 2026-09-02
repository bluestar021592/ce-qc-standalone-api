import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Keep the isolated same-date lifecycle fixture as the runtime regression gate.
execFileSync(process.execPath, ['scripts/v375-import-metadata-zero-shopee-smoke.mjs'], { stdio: 'inherit' });

for (const file of [
  'src/v317CcslIncompleteRecoveryPatch.js',
  'src/v311ShopeeIncompleteRecoveryPatch.js',
  'src/v137WhppUnifiedBusinessStatePatch.js',
  'src/v132WhppFastIntegrationPatch.js',
  'src/v322WebAvailabilityPatch.js',
  'src/v418StatusProofFastPath.js',
  'public/v159-current-import-stability.js',
  'public/v168-seven-business-status.js'
]) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const cleanSource = read('../src/v294CleanReuploadIntegrity.js');
const activationSource = read('../src/v147TrackTimeoutConfig.js');
const purgeSource = read('../src/dataPurge.js');
const purgeWorkerSource = read('./CE_QC_PurgeDeleteWorker.mjs');
const bootstrapSource = read('../bootstrap.js');
const ccslRecoverySource = read('../src/v317CcslIncompleteRecoveryPatch.js');
const shopeeRecoverySource = read('../src/v311ShopeeIncompleteRecoveryPatch.js');
const whppStateSource = read('../src/v137WhppUnifiedBusinessStatePatch.js');
const whppCanonicalSource = read('../src/v132WhppFastIntegrationPatch.js');
const v322StatusSource = read('../src/v322WebAvailabilityPatch.js');
const v418FastSource = read('../src/v418StatusProofFastPath.js');
const currentImportUiSource = read('../public/v159-current-import-stability.js');
const sevenBusinessSource = read('../public/v168-seven-business-status.js');

assert.match(cleanSource, /qc_tracking_ledger/);
assert.match(cleanSource, /qc_tracking_audit/);
assert.match(cleanSource, /installV294CleanSlateTargets\(\)/);
assert.match(activationSource, /v294CleanReuploadIntegrity\.js/);
assert.match(purgeSource, /BUSINESS_DATA_TABLES/);
assert.match(purgeSource, /BUSINESS_DATA_TABLES\.filter/);
assert.match(purgeWorkerSource, /v294CleanReuploadIntegrity\.js/);
assert.match(purgeWorkerSource, /BUSINESS_DATA_TABLES\.filter/);

// Same-date reupload must bind completion to the newest VALID import lifecycle.
assert.match(ccslRecoverySource, /WHERE reportDate=\? AND runId=\? AND snapshotType='dashboard'/);
assert.ok(ccslRecoverySource.includes('V377_CCSL_IMPORT_LIFECYCLE_ID'));
assert.ok(ccslRecoverySource.includes("latestValidSnapshot(db,date,lock?.runId||'',validBatch?.createdAt||'')"));
assert.ok(ccslRecoverySource.includes('retireStaleCcslRunPointers'));
assert.match(shopeeRecoverySource, /businessType=\? AND reportDate=\? AND runId=\?/);
assert.ok(shopeeRecoverySource.includes('V377_SHOPEE_IMPORT_LIFECYCLE_ID'));
assert.ok(shopeeRecoverySource.includes("validSnapshot(db,date,lock?.runId||'',boundary)"));
assert.ok(shopeeRecoverySource.includes('retireStaleShopeeRunPointers'));
assert.match(whppStateSource, /businessType='WHPP' AND reportDate=\? AND runId=\?/);
assert.match(whppStateSource, /const completed=Boolean\(snapshot\)/);
assert.doesNotMatch(whppStateSource, /const completed=Boolean\(snapshot\|\|history\)/);

// V132 visible WHPP truth remains evidence-based and excludes retry placeholders.
assert.match(whppCanonicalSource, /const memberCount=uniqueRows\(membershipRows\)\.length/);
assert.match(whppCanonicalSource, /function completionDecision\(/);
assert.match(whppCanonicalSource, /standard\?\.finalized/);
assert.match(whppCanonicalSource, /lifecycle\?\.complete/);
assert.match(whppCanonicalSource, /num\(memberCount\)===0&&Boolean\(standard\?\.present\|\|historyPresent\)/);
assert.match(whppCanonicalSource, /num\(memberCount\)>0&&num\(finalEvidenceRows\)>=num\(memberCount\)/);
assert.match(whppCanonicalSource, /UPPER\(COALESCE\(f\.apiStatus,''\)\)='SUCCESS'/);
assert.match(whppCanonicalSource, /const finalEvidenceRows=countFinalEvidence\(db,reportDate,\{standard,unified\}\);/);
assert.match(whppCanonicalSource, /completionDecision\(\{standard,memberCount,finalEvidenceRows,historyPresent:Boolean\(history\),lifecycle,retryPending\}\)/);
assert.doesNotMatch(whppCanonicalSource, /finalEvidenceRows:facts\.length/);
assert.match(whppCanonicalSource, /Cache-Control','no-store/);

// V168 owns exactly one exact-date status request.
assert.match(sevenBusinessSource, /STATUS_SOURCE_REVISION = '2026-09-02-v414-one-read-seven-business-status-v1'/);
assert.match(sevenBusinessSource, /businessType: 'ALL', reportDate: target/);
assert.match(sevenBusinessSource, /\/api\/v33\/run-progress\?\$\{query\.toString\(\)\}/);
assert.doesNotMatch(sevenBusinessSource, /\/api\/v132\/whpp-fast-summary|\/api\/v311\/shopee-recovery|\/api\/v317\/ccsl-recovery/);
assert.doesNotMatch(sevenBusinessSource, /\/api\/business-state\/WHPP/);

// V419 status is scalar-only: membership + locks + compact snapshots + SUCCESS coverage.
assert.match(v322StatusSource, /V419_SCALAR_STATUS_PRIORITY_ID='2026-09-02-v419-scalar-status-priority-no-json-v1'/);
assert.match(v322StatusSource, /V419_STATUS_TIMING_ID='2026-09-02-v419-status-substage-timing-v1'/);
assert.match(v322StatusSource, /function buildScalarStatus\(/);
assert.match(v322StatusSource, /readV418CurrentMembershipCounts\(db,batch\|\|\{\}\)/);
assert.match(v322StatusSource, /readV418CcslProcessingProof/);
assert.match(v322StatusSource, /readV418BusinessSuccessCoverage/);
assert.match(v322StatusSource, /currentCompletionSnapshot/);
assert.match(v322StatusSource, /unifiedCompletionClaim/);
assert.match(v322StatusSource, /restartInterrupted/);
assert.match(v322StatusSource, /PROCESS_RESTART_INTERRUPTED/);
assert.match(v322StatusSource, /ok\s*:\s*false\s*,\s*code\s*:\s*'V322_PERSISTED_STATUS_READ_FAILED'/);
assert.match(v322StatusSource, /Server-Timing/);
assert.match(v322StatusSource, /V419_SCALAR_STATUS_SLOW/);
assert.doesNotMatch(v322StatusSource, /payloadJson|stateJson|summaryJson|valueJson/,
  'normal status reads must never materialize large JSON payload columns');
assert.doesNotMatch(v322StatusSource, /scan_results|business_scan_results|business_track_events|track_events/,
  'normal status owner must not reconstruct scan or trajectory facts');

// Exact current-member SUCCESS coverage stays in the indexed V418 helper.
assert.match(v418FastSource, /V418_STATUS_PROOF_FAST_PATH_ID='2026-09-02-v418-large-db-set-join-status-proof-v1'/);
assert.match(v418FastSource, /FROM unified_import_rows u[\s\S]*JOIN business_final_rows f/);
assert.match(v418FastSource, /FROM business_daily_parse_rows d[\s\S]*JOIN business_final_rows f/);
assert.match(v418FastSource, /UPPER\(COALESCE\(f\.apiStatus,''\)\)='SUCCESS'/);
assert.match(v418FastSource, /V418_WHPP_CURRENT_MEMBER_SET_JOIN/);
assert.match(v418FastSource, /V418_CURRENT_MEMBER_SET_JOIN/);

// Fresh import owns the selected date and cannot be repainted by an older range.
for (const id of ['reportDate','topRangeFrom','topRangeTo','dashboardRangeFrom','dashboardRangeTo']) {
  assert.ok(currentImportUiSource.includes(`'${id}'`), `V159 must synchronize ${id} to the fresh import date`);
}
assert.match(currentImportUiSource, /syncSelectedDateToCurrentImport\(\{force:true\}\)/);
assert.match(currentImportUiSource, /__CE_QC_V253_DASHBOARD_FAST_OWNER__\?\.refresh/);
assert.match(currentImportUiSource, /selectedDateSyncDone/);

const v147ActivationIndex = bootstrapSource.indexOf("await importPhase('v147TrackTimeoutConfig'");
const serverActivationIndex = bootstrapSource.indexOf('await importServerInteractiveFirst();');
assert.ok(v147ActivationIndex >= 0);
assert.ok(serverActivationIndex >= 0);
assert.ok(v147ActivationIndex < serverActivationIndex);
const serverLoaderStart = bootstrapSource.indexOf('async function importServerInteractiveFirst()');
const serverLoaderEnd = bootstrapSource.indexOf('function scheduleDeferredMaintenance', serverLoaderStart);
const serverImportIndex = bootstrapSource.indexOf("return await importPhase('server', './server.js');", serverLoaderStart);
assert.ok(serverLoaderStart >= 0);
assert.ok(serverLoaderEnd > serverLoaderStart);
assert.ok(serverImportIndex > serverLoaderStart && serverImportIndex < serverLoaderEnd);

console.log('[V419/V414/V377.1/V295.8/V294] clean reupload integrity smoke passed · newest VALID lifecycle binding preserved · V168 one-read status · V419 scalar-only status proof · exact current-member SUCCESS coverage · restart-only WHPP proof · unknown status fails closed');
