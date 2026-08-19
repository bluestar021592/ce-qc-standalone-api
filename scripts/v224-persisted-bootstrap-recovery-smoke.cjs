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

const must = (source, token) => {
  if (!source.includes(token)) throw new Error(`V228 recovery gate missing: ${token}`);
};
const run = args => {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env, timeout: 180000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`V228 command failed: node ${args.join(' ')}\n${result.stdout || ''}\n${result.stderr || ''}`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
};

must(v46, "import './v226LatestReportDateQueryPatch.js';");
must(v46, "import './v221BootstrapRecoveryPatch.js';");
must(v46, "import './v225AuthBootstrapGuardPatch.js';");
must(v46, "import './v227LocalHealthProbePatch.js';");
must(v46, "import './v228LocalLauncherRootProbePatch.js';");
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

run(['--check', 'src/v226LatestReportDateQueryPatch.js']);
run(['scripts/v226-latest-report-date-query-smoke.mjs']);
run(['--check', 'src/v227LocalHealthProbePatch.js']);
run(['--check', 'src/v228LocalLauncherRootProbePatch.js']);
run(['--check', 'src/v225AuthBootstrapGuardPatch.js']);
run(['--check', 'public/v225-auth-bootstrap-guard.js']);
run(['--check', 'src/v209LoginReliabilityPatch.js']);
run(['--check', 'src/v213AuthSidecar.js']);
run(['--test', 'test/v211-fast-auth.test.js']);
run(['scripts/v225-local-db-truth-smoke.mjs']);
run(['scripts/v225-runtime-e2e.mjs']);

console.log('[V228] candidate runtime gate passed: launcher/root 200 + health 200 + latest report date + persisted bootstrap + auth handoff + session + 7 business non-zero + WHPP + guarded shell.');
