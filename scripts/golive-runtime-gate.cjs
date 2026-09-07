const fs = require('fs');
const { execFileSync } = require('child_process');

const read = p => fs.readFileSync(p, 'utf8');
const must = (source, token, label = token) => { if (!source.includes(token)) throw new Error(`GOLIVE missing ${label}`); };
const forbid = (source, token, label = token) => { if (source.includes(token)) throw new Error(`GOLIVE retired token ${label}`); };

const runner = read('public/v67-resilient-run-guard.js');
const v68 = read('public/v68-whpp-classification-stability.js');
const v94 = read('public/v94-business-source-truth-ui-v2.js');
const whppUi = read('public/v132-whpp-seven-business-fast.js');
const pause = read('public/v164-unified-pause-router.js');
const shell = read('src/v44WhppUiPatch.js');
const v428 = read('public/v428-base-ccsl-status-owner.js');
const whppSupervisor = read('src/v134WhppRunSupervisorPatch.js');
const whppStore = read('src/whppStore.js');
const v161 = read('src/v161UnifiedImportRuntimeTruthPatch.js');
const storage = read('src/storage.js');
const bstore = read('src/businessStore.js');
const bootstrap = read('bootstrap.js');
const podRepair = read('src/v167CcslPodLockFactRepair.js');
const v246 = read('src/v246TrackingLedgerCore.js');
const v172 = read('src/v172WhppDetailParityPatch.js');
const v87 = read('src/v87WhppExportStore.js');
const singleExportWorker = read('src/v183SingleBusinessExportJobWorker.js');
const allBusinessChild = read('src/v84ExportBusinessWorker.js');
const asyncExportLauncher = read('src/v84AsyncExportPatch.js');
const exportDirect = read('src/v190ExportDirectEndpointPatch.js');
const exportSidecar = read('src/v193ExportSidecar.js');
const managedLauncher = read('tools/CE_QC_Managed_Launcher.ps1');

// Current execution ownership: V67 is the sole normal browser runner. V424 adds
// only an opaque same-proof resume floor for an exact restart interruption.
must(runner, '2026-09-02-v414-explicit-unified-restart-only-v1');
must(runner, '2026-09-02-v414-one-read-seven-business-status-v1');
must(runner, '2026-09-04-v424-restart-proof-resume-floor-v1');
must(runner, "{ key: 'CCSL'");
must(runner, "{ key: 'SHOPEE'");
must(runner, "{ key: 'WHPP'");
must(runner, '/api/run');
must(runner, '/api/shopee/run/start');
must(runner, '/api/whpp/run/start');
must(runner, 'PROCESS_RESTART_INTERRUPTED');
must(runner, 'resumeHandoffNonce');
must(runner, "createPersistedRestartHandoff(all, target, 'SHOPEE')");
must(runner, 'if (resumeFloor && index < resumeFloor.index)');
must(runner, 'if (truth.done) {');
must(runner, '已有正式持久化结果，直接进入下一阶段');
must(runner, "global.runUnified = () => execute('start')");
must(runner, "global.resumeUnified = handoff => execute('resume', handoff)");
forbid(runner, '[CE-QC][V67_WHPP_AUTO_RESUME]');
forbid(runner, '/api/v311/shopee-recovery');
forbid(runner, '/api/v317/ccsl-recovery');

