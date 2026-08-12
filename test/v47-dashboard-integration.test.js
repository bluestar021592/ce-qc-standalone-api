import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('CEAF is accepted and mounted by the shared trend endpoint', () => {
  const source = fs.readFileSync(path.resolve('src/v27TrendPatch.js'), 'utf8');
  const mount = fs.readFileSync(path.resolve('public/v27-trend-mount-fix.js'), 'utf8');
  assert.match(source, /new Set\(\['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','CCSL','SHOPEE'\]\)/);
  assert.match(mount, /ceaf:'CEAF'/);
});

test('V67 is the single authoritative seven-business start/resume orchestrator', () => {
  const source = fs.readFileSync(path.resolve('public/v67-resilient-run-guard.js'), 'utf8');
  assert.match(source, /global\.runUnified/);
  assert.match(source, /global\.resumeUnified/);
  assert.match(source, /\/api\/run/);
  assert.match(source, /\/api\/resume/);
  assert.match(source, /\/api\/shopee\/run\/start/);
  assert.match(source, /\/api\/shopee\/run\/resume/);
  assert.match(source, /\/api\/whpp\/run\/start/);
  assert.match(source, /\/api\/whpp\/run\/resume/);
  assert.match(source, /\/api\/v71\/whpp-summary/);
});

test('V47 is only a compatibility marker and cannot duplicate WHPP processing', () => {
  const source = fs.readFileSync(path.resolve('public/whpp-v47-auto-run.js'), 'utf8');
  assert.match(source, /authoritativeRunner: 'V67'/);
  assert.doesNotMatch(source, /global\.runUnified\s*=/);
  assert.doesNotMatch(source, /global\.resumeUnified\s*=/);
  assert.doesNotMatch(source, /\/api\/whpp\/run\/start/);
});

test('WHPP V47 compatibility is injected with current cache key', () => {
  const source = fs.readFileSync(path.resolve('src/v44WhppUiPatch.js'), 'utf8');
  assert.match(source, /whpp-v47-auto-run\.js\?v=20260812-4/);
});

test('V49 dashboard correctness patch owns exact routing/shop detail and WHPP reconciliation', () => {
  const server = fs.readFileSync(path.resolve('src/v49DashboardCorrectnessPatch.js'), 'utf8');
  const ui = fs.readFileSync(path.resolve('public/v49-dashboard-correctness.js'), 'utf8');
  const bootstrap = fs.readFileSync(path.resolve('bootstrap.js'), 'utf8');
  const injector = fs.readFileSync(path.resolve('src/v44WhppUiPatch.js'), 'utf8');
  assert.match(server, /ccslCnDiversion/);
  assert.match(server, /ccslZtDiversion/);
  assert.match(server, /ccsl580Retention/);
  assert.match(server, /phnomPenhShop/);
  assert.match(server, /shipment_current_state/);
  assert.match(server, /persistedCurrentState/);
  assert.match(server, /orderStatus/);
  assert.match(server, /api\/v49\/whpp-trends/);
  assert.match(ui, /退件率/);
  assert.match(ui, /openV18MetricDetail/);
  assert.match(ui, /api\/v27\/metric-detail/);
  assert.match(bootstrap, /v49DashboardCorrectnessPatch/);
  assert.match(injector, /v49-dashboard-correctness\.js/);
});

test('V49 special detail refuses terminal POD/return/cancel rows from shop and routing destination tabs', () => {
  const source = fs.readFileSync(path.resolve('src/v49DashboardCorrectnessPatch.js'), 'utf8');
  assert.match(source, /if\(isTerminal\(row\)\)return false/);
  assert.match(source, /const destination=dest=>rows\.filter\(r=>!isTerminal\(r\)&&finalDestination\(r\)===dest\)/);
  assert.match(source, /SHOP_TRANSFER_IN_PROGRESS/);
  assert.match(source, /SHOP_ARRIVED_CURRENT/);
});

test('range V36 terminal evidence outranks stale shop and CCSL routing nodes', () => {
  const source = fs.readFileSync(path.resolve('src/rangeDashboardStoreV36.js'), 'utf8');
  assert.match(source, /const live = rows\.filter\(row => !isTerminalRow\(row\)\)/);
  assert.match(source, /rows\.filter\(row => !isTerminalRow\(row\) && row\.routingDestination === ROUTING_DESTINATIONS\.CCSLZT\)/);
  assert.match(source, /function isTerminalRow/);
  assert.match(source, /status === '85'/);
});

test('Shopee attempt trends use persisted currentAttemptNo before timestamp fallback', () => {
  const trend = fs.readFileSync(path.resolve('src/v27TrendPatch.js'), 'utf8');
  const range = fs.readFileSync(path.resolve('src/rangeDashboardStoreV33.js'), 'utf8');
  for (const source of [trend, range]) {
    assert.match(source, /f\.currentAttemptNo/);
    assert.match(source, /\$\.currentAttemptNo/);
    assert.match(source, /podAttemptNo/);
    assert.match(source, /POD时间/);
  }
});

test('V49 and seven-business integration files pass syntax checks', () => {
  for (const relative of ['src/v27TrendPatch.js', 'src/v44WhppUiPatch.js', 'public/whpp-v47-auto-run.js', 'public/v67-resilient-run-guard.js', 'src/v49DashboardCorrectnessPatch.js', 'public/v49-dashboard-correctness.js', 'src/rangeDashboardStoreV36.js', 'src/rangeDashboardStoreV33.js', 'public/v27-trend-mount-fix.js']) {
    const result = spawnSync(process.execPath, ['--check', path.resolve(relative)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative} syntax failed:\n${result.stderr || result.stdout}`);
  }
});
