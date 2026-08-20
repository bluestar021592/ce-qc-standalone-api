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

const must = (source, token) => {
  if (!source.includes(token)) throw new Error(`V232 recovery gate missing: ${token}`);
};
const mustNot = (source, token) => {
  if (source.includes(token)) throw new Error(`V232 recovery gate contains forbidden legacy rule: ${token}`);
};
const run = args => {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env, timeout: 180000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`V232 command failed: node ${args.join(' ')}\n${result.stdout || ''}\n${result.stderr || ''}`);
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
must(desktopLauncher, "Invoke-WebRequest $HealthUrl");
must(desktopLauncher, "$status -eq 200");
must(desktopLauncher, "LOOPBACK_READINESS_ONLY");
must(desktopLauncher, "Persisted data gate:");
must(desktopLauncher, "HTTP 401/403/404 no longer counts as BACKEND READY.");
must(desktopLauncher, "BACKEND READY - exact health + local data gate passed");
mustNot(desktopLauncher, "$status -ge 200 -and $status -lt 500");
const truthGateCalls = [...desktopLauncher.matchAll(/Invoke-PersistedDataTruthGate/g)].map(match => match.index);
const truthGate = truthGateCalls.at(-1) ?? -1;
const startBackend = desktopLauncher.indexOf("Write-Host 'Starting backend and waiting for the exact loopback health acceptance...'");
const openBrowser = desktopLauncher.indexOf('Start-Process $LocalUrl');
if (truthGateCalls.length < 2 || truthGate < 0 || startBackend <= truthGate || openBrowser <= startBackend) {
  throw new Error('V232 desktop launcher ordering invalid: local DB truth -> exact health -> browser must remain fail-closed.');
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
const loginRequest = runtimeE2E.indexOf("/api/v213/local-auth/login");
if (authReady < 0 || appReady <= authReady || loginRequest <= appReady) {
  throw new Error('V232 runtime E2E ordering invalid: auth sidecar ready -> live seven-board health ready -> login/handoff.');
}

must(liveDataHealth, "['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']");
must(liveDataHealth, "req.path!=='/api/health'");
must(liveDataHealth, 'V232-LIVE-PERSISTED-BOARDS');
must(liveDataHealth, "dataState:'EMPTY_INSTALL'");
must(liveDataHealth, "dataState:ready?'PERSISTED_BOARDS_READY':'PERSISTED_BOARDS_INCOMPLETE'");
must(liveDataHealth, 'zeroBusinessTypes');
must(liveDataHealth, 'return res.status(503)');
must(liveDataHealth, "scope:'LOOPBACK_READINESS_ONLY'");
mustNot(liveDataHealth, 'status(401)');

run(['--check', 'src/v226LatestReportDateQueryPatch.js']);
run(['scripts/v226-latest-report-date-query-smoke.mjs']);
run(['--check', 'src/v227LocalHealthProbePatch.js']);
run(['--check', 'src/v228LocalLauncherRootProbePatch.js']);
run(['--check', 'src/v232LiveDataHealthGatePatch.js']);
run(['--check', 'src/v225AuthBootstrapGuardPatch.js']);
run(['--check', 'public/v225-auth-bootstrap-guard.js']);
run(['--check', 'src/v209LoginReliabilityPatch.js']);
run(['--check', 'src/v213AuthSidecar.js']);
run(['--test', 'test/v211-fast-auth.test.js']);
run(['scripts/v225-local-db-truth-smoke.mjs']);
run(['scripts/v225-runtime-e2e.mjs']);

console.log('[V232] candidate runtime gate passed: local DB truth -> live seven-board health -> auth handoff -> session -> latest date -> 7 business non-zero + WHPP -> guarded shell; browser cannot open on a persisted all-zero/missing-board state.');