// V426 import-source authority: the parser/store seven-business reconciliation is
// the owner immediately after upload. Later WHPP/dashboard summaries are legacy
// fallback only and may never rewrite a balanced 5060+228=5288 import back to
// the six-business 5060 view.
must(v68, '2026-09-04-v426-unified-import-seven-business-truth-priority-v1');
must(v68, 'function authoritativeImportTruth');
must(v68, "reconciliation.balanced !== true");
must(v68, "reason: 'AUTHORITATIVE_UNIFIED_IMPORT_TRUTH'");
must(v68, 'V426_UNIFIED_IMPORT_SEVEN_BUSINESS_TRUTH');
must(v68, 'V426_LEGACY_WHPP_FAST_SUMMARY_COMPAT');
must(v94, '2026-09-04-v426-unified-import-truth-priority-v1');
must(v94, 'function authoritativeUnifiedImport');
must(v94, "reason: 'AUTHORITATIVE_UNIFIED_IMPORT_TRUTH'");
must(v94, 'V426_UNIFIED_IMPORT_SEVEN_BUSINESS_TRUTH');
must(v94, 'V94_CANONICAL_POST_CLASSIFICATION_LEGACY_COMPAT');

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
must(whppUi, '2026-09-03-v419-whpp-one-global-range-board-v2');
must(whppUi, '2026-09-03-v419-whpp-range-summary-trend-detail-v2');
must(whppUi, '__CE_QC_GLOBAL_PERIOD_RANGE__');
must(whppUi, '/api/v234/current-summary?from=');
must(whppUi, '/api/v234/trends?businessType=WHPP&from=');
must(whppUi, '/api/v172/whpp-metric-detail?');
must(whppUi, 'displayOnly:true');
must(whppUi, "authoritativeRunner:'V67'");
forbid(whppUi, 'global.runUnified=');
forbid(whppUi, 'global.resumeUnified=');
forbid(whppUi, '/api/whpp/run/start');

// WHPP detail and export share one immutable daily membership + completion
// authority. finalRows contains today + carry and is enrichment only. Legacy
// 4f53 snapshots are accepted only when a surviving completed daily summary
// points to that exact snapshotId; otherwise only explicit VALID+COMPLETED can
// stand alone after daily metadata rotation.
must(v172, '2026-09-03-v419-whpp-completion-certified-detail-v7');
must(v172, 'function restrictStateToImmutableMembership');
must(v172, 'function certifiedCompletedSnapshotState');
must(v172, "summary.completed===true&&['COMPLETED','COMPLETED_WITH_RETRY'].includes(status)&&Boolean(snapshotId)");
must(v172, "snapshotId=?");
must(v172, "UPPER(COALESCE(status,''))<>'INVALID'");
must(v172, "UPPER(COALESCE(reconciliationStatus,''))<>'FAILED'");
must(v172, 'BUSINESS_EXPORT_SNAPSHOT_LEGACY_DAILY_ATTESTED');
must(v172, 'BUSINESS_EXPORT_SNAPSHOT_VALID_COMPLETED');
must(v172, 'IMMUTABLE_DAILY_MEMBERSHIP_PLUS_LATEST_SHIPMENT_CURRENT_STATE');
must(v172, "INNER JOIN unified_import_batches b ON b.snapshotId=u.snapshotId AND b.reportDate=u.reportDate AND b.status='VALID'");
must(v172, 'WHPP_STANDARD_DAILY_INCOMPLETE');
must(v87, '2026-09-03-v419-whpp-completion-certified-membership-export-v4');
must(v87, 'function completedDailyAuthority');
must(v87, 'function latestEligibleCompletedSnapshots');
must(v87, 'authority?.dailyPresent');
must(v87, 'text(row.snapshotId)===authority.snapshotId');
must(v87, 'WHPP_LEGACY_FINALIZED_SNAPSHOT');
must(v87, 'WHPP_VALID_UNIFIED_DAILY');
must(v87, 'WHPP_VALID_COMPLETED_SNAPSHOT_PNH');
must(v87, 'WHPP_EXPORT_MEMBERSHIP_UNRECOVERABLE');
must(v87, 'function loadSnapshotPayload');
forbid(v87, 'SELECT snapshotId,reportDate,payloadJson,createdAt,id','WHPP export split/count metadata query must not hydrate every snapshot payload');

