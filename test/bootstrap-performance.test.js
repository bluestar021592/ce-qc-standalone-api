import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

test('V43 bootstrap patch is syntax-valid and uses cache-summary only startup', () => {
  const file = path.join(root, 'src', 'v43BootstrapPerfPatch.js');
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /dashboard_daily_cache/);
  assert.match(source, /CACHE_SUMMARY_ONLY/);
  assert.match(source, /BOOTSTRAP_LIGHT_CACHE_MS/);
  assert.doesNotMatch(source, /loadLightweightUnifiedBusinessState/);
  assert.doesNotMatch(source, /loadRangeDashboard/);
  assert.doesNotMatch(source, /unified_snapshots\.payloadJson/);
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

test('WHPP direct SPA entry injects only the native V44 frontend', () => {
  const file = path.join(root, 'src', 'v44WhppUiPatch.js');
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /'\/whpp'/);
  assert.match(source, /whpp-v44\.js/);
  assert.doesNotMatch(source, /whpp-v42\.js/);
});

test('WHPP board uses native Shopee dashboard classes and does not render dispatch-attempt POD cards', () => {
  const file = path.join(root, 'public', 'whpp-v44.js');
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  for (const token of ['v18-business-grid','v18-core-grid','region-summary-grid','v18-chart-grid','订单取消','CCSLCN分流','CCSLZT分流','CCSL580分流','金边门店']) assert.match(source, new RegExp(token));
  assert.doesNotMatch(source, /1派POD|2派POD|3派POD|派送概率分布/);
});

test('WHPP visibility observer is idempotent and cannot self-trigger a browser freeze', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'whpp-v44.js'), 'utf8');
  assert.match(source, /if\(node\.hidden!==shouldHide\)node\.hidden=shouldHide/);
  assert.match(source, /if\(node\.classList\.contains\('active'\)!==shouldActive\)node\.classList\.toggle\('active',shouldActive\)/);
  assert.match(source, /if\(title&&title\.textContent!=='WHPP本土看板'\)title\.textContent='WHPP本土看板'/);
});
