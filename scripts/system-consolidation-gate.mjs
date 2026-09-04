import { execFileSync } from 'node:child_process';

const node=process.execPath;
const env={...process.env,NODE_ENV:'test',CI:'1',CE_QC_DISABLE_CARRY_REFRESH:'1',CE_QC_DISABLE_V246_TRACKING:'1'};
const checks=[
  // New architecture invariants.
  'scripts/system-storage-policy-smoke.mjs',
  'scripts/system-ui-loader-smoke.mjs',
  'scripts/system-processing-status-smoke.mjs',
  // Business behavior still required after old version names disappear.
  'scripts/v349-confirm-completeness-smoke.mjs',
  'scripts/v294-zero-loss-import-smoke.mjs',
  'scripts/v294-clean-reupload-integrity-smoke.mjs',
  'scripts/v294-carryover-next-day-smoke.mjs',
  'scripts/v246-tracking-core-smoke.mjs',
  'scripts/v246-ledger-reconcile-smoke.mjs',
  'scripts/v293-whpp-history-range-smoke.mjs',
  'scripts/v365-daily-transition-smoke.mjs',
  'scripts/v366-daily-runtime-smoke.mjs'
];

for(const file of checks){
  console.log(`[SYSTEM GATE] running ${file}`);
  execFileSync(node,[file],{stdio:'inherit',env});
}
console.log('[SYSTEM CONSOLIDATION GATE] passed · storage + UI loader + single processing truth + scan/track completeness + zero-loss import + clean reupload + next-day carry + tracking ledger + WHPP history + daily transition/runtime');