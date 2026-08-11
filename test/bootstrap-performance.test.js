import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

test('V43 bootstrap patch is syntax-valid and uses cache-summary only startup', () => {
  const file = path.join(root, 'src', 'v43BootstrapPerfPatch.js');
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', file], { encoding:'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /dashboard_daily_cache/);
  assert.match(source, /CACHE_SUMMARY_ONLY/);
  assert.match(source, /BOOTSTRAP_LIGHT_CACHE_MS/);
  assert.doesNotMatch(source, /loadLightweightUnifiedBusinessState/);
  assert.doesNotMatch(source, /loadRangeDashboard/);
  assert.doesNotMatch(source, /unified_snapshots\.payloadJson/);
});

test('V43 and V46 cold-start performance patches load before the main server', () => {
  const source = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
  const v43 = source.indexOf("v43BootstrapPerfPatch");
  const v46 = source.indexOf("v46ColdStartIndexPatch");
  const server = source.indexOf("importPhase('server'");
  assert.ok(v43 >= 0, 'V43 bootstrap performance patch must be loaded');
  assert.ok(v46 > v43, 'V46 cold-start index patch must load after V43');
  assert.ok(server > v46, 'V46 must finish before server.js accepts browser requests');
});

test('V46 installs covering indexes for the exact cold bootstrap grouping path', () => {
  const file = path.join(root, 'src', 'v46ColdStartIndexPatch.js');
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', file], { encoding:'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /idx_unified_rows_bootstrap_cover/);
  assert.match(source, /snapshotId, businessType, regionCode/);
  assert.match(source, /idx_unified_batches_latest_valid/);
  assert.doesNotMatch(source, /VACUUM/i);
});

test('startup cache worker does not scan 180 days during first paint', () => {
  const file = path.join(root, 'src', 'dashboardCacheWorker.js');
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', file], { encoding:'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /reason === 'STARTUP_WARM'/);
  assert.match(source, /STARTUP_WARM_DISABLED_FOR_FAST_FIRST_PAINT/);
  assert.match(source, /DASHBOARD_CACHE_WARM_DAYS/);
  assert.doesNotMatch(source, /warmDashboardCacheRange\(\{ days: 180 \}\)/);
});

test('one-click launcher opens a running app immediately and cold-starts silently without WSH', () => {
  const installer = fs.readFileSync(path.join(root, 'tools', 'Install_CE_QC_Desktop_Shortcut.ps1'), 'utf8');
  assert.match(installer, /CE_QC_LAUNCHER/);
  assert.match(installer, /Launch_CE_QC\.ps1/);
  assert.match(installer, /powershell\.exe/i);
  assert.match(installer, /WindowStyle Hidden/);
  assert.match(installer, /Test-CeQcReady/);
  assert.match(installer, /127\.0\.0\.1:5177/);
  // The installer may mention legacy VBS launcher names only to delete stale
  // shortcuts. It must not execute Windows Script Host in the active path.
  assert.doesNotMatch(installer, /TargetPath\s*=\s*.*wscript\.exe/i);
  assert.doesNotMatch(installer, /Start-Process\s+.*wscript\.exe/i);
  assert.doesNotMatch(installer, /git\s+(fetch|pull)/i);
});

test('WHPP direct SPA entry injects native frontend without legacy V42 UI', () => {
  const file = path.join(root, 'src', 'v44WhppUiPatch.js');
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', file], { encoding:'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /'\/whpp'/);
  assert.match(source, /whpp-v44\.js/);
  assert.match(source, /whpp-v45-cleanup\.js/);
  assert.match(source, /dashboard-title-dedup\.css/);
  assert.doesNotMatch(source, /whpp-v42\.js/);
});

test('V48 exact final-node routing API loads before server and UI is injected', () => {
  const bootstrap = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src', 'v44WhppUiPatch.js'), 'utf8');
  const server = bootstrap.indexOf("importPhase('server'");
  const routing = bootstrap.indexOf('v48RoutingPatch');
  assert.ok(routing >= 0 && routing < server, 'V48 routing API must load before server listen');
  assert.match(ui, /routing-v48\.js/);
  for (const relative of ['src/routingDestinationV48.js','src/rangeDashboardStoreV36.js','src/v48RoutingPatch.js','public/routing-v48.js']) {
    const file = path.join(root, relative);
    const check = spawnSync(process.execPath, ['--check', file], { encoding:'utf8' });
    assert.equal(check.status, 0, `${relative} syntax failed:\n${check.stderr || check.stdout}`);
  }
});

test('business dashboards show only the global page title and keep the inner date/status line', () => {
  const file = path.join(root, 'public', 'dashboard-title-dedup.css');
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /\.v18-business-page \.v18-page-heading h2\{display:none!important\}/);
  assert.match(source, /\.v18-business-page \.v18-page-heading p/);
  assert.match(source, /height:30px!important/);
});

test('WHPP board uses native Shopee dashboard classes and does not render dispatch-attempt POD cards', () => {
  const file = path.join(root, 'public', 'whpp-v44.js');
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', file], { encoding:'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  for (const token of ['v18-business-grid','v18-core-grid','region-summary-grid','v18-chart-grid','订单取消','金边门店']) assert.match(source, new RegExp(token));
  assert.doesNotMatch(source, /1派POD|2派POD|3派POD|派送概率分布/);
});

test('WHPP display hides unused work-order and CN/ZT diversion cards but keeps backend classification intact', () => {
  const file = path.join(root, 'public', 'whpp-v45-cleanup.js');
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', file], { encoding:'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  for (const label of ['工单', 'CCSLCN分流', 'CCSLZT分流']) assert.match(source, new RegExp(label));
  assert.match(source, /HIDDEN_CORE_LABELS/);
  assert.match(source, /card\.remove\(\)/);
});

test('WHPP visibility observer is idempotent and cannot self-trigger a browser freeze', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'whpp-v44.js'), 'utf8');
  assert.match(source, /if\(node\.hidden!==shouldHide\)node\.hidden=shouldHide/);
  assert.match(source, /if\(node\.classList\.contains\('active'\)!==shouldActive\)node\.classList\.toggle\('active',shouldActive\)/);
  assert.match(source, /if\(title&&title\.textContent!=='WHPP本土看板'\)title\.textContent='WHPP本土看板'/);
});
