const fs = require('fs');
const { spawnSync } = require('node:child_process');

const read = file => fs.readFileSync(file, 'utf8');
const must = (text, token, label) => {
  if (!text.includes(token)) throw new Error(`V236 ${label} missing: ${token}`);
};
const mustNot = (text, token, label) => {
  if (text.includes(token)) throw new Error(`V236 ${label} must not contain: ${token}`);
};
const run = (label, args, timeout) => {
  console.log(`\n[V236] ${label}`);
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: process.env,
    timeout,
    windowsHide: true
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`V236 ${label} failed with exit ${result.status}`);
};

for (const file of [
  'scripts/v235-final-functional-acceptance.cjs',
  'scripts/v225-runtime-e2e.mjs',
  'scripts/v224-persisted-bootstrap-recovery-smoke.cjs',
  'scripts/v234-restart-persistence-e2e.mjs',
  'tools/CE_QC_Managed_Launcher.ps1',
  '.github/workflows/v225-runtime-acceptance.yml',
  'test/v236-portable-ci-contract.test.js'
]) {
  if (!fs.existsSync(file)) throw new Error(`V236 required file missing: ${file}`);
}

const functional = read('scripts/v235-final-functional-acceptance.cjs');
const runtime = read('scripts/v225-runtime-e2e.mjs');
const localGate = read('scripts/v224-persisted-bootstrap-recovery-smoke.cjs');
const restart = read('scripts/v234-restart-persistence-e2e.mjs');
const managed = read('tools/CE_QC_Managed_Launcher.ps1');
const workflow = read('.github/workflows/v225-runtime-acceptance.yml');

// GitHub-hosted CI must never depend on the user's production D: drive or Windows-only
// process-tree restart. Those remain mandatory in the managed Windows candidate gate.
must(runtime, "fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v225-'))", 'isolated runtime fixture');
must(runtime, "DB_FILE:dbFile", 'isolated runtime fixture');
must(runtime, "['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']", 'seven-business runtime fixture');
mustNot(runtime, 'D:\\CE CCSL金边数据库', 'portable runtime fixture');
mustNot(runtime, 'taskkill', 'portable runtime fixture');

must(localGate, 'scripts/v234-restart-persistence-e2e.mjs', 'local Windows persistence gate');
must(restart, "spawnSync('taskkill'", 'local Windows persistence gate');
must(managed, "Invoke-Exe $script:NpmExe @('run','test:golive')", 'managed candidate gate');
must(managed, "@('pull','--ff-only'", 'managed candidate install');

must(workflow, 'node scripts/v236-portable-ci-gate.cjs', 'GitHub portable workflow');
mustNot(workflow, 'v224-persisted-bootstrap-recovery-smoke.cjs', 'GitHub portable workflow');
mustNot(workflow, 'v234-restart-persistence-e2e.mjs', 'GitHub portable workflow');
mustNot(workflow, 'CE_QC_Full_Acceptance_Verify_ReadOnly.mjs', 'GitHub portable workflow');

run('portable workflow contract', ['--test', 'test/v236-portable-ci-contract.test.js'], 60000);
run('V235 user-facing functional matrix', ['scripts/v235-final-functional-acceptance.cjs'], 480000);
run('V225 isolated HTTP runtime acceptance', ['scripts/v225-runtime-e2e.mjs'], 180000);

console.log('CE_QC_V236_PORTABLE_CI=PASS');
console.log('CE_QC_V236_LOCAL_WINDOWS_GATE_PRESERVED=PASS');
