const fs = require('fs');
const { spawnSync } = require('node:child_process');

const recovery = fs.readFileSync('src/v221BootstrapRecoveryPatch.js', 'utf8');
const v46 = fs.readFileSync('src/v46ColdStartIndexPatch.js', 'utf8');
const auth = fs.readFileSync('src/v209LoginReliabilityPatch.js', 'utf8');
const sidecar = fs.readFileSync('src/v213AuthSidecar.js', 'utf8');
const inject = fs.readFileSync('src/v225AuthBootstrapGuardPatch.js', 'utf8');
const browser = fs.readFileSync('public/v225-auth-bootstrap-guard.js', 'utf8');

const must = (source, token) => {
  if (!source.includes(token)) throw new Error(`V225 recovery gate missing: ${token}`);
};
const run = args => {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error(`V225 command failed: node ${args.join(' ')}\n${result.stdout || ''}\n${result.stderr || ''}`);
  if (result.stdout) process.stdout.write(result.stdout);
};

must(v46, "import './v221BootstrapRecoveryPatch.js';");
must(v46, "import './v225AuthBootstrapGuardPatch.js';");
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

run(['--check', 'src/v225AuthBootstrapGuardPatch.js']);
run(['--check', 'public/v225-auth-bootstrap-guard.js']);
run(['--check', 'src/v209LoginReliabilityPatch.js']);
run(['--check', 'src/v213AuthSidecar.js']);
run(['--test', 'test/v211-fast-auth.test.js']);
run(['scripts/v225-local-db-truth-smoke.mjs']);

console.log('[V225] go-live recovery/auth gate passed: persisted bootstrap + 5179->5177 deterministic handoff + zero-state redirect + read-only local DB truth.');
