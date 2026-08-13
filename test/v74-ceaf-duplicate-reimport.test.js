import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('V74 duplicate repair is syntax-valid and only supersedes stale same-file CEAF classification', () => {
  const file = new URL('../src/v74CeafDuplicateReimportPatch.js', import.meta.url);
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);

  assert.match(source, /\/api\/import\/unified-daily-report/);
  assert.match(source, /fileHash/);
  assert.match(source, /businessType='CEAF'/);
  assert.match(source, /businessType='WHPP'/);
  assert.match(source, /existingCeaf >= airRows/);
  assert.match(source, /SET status='SUPERSEDED'/);
  assert.match(source, /status='VALID'/);
  assert.match(source, /CCAF/);
  assert.match(source, /CEAF/);
  assert.doesNotMatch(source, /DELETE FROM unified_import/);
});

test('V74 repair loads after V73 classification guard and before server registration', () => {
  const bootstrap = read('bootstrap.js');
  const v73 = bootstrap.indexOf('v73CeafSourceMarkerPatch');
  const v74 = bootstrap.indexOf('v74CeafDuplicateReimportPatch');
  const server = bootstrap.indexOf("importPhase('server', './server.js')");
  assert.ok(v73 >= 0);
  assert.ok(v74 > v73);
  assert.ok(server > v74);
});
