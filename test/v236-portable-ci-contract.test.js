import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(file, 'utf8');

test('V236 GitHub runtime acceptance is portable and does not call production/local Windows gates', () => {
  const workflow = read('.github/workflows/v225-runtime-acceptance.yml');
  assert.match(workflow, /node scripts\/v236-portable-ci-gate\.cjs/);
  assert.doesNotMatch(workflow, /v224-persisted-bootstrap-recovery-smoke\.cjs/);
  assert.doesNotMatch(workflow, /v234-restart-persistence-e2e\.mjs/);
  assert.doesNotMatch(workflow, /CE_QC_Full_Acceptance_Verify_ReadOnly\.mjs/);
});

test('V236 isolated runtime uses a temp SQLite fixture with all seven businesses', () => {
  const runtime = read('scripts/v225-runtime-e2e.mjs');
  assert.match(runtime, /fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\),'ce-qc-v225-'\)\)/);
  assert.match(runtime, /DB_FILE:dbFile/);
  for (const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']) assert.match(runtime, new RegExp(`'${type}'`));
  assert.doesNotMatch(runtime, /D:\\\\CE CCSL金边数据库/);
  assert.doesNotMatch(runtime, /taskkill/);
});

test('V236 keeps the real Windows same-DB restart and managed fail-closed install gate intact', () => {
  const recovery = read('scripts/v224-persisted-bootstrap-recovery-smoke.cjs');
  const restart = read('scripts/v234-restart-persistence-e2e.mjs');
  const launcher = read('tools/CE_QC_Managed_Launcher.ps1');
  assert.match(recovery, /scripts\/v234-restart-persistence-e2e\.mjs/);
  assert.match(restart, /spawnSync\('taskkill'/);
  assert.match(launcher, /Invoke-Exe \$script:NpmExe @\('run','test:golive'\)/);
  assert.match(launcher, /@\('pull','--ff-only'/);
  assert.match(launcher, /Candidate validation did not return one clean TRUE result; installation blocked\./);
});

test('V236 portable gate still executes the full V235 functional matrix and V225 HTTP runtime', () => {
  const gate = read('scripts/v236-portable-ci-gate.cjs');
  assert.match(gate, /scripts\/v235-final-functional-acceptance\.cjs/);
  assert.match(gate, /scripts\/v225-runtime-e2e\.mjs/);
  assert.match(gate, /CE_QC_V236_PORTABLE_CI=PASS/);
  assert.match(gate, /CE_QC_V236_LOCAL_WINDOWS_GATE_PRESERVED=PASS/);
});
