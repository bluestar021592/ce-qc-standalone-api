import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import './v415-retroactive-completion-proof-smoke.mjs';

const read = file => fs.readFileSync(file, 'utf8');
const mustMatch = (source, pattern, label = String(pattern)) => {
  if (!pattern.test(source)) throw new Error(`V414 missing ${label}`);
};
const forbidMatch = (source, pattern, label = String(pattern)) => {
  if (pattern.test(source)) throw new Error(`V414 forbidden ${label}`);
};

const v165 = read('src/v165WhppRunStateRecoveryPatch.js');
const v134 = read('src/v134WhppRunSupervisorPatch.js');
const v294 = read('src/v294PostProcessAttemptBackfillPatch.js');
const v322 = read('src/v322WebAvailabilityPatch.js');
const v418 = read('src/v418StatusProofFastPath.js');
const v132 = read('src/v132WhppFastIntegrationPatch.js');
const v329 = read('src/v329ThreeBusinessDailyCache.js');
const v67 = read('public/v67-resilient-run-guard.js');
const historyWorker = read('scripts/v329-three-business-cache-worker.mjs');

// 1) V165 may create a recovery marker only from an actually persisted running
// WHPP lifecycle with a durable runId. A fresh pending import must not qualify.
mustMatch(v165, /V414_WHPP_RESTART_PROOF_REVISION\s*=\s*'2026-09-02-v414-whpp-process-restart-proof-v1'/, 'V165 V414 restart-proof revision');
mustMatch(v165, /if\s*\(\s*!reportDate\s*\|\|\s*processing\.running\s*!==\s*true\s*\|\|\s*!runId\s*\|\|\s*finalizedState\(state\)\s*\)/, 'V165 persisted-running + runId + non-finalized admission guard');
mustMatch(v165, /const\s+INTERRUPTED_RUN_REASON\s*=\s*'PROCESS_RESTART_INTERRUPTED'/, 'V165 restart interruption reason');
mustMatch(v165, /const\s+restartRecovery\s*=\s*\{[\s\S]*?reason\s*:\s*INTERRUPTED_RUN_REASON[\s\S]*?reportDate[\s\S]*?runId[\s\S]*?revision\s*:\s*V414_WHPP_RESTART_PROOF_REVISION[\s\S]*?\}/, 'V165 durable restart marker built only after running-state guard');
mustMatch(v165, /inspectV165WhppRestartInterruption/, 'V165 exact restart interruption inspector');
mustMatch(v165, /markerRunId\s*&&\s*stateRunId\s*===\s*markerRunId/, 'V165 restart marker runId parity');
mustMatch(v165, /state\?\.processing\?\.running\s*!==\s*true/, 'V165 recovered state must no longer be actively running');
mustMatch(v165, /restartRecovery\s*:\s*null/, 'fresh/rehydrated WHPP state clears stale restart marker');

