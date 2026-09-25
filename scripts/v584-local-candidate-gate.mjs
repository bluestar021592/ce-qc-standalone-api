import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MARKER='2026-09-25-v584-local-candidate-fast-gate-v1';
const TIMEOUT_MS=120_000;

// This is the gate used by the installed Windows launcher before it accepts a remote
// candidate. It intentionally validates production shell/navigation, storage policy,
// seven-business classification/export integrity, auth/manual-refresh composition,
// and the fast purge safety contracts. Long detached-worker crash/recovery soak tests
// remain mandatory in CI (test:golive-full) but must not reject a good update merely
// because a slower workstation/antivirus cannot finish a 3-minute synthetic worker
// scenario inside the desktop updater.
const TASKS=[
  ['node',['scripts/v584-local-update-gate-smoke.mjs']],
  ['node',['--check','bootstrap.js']],
  ['node',['--check','server.js']],
  ['node',['--check','src/v581StableShellResponsePatch.js']],
  ['node',['--check','public/v581-stable-shell-owner.js']],
  ['node',['scripts/v480-first-paint-static-smoke.mjs']],
  ['node',['scripts/v581-production-shell-browser-smoke.mjs']],
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

console.log(`[V584_LOCAL_GATE] ${MARKER} starting ${TASKS.length} bounded tasks`);
for(let i=0;i<TASKS.length;i+=1){
  const [kind,args]=TASKS[i];
  const exe=kind==='node'?process.execPath:kind;
  console.log(`[V584_LOCAL_GATE] ${i+1}/${TASKS.length} ${kind} ${args.join(' ')}`);
  const result=spawnSync(exe,args,{
    cwd:ROOT,
    env:{...process.env,CE_QC_LOCAL_CANDIDATE_GATE:'1'},
    stdio:'inherit',
    windowsHide:true,
    timeout:TIMEOUT_MS,
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
