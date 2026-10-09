import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MARKER='2026-10-03-v621-release-without-cloud-edge-block-v1';
const TIMEOUT_MS=120_000;

function readChangedFiles(){
  const installed=String(process.env.CE_QC_INSTALLED_COMMIT||'').trim();
  const pushBefore=String(process.env.GITHUB_EVENT_BEFORE||'').trim();
  const usablePushBefore=/^[0-9a-f]{40}$/i.test(pushBefore)&&!/^0{40}$/.test(pushBefore);
  const args=installed
    ? ['diff','--name-only',installed,'HEAD','--']
    : usablePushBefore
      ? ['diff','--name-only',pushBefore,'HEAD','--']
      : ['diff','--name-only','HEAD^1','HEAD','--'];
  const run=spawnSync('git',args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:15_000});
  if(run.error||run.status!==0){
    console.warn('[V589_LOCAL_GATE] changed-file detection unavailable; real browser gate stays enabled (fail-safe)');
    return {unknown:true,files:[]};
  }
  return {unknown:false,files:String(run.stdout||'').split(/\r?\n/).map(v=>v.trim()).filter(Boolean)};
}
function isBrowserSensitive(file){
  const p=String(file||'').replace(/\\/g,'/');
  return p.startsWith('public/') || p==='bootstrap.js' || p==='server.js' || p==='src/v581StableShellResponsePatch.js' || p==='scripts/v581-production-shell-browser-smoke.mjs' || p==='scripts/v587-production-browser-retry.mjs';
}
const changed=readChangedFiles();
const browserSensitive=changed.unknown || changed.files.some(isBrowserSensitive);