// 2) V134 backend continuity is restart-only. Legacy import rearm callers are
// intentionally converted to an OFF latch and there is no fresh-import timer.
mustMatch(v134, /V414_EXPLICIT_UNIFIED_WHPP_REVISION\s*=\s*'2026-09-02-v414-explicit-unified-whpp-restart-only-v1'/, 'V134 V414 restart-only revision');
mustMatch(v134, /inspectV165WhppRestartInterruption\(currentDate\)/, 'V134 consumes exact V165 restart proof');
mustMatch(v134, /\[CE-QC\]\[V414_WHPP_RESTART_ONLY_RECOVERY\]/, 'V134 restart-only recovery log');
mustMatch(v134, /autoStartOnImport\s*:\s*false/, 'V134 import auto-start disabled');
mustMatch(v134, /restartOnly\s*:\s*true/, 'V134 restart-only policy');
mustMatch(v134, /explicitRunOnly\s*:\s*true/, 'V134 explicit-run-only policy');
forbidMatch(v134, /maybeAutoResumeWhpp\(\s*['"]new-import-event['"]\s*\)/, 'fresh-import WHPP auto resume');

// 3) The import response hook must idle WHPP continuity, never rearm it.
mustMatch(v294, /V414_IMPORT_EXPLICIT_RUN_REVISION\s*=\s*'2026-09-02-v414-import-never-auto-starts-whpp-v1'/, 'V294 explicit-run import policy');
mustMatch(v294, /globalThis\.__CE_QC_IDLE_WHPP_BACKEND_CONTINUITY__\?\.\(date\)/, 'import idles WHPP backend continuity');
mustMatch(v294, /EXPLICIT_UNIFIED_RUN_ONLY_NEW_IMPORT_NEVER_AUTO_STARTS_WHPP/, 'import policy marker');
forbidMatch(v294, /globalThis\.__CE_QC_REARM_WHPP_BACKEND_CONTINUITY__\?\.\(date\)/, 'import-time WHPP rearm');

// 4) Browser V67 is still the sole normal three-stage owner. Generic "CCSL +
// SHOPEE done, WHPP incomplete" is not an auto-start condition anymore.
mustMatch(v67, /VERSION\s*=\s*'2026-09-02-v414-explicit-unified-restart-only-v1'/, 'V67 V414 runner revision');
mustMatch(v67, /STATUS_SOURCE_REVISION\s*=\s*'2026-09-02-v414-one-read-seven-business-status-v1'/, 'V67 V414 persisted status contract');
mustMatch(v67, /WHPP_RESTART_RECOVERY_REVISION\s*=\s*'2026-09-02-v414-whpp-restart-only-browser-v1'/, 'V67 WHPP restart-only browser revision');
mustMatch(v67, /function\s+whppRestartInterruption\s*\(/, 'V67 WHPP restart interruption classifier');
mustMatch(v67, /payload\?\.restartInterrupted\s*===\s*true/, 'V67 requires persisted restartInterrupted=true');
mustMatch(v67, /reason\.includes\(\s*['"]PROCESS_RESTART_INTERRUPTED['"]\s*\)/, 'V67 requires exact restart reason');
mustMatch(v67, /\[CE-QC\]\[V67_WHPP_RESTART_RECOVERY\]/, 'V67 restart recovery log');
mustMatch(v67, /global\.runUnified\s*=\s*\(\)\s*=>\s*execute\(\s*['"]start['"]\s*\)/, 'V67 sole unified start owner');
mustMatch(v67, /global\.resumeUnified\s*=\s*\(\)\s*=>\s*execute\(\s*['"]resume['"]\s*\)/, 'V67 sole unified resume owner');
forbidMatch(v67, /console\.info\(\s*['"]\[CE-QC\]\[V67_WHPP_AUTO_RESUME\]/, 'generic browser WHPP auto resume executable path');

// 5) WHPP completion evidence must be a successfully processed current-member
// row. V419 keeps V322 as the scalar orchestration owner while V418 owns the
// exact current-member set join and SUCCESS-only SQL. Placeholder/API_PENDING_RETRY
// rows may remain visible but can never complete the stage.
mustMatch(v322, /V322_WHPP_COMPLETION_PARITY_ID\s*=\s*'2026-09-02-v414-whpp-success-evidence-parity-v1'/, 'V322 WHPP SUCCESS-evidence parity');
mustMatch(v322, /readV418BusinessSuccessCoverage/, 'V322 delegates SUCCESS coverage to V418 current-member proof owner');
mustMatch(v322, /readV418BusinessSuccessCoverage\(db,\{businessType:'WHPP',date,snapshotId,boundary,memberTypes:\['WHPP'\]\}\)/, 'V322 WHPP stage invokes exact V418 SUCCESS coverage');
mustMatch(v418, /FROM business_daily_parse_rows d[\s\S]*JOIN business_final_rows f[\s\S]*f\.shipmentCode=d\.shipmentCode[\s\S]*d\.businessType='WHPP'[\s\S]*d\.reportDate=\?[\s\S]*UPPER\(COALESCE\(f\.apiStatus,''\)\)='SUCCESS'/, 'V418 WHPP exact current-member SUCCESS-only evidence');
mustMatch(v418, /V418_WHPP_CURRENT_MEMBER_SET_JOIN/, 'V418 WHPP current-member proof source');
mustMatch(v322, /restartInterrupted\s*:\s*interrupted/, 'V322 restart interruption exposure');
mustMatch(v322, /lastMessage\s*:\s*interrupted\s*\?\s*'PROCESS_RESTART_INTERRUPTED'/, 'V322 exact restart interruption message');
mustMatch(v322, /completionSource:'V418_CURRENT_MEMBER_PROCESSING_PROOF'/, 'V322 completed stage identifies V418 current-member proof');
forbidMatch(v322, /UPPER\(COALESCE\(f\.apiStatus,''\)\)='SUCCESS'/, 'duplicated SUCCESS SQL in V322 scalar orchestrator');
mustMatch(v132, /STATUS_REVISION\s*=\s*'2026-09-02-v414-whpp-success-evidence-status-v1'/, 'V132 V414 SUCCESS-evidence status revision');
mustMatch(v132, /UPPER\(COALESCE\(f\.apiStatus,''\)\)='SUCCESS'/, 'V132 SUCCESS-only final evidence');
mustMatch(v132, /const\s+finalEvidenceRows\s*=\s*countFinalEvidence\(db,reportDate,\{standard,unified\}\)/, 'V132 current-cohort final evidence count');
mustMatch(v132, /completionSource:'FULL_MEMBER_SUCCESS_EVIDENCE'/, 'V132 full-member SUCCESS completion source');
forbidMatch(v132, /finalEvidenceRows\s*:\s*facts\.length/, 'full-summary placeholder completion');

// 6) SHOPEE historical 1/2/3 attempts and START->POD days rebuild from saved
// SQLite evidence first. Only the existing finalized-date opt-in can use network.
mustMatch(v329, /V329_THREE_BUSINESS_CACHE_REVISION\s*=\s*'2026-09-02-v414-saved-strict-start-pod-history-v1'/, 'V329 V414 saved-evidence cache revision');
mustMatch(v329, /DELETE FROM v329_three_business_daily_cache WHERE COALESCE\(cacheRevision,''\)<>\?/, 'V329 stale derived-cache invalidation');
mustMatch(historyWorker, /V329_SAVED_EVENT_HISTORY_REPAIR/, 'V329 saved event repair marker');
mustMatch(historyWorker, /EVIDENCE_SAVED_ONLY/, 'V329 saved-only evidence path');
mustMatch(historyWorker, /const\s+ALLOW_NETWORK_REPAIR\s*=\s*String\(process\.env\.CE_QC_HISTORY_NETWORK_REPAIR\|\|''\)\s*===\s*'1'/, 'history network repair is explicit opt-in');
mustMatch(historyWorker, /savedEvents\(db/, 'history rebuild reads saved SQLite events');
mustMatch(historyWorker, /analyzeV246ShopeeAttemptCycle\(eventMap\.get\(row\.shipmentCode\)\|\|\[\]/, 'history rebuild uses strict V246 attempt cycles');

// 7) V419 local installer must prove the new global-range/export freshness and
// carry/current/ledger convergence in isolated child processes. These smoke tests
// use only temporary/in-memory SQLite and never production data or CE network APIs.
for (const smoke of [
  'scripts/v419-carry-ledger-sync-smoke.mjs',
  'scripts/v419-global-range-export-freshness-smoke.mjs'
]) {
  execFileSync(process.execPath,[smoke],{stdio:'inherit',env:{...process.env,NODE_ENV:'test'}});
}

console.log('V419/V414 explicit unified run smoke passed: fresh import cannot auto-start WHPP; restart recovery requires exact PROCESS_RESTART_INTERRUPTED proof from a previously persisted running lifecycle; V322 delegates current-member SUCCESS proof to V418 set joins; non-SUCCESS placeholder rows cannot complete WHPP; Shopee historical attempt/signing cache is rebuilt from saved evidence first; V419 range/export/carry smokes passed in isolated child processes.');
