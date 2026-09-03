const fs = require('fs');

const read = p => fs.readFileSync(p, 'utf8');
const must = (source, token, label = token) => { if (!source.includes(token)) throw new Error(`GOLIVE missing ${label}`); };
const forbid = (source, token, label = token) => { if (source.includes(token)) throw new Error(`GOLIVE retired token ${label}`); };

const runner = read('public/v67-resilient-run-guard.js');
const whppUi = read('public/v132-whpp-seven-business-fast.js');
const pause = read('public/v164-unified-pause-router.js');
const shell = read('src/v44WhppUiPatch.js');
const whppSupervisor = read('src/v134WhppRunSupervisorPatch.js');
const v161 = read('src/v161UnifiedImportRuntimeTruthPatch.js');
const storage = read('src/storage.js');
const bstore = read('src/businessStore.js');
const bootstrap = read('bootstrap.js');
const podRepair = read('src/v167CcslPodLockFactRepair.js');
const v246 = read('src/v246TrackingLedgerCore.js');
const singleExportWorker = read('src/v183SingleBusinessExportJobWorker.js');
const allBusinessChild = read('src/v84ExportBusinessWorker.js');
const asyncExportLauncher = read('src/v84AsyncExportPatch.js');
const exportDirect = read('src/v190ExportDirectEndpointPatch.js');
const exportSidecar = read('src/v193ExportSidecar.js');

// Current execution ownership: V67 is the sole normal browser runner.
must(runner, '2026-09-02-v414-explicit-unified-restart-only-v1');
must(runner, '2026-09-02-v414-one-read-seven-business-status-v1');
must(runner, "{ key: 'CCSL'");
must(runner, "{ key: 'SHOPEE'");
must(runner, "{ key: 'WHPP'");
must(runner, '/api/run');
must(runner, '/api/shopee/run/start');
must(runner, '/api/whpp/run/start');
must(runner, 'PROCESS_RESTART_INTERRUPTED');
must(runner, "global.runUnified = () => execute('start')");
must(runner, "global.resumeUnified = () => execute('resume')");
forbid(runner, '[CE-QC][V67_WHPP_AUTO_RESUME]');
forbid(runner, '/api/v311/shopee-recovery');
forbid(runner, '/api/v317/ccsl-recovery');

// Backend WHPP continuity is restart-only, never a fresh-import auto runner.
must(whppSupervisor, '2026-09-02-v414-explicit-unified-whpp-restart-only-v1');
must(whppSupervisor, 'inspectV165WhppRestartInterruption');
must(whppSupervisor, 'V165_PROCESS_RESTART_INTERRUPTED_MARKER');
must(whppSupervisor, 'autoStartOnImport:false');
must(whppSupervisor, 'restartOnly:true');
must(whppSupervisor, "launchWhpp('resume')");
forbid(whppSupervisor, 'new-import-event');

// V419 WHPP page is display-only but follows the same global from/to owner as
// HOME and every other business board. It cannot create a separate run entry.
must(whppUi, '2026-09-03-v419-whpp-one-global-range-board-v1');
must(whppUi, '2026-09-03-v419-whpp-range-summary-trend-detail-v1');
must(whppUi, '__CE_QC_GLOBAL_PERIOD_RANGE__');
must(whppUi, '/api/v234/current-summary?from=');
must(whppUi, '/api/v234/trends?businessType=WHPP&from=');
must(whppUi, '/api/v172/whpp-metric-detail?');
must(whppUi, 'displayOnly:true');
must(whppUi, "authoritativeRunner:'V67'");
forbid(whppUi, 'global.runUnified=');
forbid(whppUi, 'global.resumeUnified=');
forbid(whppUi, '/api/whpp/run/start');

// The shell must deliver one V67 runner + one V132 WHPP page and prevent stale
// HTML/JS caching. Exact cache-bust suffixes may advance independently.
must(shell, 'v67-resilient-run-guard.js?v=');
must(shell, 'v132-whpp-seven-business-fast.js?v=');
must(shell, 'Cache-Control');
must(shell, 'no-store, no-cache, must-revalidate, proxy-revalidate');
must(shell, "const WHPP_PAGE_OWNER='V132'");
must(pause, '/api/shopee/run/pause');
must(pause, 'global.pauseUnified=pauseUnified');

// Seven-business source truth remains independent while WHPP executes as the
// dedicated third stage rather than being folded into CCSL.
must(v161, "const TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']");
must(v161, 'unified_import_rows');
must(v161, 'TYPES.reduce((sum, type) => sum + num(counts[type]), 0)');
forbid(storage, 'mergeUnifiedWhppMembership');
forbid(storage, 'unifiedWhppSnapshotId');
must(bstore, 'compactBusinessStatePayload');
must(bstore, 'finalByBill');

// V419/V246 terminal and strict signing truth is production-active.
must(v246, "export const V419_STRICT_SIGNING_TRUTH_ID = '2026-09-03-v419-strict-start-signing-truth-v1'");
must(v246, 'ignoredLegacyCloseReason: text(closeReason)');
must(v246, 'firstStrictStartDate(row.starts||[])');
must(v246, 'v246InclusiveDays(strictStartDate,podDate)');
must(v246, 'V246_STRICT_TRACK:');

// Startup remains interactive-first and expensive maintenance cannot steal the
// production write lock in recovery safe mode.
must(bootstrap, 'v167CcslPodLockFactRepair');
must(podRepair, '2026-09-02-v419-ccsl-pod-lock-safe-mode-startup-guard-v3');

// One export engine owns both single-business and ALL seven-business output.
must(singleExportWorker, 'createV200ReferenceDashboardWorkbook');
must(singleExportWorker, 'V200_REFERENCE_TEMPLATE_10_SHEETS_DASHBOARD_ATTEMPT_ONLY');
must(allBusinessChild, 'createV200ReferenceDashboardWorkbook');
must(asyncExportLauncher, 'ONE_WORKBOOK_PER_BUSINESS_V185_ONE_PASS_STREAM');
must(exportDirect, '/api/v190/export-period/prepare');
must(exportSidecar, '/api/v194/export-period/prepare');
must(exportSidecar, 'IPC_MEMORY_V195');

for (const source of [runner, whppUi, pause, shell, whppSupervisor, v161, storage, bstore, bootstrap, podRepair]) {
  forbid(source, 'v148-direct-daily-runner-v1');
}

console.log('[GOLIVE V419] runtime-source gate passed · V67 sole explicit CCSL→SHOPEE→WHPP runner · restart-only continuity · V419 WHPP global-range display owner · seven-business truth · V246 strict START→POD · unified export owner · no stale runtime cache');
