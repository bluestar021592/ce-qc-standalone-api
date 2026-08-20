const fs = require('fs');
const { spawnSync } = require('node:child_process');

const recovery = fs.readFileSync('src/v221BootstrapRecoveryPatch.js', 'utf8');
const v46 = fs.readFileSync('src/v46ColdStartIndexPatch.js', 'utf8');
const auth = fs.readFileSync('src/v209LoginReliabilityPatch.js', 'utf8');
const sidecar = fs.readFileSync('src/v213AuthSidecar.js', 'utf8');
const inject = fs.readFileSync('src/v225AuthBootstrapGuardPatch.js', 'utf8');
const browser = fs.readFileSync('public/v225-auth-bootstrap-guard.js', 'utf8');
const dateTruth = fs.readFileSync('src/v226LatestReportDateQueryPatch.js', 'utf8');
const health = fs.readFileSync('src/v227LocalHealthProbePatch.js', 'utf8');
const launcher = fs.readFileSync('src/v228LocalLauncherRootProbePatch.js', 'utf8');
const liveDataHealth = fs.readFileSync('src/v232LiveDataHealthGatePatch.js', 'utf8');
const desktopLauncher = fs.readFileSync('Start_CE_QC.ps1', 'utf8');
const runtimeE2E = fs.readFileSync('scripts/v225-runtime-e2e.mjs', 'utf8');
const localSevenBoard = fs.readFileSync('scripts/v233-seven-board-local-truth-smoke.mjs', 'utf8');
const restartE2E = fs.readFileSync('scripts/v234-restart-persistence-e2e.mjs', 'utf8');
const finalFunctional = fs.readFileSync('scripts/v235-final-functional-acceptance.cjs', 'utf8');
const canonicalAudit = fs.readFileSync('scripts/v241-readonly-canonical-membership.mjs', 'utf8');
const canonicalAuditTest = fs.readFileSync('test/v241-readonly-canonical-audit.test.js', 'utf8');
const stableGateTest = fs.readFileSync('test/v243-stable-canonical-gate-contract.test.js', 'utf8');

const must = (source, token) => {
  if (!source.includes(token)) throw new Error(`V243 recovery gate missing: ${token}`);
};
const mustNot = (source, token) => {
  if (source.includes(token)) throw new Error(`V243 recovery gate contains forbidden legacy rule: ${token}`);
};
const run = (args, timeout = 180000) => {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env, timeout });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`V243 command failed: node ${args.join(' ')}\n${result.stdout || ''}\n${result.stderr || ''}`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
};

must(v46, "import './v226LatestReportDateQueryPatch.js';");
must(v46, "import './v221BootstrapRecoveryPatch.js';");
must(v46, "import './v225AuthBootstrapGuardPatch.js';");
must(v46, "import './v227LocalHealthProbePatch.js';");
must(v46, "import './v228LocalLauncherRootProbePatch.js';");
must(v46, "import './v232LiveDataHealthGatePatch.js';");
must(dateTruth, 'reportDate DESC');
must(health, "req.path!=='/api/health'");
must(health, 'LOOPBACK_READINESS_ONLY');
must(launcher, "req.path!=='/'");
must(launcher, 'READY_AUTH_REQUIRED');
must(recovery, "bootstrapMode: 'PERSISTED_RECOVERY_SUMMARY'");
must(recovery, "source: 'DASHBOARD_DAILY_CACHE'");
must(recovery, "'LEGACY_PERSISTED_TABLES'");
must(recovery, 'function makeWhppState()');
must(recovery, "WHERE b.status='VALID'");
must(recovery, 'canonical ledger first, persisted dashboard cache/legacy summary fallback');
must(auth, "const HANDOFF_PATH='/api/v223/fast-auth/accept';");
must(auth, 'V223_AUTH_HANDOFF_OK');
must(auth, 'await acceptHandoff(payload.handoffToken)');
must(sidecar, 'handoffToken:issued.token');
must(inject, '/v225-auth-bootstrap-guard.js');
must(browser, "path!=='/api/bootstrap'&&path!=='/api/session'");
must(browser, 'redirectToFreshAuth');

must(desktopLauncher, "scripts\\v225-local-db-truth-smoke.mjs");
must(desktopLauncher, '$HealthUrl = "$LocalUrl/api/health"');
must(desktopLauncher, 'Invoke-WebRequest $HealthUrl');
must(desktopLauncher, '$status -eq 200');
must(desktopLauncher, 'LOOPBACK_READINESS_ONLY');
must(desktopLauncher, 'Persisted data gate:');
must(desktopLauncher, 'HTTP 401/403/404 no longer counts as BACKEND READY.');
must(desktopLauncher, 'BACKEND READY - exact health + local data gate passed');
mustNot(desktopLauncher, '$status -ge 200 -and $status -lt 500');
const truthGateCalls = [...desktopLauncher.matchAll(/Invoke-PersistedDataTruthGate/g)].map(match => match.index);
const truthGate = truthGateCalls.at(-1) ?? -1;
const startBackend = desktopLauncher.indexOf("Write-Host 'Starting backend and waiting for the exact loopback health acceptance...'");
const openBrowser = desktopLauncher.indexOf('Start-Process $LocalUrl');
if (truthGateCalls.length < 2 || truthGate < 0 || startBackend <= truthGate || openBrowser <= startBackend) {
  throw new Error('V243 desktop launcher ordering invalid: local DB truth -> exact health -> browser must remain fail-closed.');
}