// This is the gate used by the installed Windows launcher before it accepts a remote
// candidate. It intentionally validates production shell/navigation, storage policy,
// seven-business classification/export integrity, auth/manual-refresh composition,
// and the fast purge safety contracts. Long detached-worker crash/recovery soak tests
// remain mandatory in CI (test:golive-full) but must not reject a good update merely
// because a slower workstation/antivirus cannot finish a 3-minute synthetic worker
// scenario inside the desktop updater.
const TASKS=[
  ['node',['scripts/v584-local-update-gate-smoke.mjs']],
  ['node',['--check','src/shopWhitelist.js']],
  ['node',['scripts/v778-shop-code-admin-priority-smoke.mjs']],
  ['node',['scripts/v780-complete-72-current-stores-smoke.mjs']],
  ['node',['scripts/v783-seven-business-source-reconciliation-smoke.mjs']],
  ['node',['scripts/v782-retired-store-node-smoke.mjs']],
  ['node',['--test','test/trajectory-facts-analyzer-integration.test.js']],
  ['node',['--check','bootstrap.js']],
  ['node',['--check','server.js']],
  ['node',['--check','src/homeQualitySummary.js']],
  ['node',['--check','src/selectedDateTimingEvidenceRepair.js']],
  ['node',['--check','src/businessStore.js']],
  ['node',['--check','src/whppStore.js']],
  ['node',['--check','src/shipmentStatusTruth.js']],
  ['node',['--check','src/shopeeTemplateExporter.js']],
  ['node',['--check','src/periodExporter.js']],
  ['node',['--check','src/qcActionDetailRead.js']],
  ['node',['--check','scripts/reset-local-admin-password.mjs']],
  ['node',['--check','public/v625-shell.js']],
  ['node',['--check','src/v581StableShellResponsePatch.js']],
  ['node',['--check','public/v581-stable-shell-owner.js']],
  ['node',['scripts/v480-first-paint-static-smoke.mjs']],
  ['node',['scripts/v573-head-interaction-storage-smoke.mjs']],
  ['node',['scripts/v572-dual-drive-storage-smoke.mjs']],
  ['node',['scripts/v578-dedicated-drive-cleanup-smoke.mjs']],
  ['node',['scripts/v536-disable-auto-dashboard-cache-worker.mjs']],
  ['node',['scripts/v473-all-export-sidecar-smoke.mjs']],
  ['node',['scripts/v479-canonical-ledger-pk-smoke.mjs']],
  ['node',['scripts/v481-business-scoped-verified-metrics-smoke.mjs']],
  ['node',['scripts/v482-three-business-export-evidence-preflight-smoke.mjs']],
  ['node',['scripts/v483-export-member-strict-evidence-smoke.mjs']],
  ['node',['scripts/v484-actual-member-local-first-export-evidence-smoke.mjs']],
  ['node',['scripts/v485-nested-track-v266-evidence-smoke.mjs']],
  ['node',['scripts/v486-strict-track-semantic-start-smoke.mjs']],
  ['node',['scripts/v489-formal-export-canonical-ledger-hotpath-smoke.mjs']],
  ['node',['scripts/v645-selected-date-timing-and-board-isolation-smoke.mjs']],
  ['node',['scripts/v647-local-timing-publication-smoke.mjs']],
  ['node',['scripts/v648-clean-reupload-timing-smoke.mjs']],
  ['node',['scripts/v650-import-progress-export-template-smoke.mjs']],
  ['node',['scripts/v652-progress-and-export-job-smoke.mjs']],
  ['node',['scripts/v653-nested-track-signing-evidence-smoke.mjs']],
  ['node',['scripts/v656-canonical-pod-postrun-timing-smoke.mjs']],
  ['node',['scripts/v658-dashboard-pod-membership-smoke.mjs']],
  ['node',['scripts/v659-restart-proof-completion-pod-smoke.mjs']],
  ['node',['scripts/v660-immutable-snapshot-truth-smoke.mjs']],
  ['node',['scripts/v661-canonical-pod-firstclass-timing-smoke.mjs']],
  ['node',['scripts/v662-single-dashboard-pod-truth-smoke.mjs']],
  ['node',['scripts/v663-whpp-completion-projection-timing-diag-smoke.mjs']],
  ['node',['scripts/v664-v645-gate-alignment-smoke.mjs']],
  ['node',['scripts/v668-selected-date-truth-smoke.mjs']],
  ['node',['scripts/v670-persistent-selected-date-sqlite-smoke.mjs']],
  ['node',['scripts/v672-selected-date-persistent-truth-wiring-smoke.mjs']],
  ['node',['scripts/v675-dashboard-equivalent-pod-persistence-smoke.mjs']],
  ['node',['scripts/v677-whpp-dual-route-convergence-smoke.mjs']],
  ['node',['scripts/v678-timing-cache-denominator-guard-smoke.mjs']],
  ['node',['scripts/v679-july1-acceptance-contract-smoke.mjs']],
  ['node',['scripts/v681-selected-date-final-acceptance-smoke.mjs']],
  ['node',['scripts/v684-real-diagnostic-nullsafe-progress-smoke.mjs']],
  ['node',['scripts/v685-whpp-projection-gate-alignment-smoke.mjs']],
  ['node',['scripts/v686-dual-track-endpoint-timing-repair-smoke.mjs']],
  ['node',['scripts/v687-per-bill-timing-fallback-smoke.mjs']],
  ['node',['scripts/v689-completed-snapshot-timing-fallback-smoke.mjs']],
  ['node',['scripts/v690-saved-terminal-pod-timing-smoke.mjs']],
  ['node',['scripts/v691-v689-v690-gate-alignment-smoke.mjs']],
  ['node',['scripts/v700-persistent-timing-evidence-smoke.mjs']],
  ['node',['scripts/v711-shipment-status-60-80-81-smoke.mjs']],
  ['node',['scripts/v712-live-shipment-status-pipeline-smoke.mjs']],
  ['node',['scripts/v713-long-run-no-browser-abort-smoke.mjs']],
  ['node',['scripts/v715-pod-time-recovery-smoke.mjs']],
  ['node',['scripts/v717-whpp-progress-owner-smoke.mjs']],
  ['node',['scripts/v718-resume-progress-smoke.mjs']],
  ['node',['scripts/v719-valid-html-shell-smoke.mjs']],
  ['node',['scripts/v720-live-progress-resilience-smoke.mjs']],
  ['node',['scripts/v721-transport-recovery-smoke.mjs']],
  ['node',['scripts/v722-interaction-first-fast-reads-smoke.mjs']],
  ['node',['scripts/v733-full-ledger-status-conservation-smoke.mjs']],
  ['node',['scripts/v737-status-first-historical-timing-smoke.mjs']],
  ['node',['scripts/v738-whpp-completed-progress-lock-smoke.mjs']],
  ['node',['scripts/v739-import-completed-3of3-lock-smoke.mjs']],
  ['node',['scripts/v740-confirm-first-historical-timing-smoke.mjs']],
  ['node',['scripts/v741-historical-timing-closed-loop-smoke.mjs']],
  ['node',['scripts/v742-daily-report-signing-time-smoke.mjs']],
  ['node',['scripts/v743-latest-daily-report-signing-backfill-smoke.mjs']],
  ['node',['scripts/v744-signing-ui-and-terminal-backfill-smoke.mjs']],
  ['node',['scripts/v745-whpp-timing-source-diagnostics-smoke.mjs']],
  ['node',['scripts/v746-whpp-canonical-daily-timing-smoke.mjs']],
  ['node',['scripts/v747-offline-safe-dependency-gate-smoke.mjs']],
  ['node',['scripts/v748-per-board-track-quality-signals-smoke.mjs']],
  ['node',['scripts/v769-qc-action-detail-smoke.mjs']],
  ['node',['scripts/v770-whpp-action-detail-provenance-smoke.mjs']],
  ['node',['scripts/qc-action-center-readonly-smoke.mjs']],
  ['node',['scripts/v784-qc-date-zero-evidence-smoke.mjs']],
  ['node',['scripts/v785-july2-whpp-pod-return-carry-smoke.mjs']],
  ['node',['scripts/v776-qc-closed-waybill-lookup-smoke.mjs']],
  ['node',['scripts/v773-local-admin-reset-smoke.mjs']],
  ['node',['--test',
    'test/unified-import-v7.test.js',
    'test/unified-import-ceaf.test.js',
    'test/unified-import-no-silent-skip.test.js',
    'test/unified-import-duplicate-classification.test.js',
    'test/unified-import-hidden-region-integrity.test.js',
    'test/unified-partition-carry-business.test.js',
    'test/source-six-business-persistence.test.js',
    'test/seven-business-export-classification-reconciliation.test.js',
    'test/v512-whpp-source-membership-guard.test.js',
    'test/v514-canonical-export-membership-guard.test.js',
    'test/manual-refresh-export-integrity.test.js',
    'test/v506-local-auth-bridge.test.js',
    'test/v507-integrated-release.test.js'
  ]],
  ['node',['--import','./test/v534-windows-v505-temp-cleanup-shim.mjs','--test',
    'test/v505-purge-global-guard.test.js',
    'test/v505-purge-ui-delivery.test.js',
    'test/v505-purge-public-status-privacy.test.js',
    'test/v505-purge-worker-entrypoint-invariant.test.js',
    'test/v505-purge-no-reseal-caller.test.js',
    'test/v560-direct-purge.test.js'
  ]]
];

