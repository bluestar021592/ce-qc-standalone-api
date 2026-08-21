import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync(new URL('../public/v52-whpp-source-truth-route.js', import.meta.url), 'utf8');
const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');
const autoRun = fs.readFileSync(new URL('../public/whpp-v47-auto-run.js', import.meta.url), 'utf8');
const authoritativeRunner = fs.readFileSync(new URL('../public/v67-resilient-run-guard.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');

test('V52 routes canonical WHPP state reads to V51 source truth after V51 runtime', () => {
  assert.match(runtime, /url\.pathname === '\/api\/whpp\/state'/);
  assert.match(runtime, /url\.pathname === '\/api\/v50\/whpp-state'/);
  assert.match(runtime, /url\.pathname = '\/api\/v51\/whpp-state'/);
  const v51 = injector.indexOf('/v51-runtime-fix.js');
  const v52 = injector.indexOf('/v52-whpp-source-truth-route.js');
  assert.ok(v51 >= 0 && v52 > v51, 'V52 must load after the V51 fetch wrapper');
  assert.match(bootstrap, /v51WhppLegacyEvidencePatch/);
});

test('WHPP completed snapshot is owned by V67 and is not restarted merely because unresolved rows remain', () => {
  assert.match(autoRun, /authoritativeRunner:\s*'V67'/);
  assert.doesNotMatch(autoRun, /global\.runUnified\s*=/);
  assert.doesNotMatch(autoRun, /\/api\/whpp\/run\/start/);
  assert.match(authoritativeRunner, /if \(!hasReport\(state, stage\.key\) \|\| completed\(state\)\)/);
  assert.match(authoritativeRunner, /status === 'COMPLETED'/);
  assert.doesNotMatch(authoritativeRunner, /completed\(state\).*unresolved/);
});