must(runtimeE2E, "await waitFor(`${AUTH_ORIGIN}/api/v213/auth-ping`");
must(runtimeE2E, "await waitFor(`${APP_ORIGIN}/api/health`");
must(runtimeE2E, 'timeoutMs:90000');
must(runtimeE2E, "healthPayload?.scope!=='LOOPBACK_READINESS_ONLY'");
must(runtimeE2E, "healthResponse.headers.get('x-ce-qc-data-gate')!=='V232-LIVE-PERSISTED-BOARDS'");
must(runtimeE2E, "healthPayload?.dataState!=='PERSISTED_BOARDS_READY'");
must(runtimeE2E, 'Number(healthPayload?.nonZeroBusinessCount||0)!==7');
must(runtimeE2E, '[V232] isolated runtime E2E passed');
const authReady = runtimeE2E.indexOf("await waitFor(`${AUTH_ORIGIN}/api/v213/auth-ping`");
const appReady = runtimeE2E.indexOf("await waitFor(`${APP_ORIGIN}/api/health`");
const loginRequest = runtimeE2E.indexOf('/api/v213/local-auth/login');
if (authReady < 0 || appReady <= authReady || loginRequest <= appReady) {
  throw new Error('V243 runtime E2E ordering invalid: auth sidecar ready -> live seven-board health ready -> login/handoff.');
}

must(liveDataHealth, "['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']");
must(liveDataHealth, "req.path!=='/api/health'");
must(liveDataHealth, 'V232-LIVE-PERSISTED-BOARDS');
must(liveDataHealth, 'V237-5177-5178-5179');
must(liveDataHealth, '/api/v213/auth-ping');
must(liveDataHealth, '/api/v194/export-ping');
must(liveDataHealth, "startupState:ready?'APP_AUTH_EXPORT_READY':'STARTUP_TRIPLET_INCOMPLETE'");
must(liveDataHealth, "dataState:'EMPTY_INSTALL'");
must(liveDataHealth, "dataState:ready?'PERSISTED_BOARDS_READY':'PERSISTED_BOARDS_INCOMPLETE'");
must(liveDataHealth, 'zeroBusinessTypes');
must(liveDataHealth, "scope:'LOOPBACK_READINESS_ONLY'");
mustNot(liveDataHealth, 'status(401)');

must(localSevenBoard, "from './v241-readonly-canonical-membership.mjs'");
must(localSevenBoard, 'new DatabaseSync(file,{readOnly:true})');
must(localSevenBoard, 'PRAGMA query_only=ON');
must(localSevenBoard, 'CE_QC_V233_LATEST_DATE=');
must(localSevenBoard, 'CE_QC_V233_SEVEN_BOARD_TRUTH=PASS_READ_ONLY');
must(localSevenBoard, 'CE_QC_CANONICAL_MEMBERSHIP=PASS_READ_ONLY');
must(localSevenBoard, 'CE_QC_V233_READ_ONLY=CONFIRMED');
mustNot(localSevenBoard, 'INSERT INTO');
mustNot(localSevenBoard, 'UPDATE ');
mustNot(localSevenBoard, 'DELETE FROM');

must(canonicalAudit, "V241_TYPES=Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'])");
must(canonicalAudit, "IN ('VALID','SUPERSEDED')");
must(canonicalAudit, "UPPER(COALESCE(s.status,''))='COMPLETED'");
must(canonicalAudit, "UPPER(COALESCE(businessType,''))='SHOPEE'");
must(canonicalAudit, 'persistedFinalSupplementCount');
must(canonicalAudit, 'sourceMode');
must(canonicalAudit, 'podRegressions');
must(canonicalAudit, 'current.pod-normalized.pod');
must(canonicalAudit, 'source.sourceCount===normalized.count');
must(canonicalAudit, 'source.sourceCount===current.count');
mustNot(canonicalAudit, 'INSERT INTO');
mustNot(canonicalAudit, 'UPDATE ');
mustNot(canonicalAudit, 'DELETE FROM');
must(canonicalAuditTest, 'current POD may advance beyond normalized daily POD');
must(canonicalAuditTest, 'blocks an actual POD regression per waybill');
must(canonicalAuditTest, 'fully missing ShopeeCN source ledger');
must(canonicalAuditTest, 'partially truncated ShopeeVN ledger');
must(stableGateTest, 'stable unversioned canonical acceptance marker');