// Same-day WHPP reupload has one lifecycle owner. Exact same membership keeps a
// finalized day immutable/no-op. A non-empty changed membership starts a new
// lifecycle transaction and makes every old completed artifact ineligible before
// publishing the replacement daily membership.
must(whppStore, "V419_WHPP_REIMPORT_LIFECYCLE_ID = '2026-09-03-v419-whpp-reimport-invalidates-old-completion-v1'");
must(whppStore, 'const explicitEmptyRehydrate = preserveFinalizedLifecycle === true && unique.length === 0');
must(whppStore, 'existingDaily.identicalMembership || explicitEmptyRehydrate');
must(whppStore, "'IDENTICAL_MEMBERSHIP_REUPLOAD'");
must(whppStore, 'function invalidatePriorWhppLifecycle');
must(whppStore, "SET status='INVALID',reconciliationStatus='FAILED',invalidReason=?");
must(whppStore, "DELETE FROM business_history_summary WHERE businessType='WHPP' AND reportDate=?");
for (const table of ['business_scan_results','business_track_events','business_exception_items','business_final_rows']) must(whppStore, `'${table}'`);
must(whppStore, 'WHPP_DAILY_REIMPORT_NEW_LIFECYCLE');
must(whppStore, '[CE-QC][WHPP_REIMPORT_LIFECYCLE_INVALIDATED]');

// WHPP final snapshot certification belongs to the finalize writer. New snapshots
// cannot inherit LEGACY_UNVERIFIED/UNVERIFIED schema defaults. Old 4f53-era
// snapshots may be restored only through exact completed-daily + immutable-member
// attestation; INVALID/FAILED legacy rows remain rejected.
must(whppStore, "V419_WHPP_FINAL_SNAPSHOT_AUTHORITY_ID = '2026-09-03-v419-whpp-final-snapshot-valid-completed-v1'");
must(whppStore, 'function loadLegacyFinalizedWhppSnapshot');
must(whppStore, "if (status === 'INVALID' || reconciliationStatus === 'FAILED') return null");
must(whppStore, 'snapshotMembers.length !== stored.length');
must(whppStore, "INSERT INTO business_export_snapshots(snapshotId,businessType,reportDate,runId,payloadJson,generatedAt,createdAt,status,reconciliationStatus,invalidReason)");
must(whppStore, "VALUES(?,?,?,?,?,?,?,'VALID','COMPLETED','')");
must(whppStore, "reconciliationStatus: 'COMPLETED'");
must(whppStore, 'finalSnapshotAuthority: V419_WHPP_FINAL_SNAPSHOT_AUTHORITY_ID');

// The shell must deliver one V67 runner + the V433 single-status owner policy +
// the V428 base-status retirement owner + V426 import truth + one V132 WHPP page.
must(shell, "const PATCH_ID='2026-09-05-v433-unified-status-stability-loader-v1'");
must(shell, 'v67-resilient-run-guard.js?v=20260904-v424-1');
must(shell, 'v68-whpp-classification-stability.js?v=20260904-v426-1');
must(shell, 'v94-business-source-truth-ui-v2.js?v=20260904-v426-1');
must(shell, 'v428-base-ccsl-status-owner.js?v=20260905-v428-1');
must(shell, 'v169-seven-business-legacy-status-sync.js?v=20260905-v433-1');
must(shell, 'data-previous-src=\"/v169-seven-business-legacy-status-sync.js?v=20260904-v424-1\"');
must(shell, 'v132-whpp-seven-business-fast.js?v=');
must(shell, 'X-CE-QC-V433-Status-Stability');
must(shell, 'Cache-Control');
must(shell, 'no-store, no-cache, must-revalidate, proxy-revalidate');
must(shell, "const WHPP_PAGE_OWNER='V132'");
must(v428, '2026-09-05-v428-retire-base-ccsl-status-writer-v1');
must(v428, 'const original=global.runStatusMarkup');
must(v428, 'function v168OwnsIdleStatus()');
must(v428, 'return original.apply(this,arguments)');
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

