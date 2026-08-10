import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

test('V43 bootstrap patch is syntax-valid and does not call heavy range dashboard reader', () => {
  const file = path.join(root, 'src', 'v43BootstrapPerfPatch.js');
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /loadLightweightUnifiedBusinessState/);
  assert.match(source, /LIGHTWEIGHT_NORMALIZED_SQLITE/);
  assert.match(source, /BOOTSTRAP_LIGHT_CACHE_MS/);
  assert.doesNotMatch(source, /loadRangeDashboard/);
  assert.doesNotMatch(source, /rangeDashboardStore/);
});

test('V43 performance patch is installed before the main server registers bootstrap route', () => {
  const source = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
  const perf = source.indexOf("v43BootstrapPerfPatch");
  const server = source.indexOf("importPhase('server'");
  assert.ok(perf >= 0, 'V43 bootstrap performance patch must be loaded');
  assert.ok(server > perf, 'V43 must load before server.js registers /api/bootstrap');
});

test('startup cache worker does not scan 180 days during first paint', () => {
  const file = path.join(root, 'src', 'dashboardCacheWorker.js');
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /reason === 'STARTUP_WARM'/);
  assert.match(source, /STARTUP_WARM_DISABLED_FOR_FAST_FIRST_PAINT/);
  assert.match(source, /DASHBOARD_CACHE_WARM_DAYS/);
  assert.doesNotMatch(source, /warmDashboardCacheRange\(\{ days: 180 \}\)/);
});