must(restartE2E, "const REPORT_DATE='2026-08-17'");
must(restartE2E, "const REQUIRED_TYPES=Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'])");
must(restartE2E, 'await waitPortsClosed([APP_PORT,AUTH_PORT,EXPORT_PORT]');
must(restartE2E, "spawnSync('taskkill',['/PID',String(rootPid),'/T','/F']");
must(restartE2E, 'first=await startAndAccept(1)');
must(restartE2E, 'await terminateProcessTree(first)');
must(restartE2E, 'second=await startAndAccept(2)');
must(restartE2E, 'second.authPid===firstAuthPid');
must(restartE2E, 'JSON.stringify(seeded)!==JSON.stringify(finalTruth)');
must(restartE2E, '[V234] restart persistence E2E passed');
const seedCalls=[...restartE2E.matchAll(/await seedOnce\(\)/g)];
if(seedCalls.length!==1)throw new Error(`V243 restart acceptance must seed exactly once; found ${seedCalls.length}.`);
const firstStart=restartE2E.indexOf('first=await startAndAccept(1)');
const firstStop=restartE2E.indexOf('await terminateProcessTree(first)');
const secondStart=restartE2E.indexOf('second=await startAndAccept(2)');
const secondStop=restartE2E.indexOf('await terminateProcessTree(second)');
if(firstStart<0||firstStop<=firstStart||secondStart<=firstStop||secondStop<=secondStart)throw new Error('V243 restart ordering invalid: start1 -> full stop -> same DB start2 -> full stop.');

for (const token of [
  'DAY_WEEK_MONTH_AND_DASHBOARD_DETAIL_PARITY',
  'PENDING_OC_STORE_580_SELF_PICKUP_RETURN_POD_RULES',
  'SHOPEE_REAL_ATTEMPT_AND_CURRENT_SOURCE_TRUTH',
  'WHPP_TERMINAL_AND_RESPONSIBILITY_AUTHORITY',
  'REAL_XLSX_EXPORT_LINKS_SEVEN_BUSINESS_AND_RESUME',
  'FAIL_CLOSED_DESKTOP_UPDATE_ACTIVATION',
  'CE_QC_V235_FINAL_FUNCTIONAL_ACCEPTANCE=PASS'
]) must(finalFunctional, token);
must(finalFunctional, 'test/v235-final-functional-acceptance.test.js');
must(finalFunctional, 'test/v55-dashboard-reconciliation.test.js');
must(finalFunctional, 'test/v85-business-state-rules.test.js');
must(finalFunctional, 'test/v92-whpp-terminal-authority.test.js');
must(finalFunctional, 'test/v142-seven-business-history-export.test.js');
must(finalFunctional, 'test/v106-desktop-update-gate.test.js');
must(finalFunctional, 'test/v237-startup-triplet-health.test.js');
must(finalFunctional, "Invoke-Exe $script:NpmExe @('run','test:golive')", '');

run(['--check', 'src/v226LatestReportDateQueryPatch.js']);
run(['scripts/v226-latest-report-date-query-smoke.mjs']);
run(['--check', 'src/v227LocalHealthProbePatch.js']);
run(['--check', 'src/v228LocalLauncherRootProbePatch.js']);
run(['--check', 'src/v232LiveDataHealthGatePatch.js']);
run(['--check', 'scripts/v241-readonly-canonical-membership.mjs']);
run(['--check', 'scripts/v233-seven-board-local-truth-smoke.mjs']);
run(['--check', 'scripts/v234-restart-persistence-e2e.mjs']);
run(['--check', 'scripts/v235-final-functional-acceptance.cjs']);
run(['--check', 'test/v241-readonly-canonical-audit.test.js']);
run(['--check', 'test/v243-stable-canonical-gate-contract.test.js']);
run(['--check', 'test/v235-final-functional-acceptance.test.js']);
run(['--check', 'test/v237-startup-triplet-health.test.js']);
run(['--check', 'src/v225AuthBootstrapGuardPatch.js']);
run(['--check', 'public/v225-auth-bootstrap-guard.js']);
run(['--check', 'src/v209LoginReliabilityPatch.js']);
run(['--check', 'src/v213AuthSidecar.js']);
run(['--test', 'test/v211-fast-auth.test.js']);
run(['--test', 'test/v241-readonly-canonical-audit.test.js']);
run(['--test', 'test/v243-stable-canonical-gate-contract.test.js']);
run(['scripts/v225-local-db-truth-smoke.mjs']);
run(['scripts/v233-seven-board-local-truth-smoke.mjs']);
run(['scripts/v225-runtime-e2e.mjs']);
run(['scripts/v234-restart-persistence-e2e.mjs'], 300000);
run(['scripts/v235-final-functional-acceptance.cjs'], 480000);

console.log('[V243] candidate runtime gate passed: stable canonical membership contract -> latest local DB truth -> seven persisted non-zero boards -> exact 5177/5178/5179 health -> auth/bootstrap -> same-DB restart persistence -> final functional matrix. Version-specific diagnostic markers may evolve without breaking the updater contract.');