// V446 updater contract: after the one remote fetch + isolated candidate gate +
// verified SQLite backup, the installer must advance to that exact already-fetched
// commit locally. Never introduce a second post-verification GitHub pull.
must(managedLauncher, 'V446_LOCAL_EXACT_INSTALL_ID=2026-09-07-v446-local-exact-sha-install-v1');
must(managedLauncher, 'function Install-VerifiedCommitLocally');
must(managedLauncher, "@('cat-file','-e',\"$VerifiedCommit^{commit}\")");
must(managedLauncher, "@('merge','--ff-only','--quiet',$VerifiedCommit)");
must(managedLauncher, 'if ($installed -ne $VerifiedCommit)');
forbid(managedLauncher, "Invoke-RemoteGit @('pull','--ff-only','--quiet','origin','main')");

for (const source of [runner, v68, v94, whppUi, pause, shell, whppSupervisor, v161, storage, bstore, bootstrap, podRepair]) {
  forbid(source, 'v148-direct-daily-runner-v1');
}

// The real updater executes test:golive. Keep the newest truth-boundary
// regressions inside this gate so a candidate cannot install with WHPP carry
// membership leakage, stale same-day completion reuse, uncertified WHPP final
// snapshots, legacy detail/export divergence, stale POD/attempt/signing residue,
// a restart handoff that reopens an already-proven CCSL stage, an explicit
// unified click that re-POSTs an already completed WHPP stage, or a seven-business
// visible total that drops WHPP from core + WHPP (the historical 5060+228=5288 case).
execFileSync(process.execPath,['scripts/v426-unified-completed-stage-skip-smoke.mjs'],{stdio:'inherit',env:{...process.env,NODE_ENV:'test'}});
execFileSync(process.execPath,['scripts/v424-resume-floor-smoke.mjs'],{stdio:'inherit',env:{...process.env,NODE_ENV:'test'}});
execFileSync(process.execPath,['scripts/v424-same-lifecycle-completion-smoke.mjs'],{stdio:'inherit',env:{...process.env,NODE_ENV:'test'}});
execFileSync(process.execPath,['scripts/v419-whpp-valid-snapshot-detail-smoke.mjs'],{stdio:'inherit',env:{...process.env,NODE_ENV:'test'}});
execFileSync(process.execPath,['scripts/v419-whpp-final-snapshot-authority-smoke.mjs'],{stdio:'inherit',env:{...process.env,NODE_ENV:'test'}});
execFileSync(process.execPath,['--test','test/v419-open-single-source.test.js','test/v87-whpp-large-range-export.test.js','test/v419-export-ledger-truth.test.js'],{stdio:'inherit',env:{...process.env,NODE_ENV:'test'}});

console.log('[GOLIVE V446] runtime-source gate passed · V446 exact local-SHA post-verification install is enforced with no second GitHub pull · V168 is the sole fail-closed idle Start owner and V169 cannot re-enable an unconfirmed Start · V428 base app.js stale completion writer remains retired while active V67 CCSL still delegates live 350/50 detail · persisted-complete unified stages are read-only and already-complete WHPP can never be re-POSTed by an explicit unified click · only an actually incomplete WHPP gets one authorized start · balanced seven-business import truth outranks stale WHPP/dashboard summaries, preserving 5060+228=5288 · V433 cache-busted status policy plus V428/V426 truth owners are delivered by the shell · V424 same-proof resume floor prevents completed CCSL from reopening during exact SHOPEE restart recovery · same-lifecycle completion fallback stays current-member-proven and cannot cross a newer VALID import boundary · V67 sole explicit CCSL→SHOPEE→WHPP runner · restart-only continuity · immutable WHPP daily membership across current/history detail+export · changed-member same-day reupload invalidates stale completion before replacement membership is published · identical completed membership remains no-op · new WHPP final snapshots are VALID+COMPLETED at the writer · seven-business truth · V246 strict START→POD · unified export owner · no stale runtime cache');