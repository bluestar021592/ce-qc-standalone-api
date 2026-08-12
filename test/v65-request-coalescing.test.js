import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('V65 request coalescing runtime is syntax-valid and GET-only', () => {
  const file = new URL('../public/v65-request-coalescing.js', import.meta.url);
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', file.pathname], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /const inflight = new Map\(\)/);
  assert.match(source, /response\.clone\(\)/);
  assert.match(source, /method !== 'GET'/);
  assert.match(source, /clearRecent\(\)/);
});

test('V65 coalesces only heavy read-only dashboard routes', () => {
  const source = read('public/v65-request-coalescing.js');
  assert.match(source, /\/api\/import\/unified-latest/);
  assert.match(source, /\\\/whpp-state\$/);
  assert.match(source, /\\\/reconciliation\$/);
  assert.match(source, /\\\/trends\$/);
  assert.match(source, /\\\/routing\$/);
  assert.doesNotMatch(source, /metric-detail\$/);
});

test('V65 loads in head before legacy runtimes capture fetch', () => {
  const injector = read('src/v44WhppUiPatch.js');
  assert.match(injector, /v65-request-coalescing\.js\?v=20260812-1/);
  assert.ok(injector.indexOf('v65-request-coalescing.js') < injector.indexOf('v51-runtime-fix.js'));
  assert.ok(injector.indexOf('v65-request-coalescing.js') < injector.indexOf('v56-trend-truth.js'));
  assert.ok(injector.indexOf('v65-request-coalescing.js') < injector.indexOf('v64-whpp-total-kpi-integration.js'));
});