// V621: hosted/headless Edge is diagnostic only. It must never block a desktop
// release because CDP Runtime.evaluate can stall even while the page's own timers
// and physical navigation remain alive. Syntax/static/data-integrity/storage/auth
// checks remain mandatory below.
if(browserSensitive){
  console.log('[V621_LOCAL_GATE] browser-sensitive candidate detected; cloud Edge smoke is NON-BLOCKING diagnostic only');
}else{
  console.log('[V621_LOCAL_GATE] non-browser candidate; no Edge diagnostic required');
}

console.log(`[V584_LOCAL_GATE] ${MARKER} starting ${TASKS.length} bounded tasks`);
for(let i=0;i<TASKS.length;i+=1){
  const [kind,args,taskTimeoutMs=TIMEOUT_MS]=TASKS[i];
  const exe=kind==='node'?process.execPath:kind;
  console.log(`[V584_LOCAL_GATE] ${i+1}/${TASKS.length} ${kind} ${args.join(' ')} timeoutMs=${taskTimeoutMs}`);
  const result=spawnSync(exe,args,{
    cwd:ROOT,
    env:{...process.env,CE_QC_LOCAL_CANDIDATE_GATE:'1'},
    stdio:'inherit',
    windowsHide:true,
    timeout:taskTimeoutMs,
    killSignal:'SIGTERM'
  });
  if(result.error){
    const timedOut=String(result.error.code||'')==='ETIMEDOUT';
    console.error(`[V584_LOCAL_GATE] task ${i+1} ${timedOut?'timed out':'failed to launch'}: ${result.error.message}`);
    process.exit(1);
  }
  if(result.status!==0){
    console.error(`[V584_LOCAL_GATE] task ${i+1} failed exit=${result.status}`);
    process.exit(result.status||1);
  }
}
console.log(`[V584_LOCAL_GATE] PASS ${MARKER} · desktop candidate is safe to install; long detached-worker soak remains CI-only`);
