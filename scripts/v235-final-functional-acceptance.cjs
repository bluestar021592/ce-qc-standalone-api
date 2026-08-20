const fs = require('fs');
const { spawnSync } = require('node:child_process');

const GROUPS = Object.freeze({
  DAY_WEEK_MONTH_AND_DASHBOARD_DETAIL_PARITY: [
    'test/v235-final-functional-acceptance.test.js',
    'test/v9-period-range.test.js',
    'test/v27-dashboard-interaction.test.js',
    'test/v55-dashboard-reconciliation.test.js',
    'test/v61-drilldown-route-bridge.test.js'
  ],
  PENDING_OC_STORE_580_SELF_PICKUP_RETURN_POD_RULES: [
    'test/v9-special-nodes.test.js',
    'test/v10-pending-and-exclusivity.test.js',
    'test/v11-terminal-isolation-return.test.js',
    'test/v12-business-rule-hardening.test.js',
    'test/v14-pod-lock-carryover.test.js',
    'test/v30-general-track-codes.test.js',
    'test/v30-scan-track-code-separation.test.js',
    'test/v85-business-state-rules.test.js',
    'test/v86-strict-track-status-gate.test.js'
  ],
  SHOPEE_REAL_ATTEMPT_AND_CURRENT_SOURCE_TRUTH: [
    'test/shopee-latest-track-classification.test.js',
    'test/shopee-golive-accounting-ui.test.js',
    'test/v94-fast-dashboard-whpp-precedence.test.js'
  ],
  WHPP_TERMINAL_AND_RESPONSIBILITY_AUTHORITY: [
    'test/v52-whpp-source-truth-routing.test.js',
    'test/v68-whpp-classification-stability.test.js',
    'test/v92-whpp-terminal-authority.test.js',
    'test/v94-shopee-whpp-source-truth.test.js',
    'test/whpp-shop-metrics-parity.test.js'
  ],
  REAL_XLSX_EXPORT_LINKS_SEVEN_BUSINESS_AND_RESUME: [
    'test/v13-export-link-region-hardening.test.js',
    'test/shopee-template-export.test.js',
    'test/v84-async-large-range-export.test.js',
    'test/v87-whpp-large-range-export.test.js',
    'test/v88-export-job-resume.test.js',
    'test/v142-seven-business-history-export.test.js'
  ],
  FAIL_CLOSED_DESKTOP_UPDATE_ACTIVATION: [
    'test/v106-desktop-update-gate.test.js',
    'test/v126-stable-candidate-gate.test.js'
  ]
});

const MUST_EXIST = [
  'src/v202DeliveryTruth.js',
  'src/v203DashboardIntegrityPatch.js',
  'src/rangeDashboardStoreV55.js',
  'src/v142SevenBusinessPeriodExporter.js',
  'src/v142AsyncExportPreflightPatch.js',
  'src/v84AsyncExportPatch.js',
  'tools/CE_QC_Managed_Launcher.ps1'
];

for (const file of [...MUST_EXIST, ...new Set(Object.values(GROUPS).flat())]) {
  if (!fs.existsSync(file)) throw new Error(`V235 required acceptance asset missing: ${file}`);
}

const source = file => fs.readFileSync(file, 'utf8');
const must = (text, token, label) => {
  if (!text.includes(token)) throw new Error(`V235 ${label} missing contract token: ${token}`);
};
const forbid = (text, token, label) => {
  if (text.includes(token)) throw new Error(`V235 ${label} contains forbidden token: ${token}`);
};

const delivery = source('src/v202DeliveryTruth.js');
must(delivery, 'resolveV202AttemptCycle', 'Shopee attempt truth');
must(delivery, 'Repeated START scans while the same attempt is still open never create a new attempt', 'Shopee attempt truth');
must(delivery, 'Only a NEW START after a failed attempt opens attempt 2/3+', 'Shopee attempt truth');
must(delivery, 'Elapsed calendar days, code60 assignment and raw Pending count NEVER manufacture an attempt', 'Shopee attempt truth');
must(delivery, "status === 'W' || status === 'Y'", 'Shopee daily dispatch evidence');

