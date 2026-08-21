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

test('WHPP completed snapshot is owned by V165 direct runner and already-completed backend response is verified, not restarted from unresolved count', () => {
  assert.match(autoRun, /authoritativeRunner:\s*'V67'/);
  assert.doesNotMatch(autoRun, /global\.runUnified\s*=/);
  assert.doesNotMatch(autoRun, /\/api\/whpp\/run\/start/);
  assert.match(authoritativeRunner, /2026-08-17-v165-seven-business-stage-verification-v2/);
  assert.match(authoritativeRunner, /RUN_ALREADY_COMPLETED/);
  assert.match(authoritativeRunner, /if \(alreadyDone\(error\)\)/);
  assert.match(authoritativeRunner, /if \(stage\.key === 'WHPP'\) return await verifyWhpp\(target\)/);
  assert.match(authoritativeRunner, /snapshotStatus === 'COMPLETED'/);
  assert.match(authoritativeRunner, /snapshotStatus === 'COMPLETED_WITH_RETRY'/);
  assert.doesNotMatch(authoritativeRunner, /completed\(state\).*unresolved/);
});
