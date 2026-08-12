import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('V71 WHPP summary patch is syntax-valid and exposes a compact aggregate route', () => {
  const file = new URL('../src/v71WhppSummaryPatch.js', import.meta.url);
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /\/api\/v71\/whpp-summary/);
  assert.match(source, /business_history_summary/);
  assert.match(source, /business_daily_reports/);
  assert.match(source, /business_final_rows/);
  assert.match(source, /regionPvUnresolved/);
  assert.match(source, /activeStoreRetention/);
  assert.match(source, /selfPickup/);
  assert.doesNotMatch(source, /loadWhppState/);
  assert.doesNotMatch(source, /buildWhppDashboard/);
});

test('V71 summary patch loads before server and V64 consumes only the lightweight endpoint', () => {
  const bootstrap = read('bootstrap.js');
  const ui = read('public/v64-whpp-total-kpi-integration.js');
  assert.match(bootstrap, /v71WhppSummaryPatch/);
  assert.ok(bootstrap.indexOf('v71WhppSummaryPatch') < bootstrap.indexOf("importPhase('server'"));
  assert.match(ui, /\/api\/v71\/whpp-summary\?reportDate=/);
  assert.doesNotMatch(ui, /\/api\/v51\/whpp-state/);
  assert.doesNotMatch(ui, /\/api\/whpp\/state/);
  assert.doesNotMatch(ui, /new MutationObserver/);
});
