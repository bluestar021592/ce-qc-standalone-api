import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const integration = fs.readFileSync(new URL('../public/v54-whpp-unified-integration.js', import.meta.url), 'utf8');
const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');
const runner = fs.readFileSync(new URL('../public/v67-resilient-run-guard.js', import.meta.url), 'utf8');

test('V54 is a lightweight compatibility layer and never replaces the V67 seven-business runner', () => {
  assert.match(integration, /V67 is the authoritative seven-business start\/resume orchestrator/);
  assert.doesNotMatch(integration, /global\.runUnified\s*=/);
  assert.doesNotMatch(integration, /global\.resumeUnified\s*=/);
  assert.doesNotMatch(integration, /\/api\/v51\/whpp-state/);
  assert.doesNotMatch(integration, /new MutationObserver/);
  assert.match(runner, /global\.runUnified/);
  assert.match(runner, /\/api\/whpp\/run\/start/);
  assert.match(runner, /\/api\/whpp\/run\/resume/);
});

test('V54 keeps WHPP pause integrated without polling or dashboard decoration', () => {
  assert.match(integration, /global\.pauseUnified/);
  assert.match(integration, /\/api\/whpp\/run\/pause/);
  assert.match(integration, /Promise\.allSettled/);
  assert.doesNotMatch(integration, /decorateUnifiedViews/);
  assert.doesNotMatch(integration, /\/api\/import\/unified-latest/);
});

test('V54 compatibility runtime is injected after the retired V47 compatibility marker with fresh keys', () => {
  const v47 = injector.indexOf('/whpp-v47-auto-run.js?v=20260812-4');
  const v54 = injector.indexOf('/v54-whpp-unified-integration.js?v=20260812-9');
  assert.ok(v47 >= 0 && v54 >= 0, 'V47 and V54 runtimes must be present');
  assert.ok(v54 > v47, 'V54 pause bridge may load after V47 because neither replaces V67 run/resume');
});

test('V54 compatibility runtime is syntax-valid', () => {
  const file = new URL('../public/v54-whpp-unified-integration.js', import.meta.url);
  const check = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
});