const attemptDashboard = source('src/v203DashboardIntegrityPatch.js');
must(attemptDashboard, '/api/v203/attempt-summary', 'Shopee attempt dashboard');
must(attemptDashboard, 'a1Rate=ratio(combined.a1,combined.pod)', 'Shopee first-attempt rate');
must(attemptDashboard, 'a2Rate=ratio(combined.a2,combined.pod)', 'Shopee second-attempt rate');
must(attemptDashboard, 'a3Rate=ratio(combined.a3,combined.pod)', 'Shopee third-attempt rate');
must(attemptDashboard, '派次占比以POD票数为分母', 'Shopee attempt denominator');
must(attemptDashboard, '证据不足单独显示，不强行算1派', 'Shopee unknown attempt protection');

const v55 = source('src/rangeDashboardStoreV55.js');
must(v55, 'state.detailTabs = { ...(state.detailTabs || {}), ...details }', 'dashboard-detail parity');
must(v55, 'loadMetricDetail', 'dashboard-detail parity');
must(v55, 'CCSL580', '580 destination');
must(v55, "tab('外省未完结POD件'", 'province unresolved detail');

const strictExport = source('src/v142SevenBusinessPeriodExporter.js');
must(strictExport, "ALL_TYPES=[...CORE_TYPES,'WHPP']", 'seven-business export');
must(strictExport, '历史完整性校验未通过，已阻止缺数据导出', 'seven-business export completeness');
const preflight = source('src/v142AsyncExportPreflightPatch.js');
must(preflight, 'SEVEN_BUSINESS_HISTORY_INCOMPLETE', 'async export preflight');
const asyncExport = source('src/v84AsyncExportPatch.js');
must(asyncExport, 'detached: true', 'async export');
must(asyncExport, 'reusableJob', 'export resume/reuse');

const managed = source('tools/CE_QC_Managed_Launcher.ps1');
must(managed, "Invoke-Exe $script:NpmExe @('run','test:golive')", 'managed update candidate gate');
must(managed, 'Candidate validation did not return one clean TRUE result; installation blocked.', 'managed update candidate gate');
must(managed, "@('pull','--ff-only'", 'managed update fast-forward install');
forbid(managed, 'reset --hard', 'managed update safety');
const candidateTest = managed.indexOf("Invoke-Exe $script:NpmExe @('run','test:golive')");
const candidateBackup = managed.indexOf("$candidateBackup = Join-Path $tempRoot 'scripts\\CE_QC_PreUpdate_Backup.mjs'");
const install = managed.indexOf("@('pull','--ff-only'");
if (candidateTest < 0 || candidateBackup <= candidateTest || install <= candidateBackup) {
  throw new Error('V235 managed update ordering invalid: candidate test:golive -> verified DB backup -> ff-only install is mandatory.');
}

const allTests = [...new Set(Object.values(GROUPS).flat())];
console.log('[V235] final functional acceptance matrix:');
for (const [name, tests] of Object.entries(GROUPS)) console.log(`  ${name}: ${tests.length} tests`);
console.log(`[V235] executing ${allTests.length} unique test files serially as one fail-closed suite...`);

const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...allTests], {
  encoding: 'utf8',
  env: process.env,
  timeout: 420000,
  windowsHide: true
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`V235 final functional acceptance failed with exit ${result.status}`);
}

console.log('CE_QC_V235_DAY_WEEK_MONTH=PASS');
console.log('CE_QC_V235_DASHBOARD_DETAIL_PARITY=PASS');
console.log('CE_QC_V235_BUSINESS_RULES=PASS');
console.log('CE_QC_V235_SHOPEE_REAL_ATTEMPTS=PASS');
console.log('CE_QC_V235_WHPP_AUTHORITY=PASS');
console.log('CE_QC_V235_EXPORT_AND_RESUME=PASS');
console.log('CE_QC_V235_FAIL_CLOSED_UPDATE=PASS');
console.log('CE_QC_V235_FINAL_FUNCTIONAL_ACCEPTANCE=PASS');
