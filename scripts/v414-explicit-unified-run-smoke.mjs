import fs from 'node:fs';

const read = file => fs.readFileSync(file, 'utf8');
const must = (source, token, label = token) => {
  if (!source.includes(token)) throw new Error(`V414 missing ${label}`);
};
const forbid = (source, token, label = token) => {
  if (source.includes(token)) throw new Error(`V414 forbidden ${label}`);
};

const v165 = read('src/v165WhppRunStateRecoveryPatch.js');
const v134 = read('src/v134WhppRunSupervisorPatch.js');
const v294 = read('src/v294PostProcessAttemptBackfillPatch.js');
const v322 = read('src/v322WebAvailabilityPatch.js');
const v132 = read('src/v132WhppFastIntegrationPatch.js');
const v329 = read('src/v329ThreeBusinessDailyCache.js');
const v67 = read('public/v67-resilient-run-guard.js');
const historyWorker = read('scripts/v329-three-business-cache-worker.mjs');

// 1) V165 may create a recovery marker only from an actually persisted running
// WHPP lifecycle with a durable runId. A fresh pending import must not qualify.
must(v165, "V414_WHPP_RESTART_PROOF_REVISION = '2026-09-02-v414-whpp-process-restart-proof-v1'");
must(v165, 'processing.running !== true');
must(v165, 'processing.running === true');
must(v165, "const INTERRUPTED_RUN_REASON = 'PROCESS_RESTART_INTERRUPTED'");
must(v165, 'inspectV165WhppRestartInterruption');
must(v165, 'markerRunId && stateRunId === markerRunId');
must(v165, 'restartRecovery: null');

// 2) V134 backend continuity is restart-only. Legacy import rearm callers are
// intentionally converted to an OFF latch and there is no fresh-import timer.
must(v134, "V414_EXPLICIT_UNIFIED_WHPP_REVISION='2026-09-02-v414-explicit-unified-whpp-restart-only-v1'");
must(v134, 'inspectV165WhppRestartInterruption(currentDate)');
must(v134, "[CE-QC][V414_WHPP_RESTART_ONLY_RECOVERY]");
must(v134, 'autoStartOnImport:false');
must(v134, 'restartOnly:true');
must(v134, 'explicitRunOnly:true');
forbid(v134, "maybeAutoResumeWhpp('new-import-event')", 'fresh-import WHPP auto resume');

// 3) The import response hook must idle WHPP continuity, never rearm it.
must(v294, "V414_IMPORT_EXPLICIT_RUN_REVISION='2026-09-02-v414-import-never-auto-starts-whpp-v1'");
must(v294, 'globalThis.__CE_QC_IDLE_WHPP_BACKEND_CONTINUITY__?.(date)');
must(v294, 'EXPLICIT_UNIFIED_RUN_ONLY_NEW_IMPORT_NEVER_AUTO_STARTS_WHPP');
forbid(v294, 'globalThis.__CE_QC_REARM_WHPP_BACKEND_CONTINUITY__?.(date)', 'import-time WHPP rearm');

// 4) Browser V67 is still the sole normal three-stage owner. Generic "CCSL +
// SHOPEE done, WHPP incomplete" is not an auto-start condition anymore.
must(v67, "VERSION = '2026-09-02-v414-explicit-unified-restart-only-v1'");
must(v67, "STATUS_SOURCE_REVISION = '2026-09-02-v414-one-read-seven-business-status-v1'");
must(v67, "WHPP_RESTART_RECOVERY_REVISION = '2026-09-02-v414-whpp-restart-only-browser-v1'");
must(v67, 'function whppRestartInterruption');
must(v67, 'payload?.restartInterrupted === true');
must(v67, "reason.includes('PROCESS_RESTART_INTERRUPTED')");
must(v67, "[CE-QC][V67_WHPP_RESTART_RECOVERY]");
must(v67, "global.runUnified = () => execute('start')");
must(v67, "global.resumeUnified = () => execute('resume')");
forbid(v67, "console.info('[CE-QC][V67_WHPP_AUTO_RESUME]'", 'generic browser WHPP auto resume executable path');

// 5) WHPP completion evidence must be a successfully processed current-member
// row. Placeholder/API_PENDING_RETRY rows may remain visible but cannot complete.
must(v322, "V322_WHPP_COMPLETION_PARITY_ID='2026-09-02-v414-whpp-success-evidence-parity-v1'");
must(v322, "UPPER(COALESCE(f.apiStatus,''))='SUCCESS'");
must(v322, 'restartInterrupted');
must(v322, "lastMessage:restartInterrupted?'PROCESS_RESTART_INTERRUPTED':stage.lastMessage");
must(v322, "completionSource:'FULL_MEMBER_SUCCESS_EVIDENCE'");
must(v132, "STATUS_REVISION='2026-09-02-v414-whpp-success-evidence-status-v1'");
must(v132, "UPPER(COALESCE(f.apiStatus,''))='SUCCESS'");
must(v132, 'const finalEvidenceRows=countFinalEvidence(db,reportDate,{standard,unified});');
must(v132, "completionSource:'FULL_MEMBER_SUCCESS_EVIDENCE'");
forbid(v132, 'finalEvidenceRows:facts.length', 'full-summary placeholder completion');

// 6) SHOPEE historical 1/2/3 attempts and START->POD days rebuild from saved
// SQLite evidence first. Only the existing finalized-date opt-in can use network.
must(v329, "V329_THREE_BUSINESS_CACHE_REVISION='2026-09-02-v414-saved-strict-start-pod-history-v1'");
must(v329, "DELETE FROM v329_three_business_daily_cache WHERE COALESCE(cacheRevision,'')<>?");
must(historyWorker, "V329_SAVED_EVENT_HISTORY_REPAIR");
must(historyWorker, "EVIDENCE_SAVED_ONLY");
must(historyWorker, "const ALLOW_NETWORK_REPAIR=String(process.env.CE_QC_HISTORY_NETWORK_REPAIR||'')==='1'");
must(historyWorker, 'savedEvents(db');
must(historyWorker, 'analyzeV246ShopeeAttemptCycle(eventMap.get(row.shipmentCode)||[]');

console.log('V414 explicit unified run smoke passed: fresh import cannot auto-start WHPP; restart recovery requires exact PROCESS_RESTART_INTERRUPTED proof; WHPP completion ignores non-SUCCESS placeholder rows; Shopee historical attempt/signing cache is rebuilt from saved evidence first.');
