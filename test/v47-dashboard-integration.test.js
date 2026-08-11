import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('CEAF is accepted by the shared trend endpoint', () => {
  const source = fs.readFileSync(path.resolve('src/v27TrendPatch.js'), 'utf8');
  assert.match(source, /new Set\(\['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','CCSL','SHOPEE'\]\)/);
});

test('global automatic processing continues into WHPP after CCSL and Shopee', () => {
  const source = fs.readFileSync(path.resolve('public/whpp-v47-auto-run.js'), 'utf8');
  assert.match(source, /global\.runUnified/);
  assert.match(source, /\/api\/whpp\/state/);
  assert.match(source, /\/api\/whpp\/run\/start/);
  assert.match(source, /snapshotStatus/);
});

test('WHPP V47 integration is injected into every application page', () => {
  const source = fs.readFileSync(path.resolve('src/v44WhppUiPatch.js'), 'utf8');
  assert.match(source, /whpp-v47-auto-run\.js/);
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
  assert.match(server, /orderStatus/);
  assert.match(server, /api\/v49\/whpp-trends/);
  assert.match(ui, /退件率/);
  assert.match(ui, /openV18MetricDetail/);
  assert.match(ui, /api\/v27\/metric-detail/);
  assert.match(bootstrap, /v49DashboardCorrectnessPatch/);
  assert.match(injector, /v49-dashboard-correctness\.js/);
});

test('V49 special detail refuses terminal POD/return/cancel rows from current Phnom Penh shop', () => {
  const source = fs.readFileSync(path.resolve('src/v49DashboardCorrectnessPatch.js'), 'utf8');
  assert.match(source, /if\(isTerminal\(row\)\|\|destination!==ROUTING_DESTINATIONS\.NONE\)return false/);
  assert.match(source, /SHOP_TRANSFER_IN_PROGRESS/);
  assert.match(source, /SHOP_ARRIVED_CURRENT/);
});

test('V49 dashboard integration files pass syntax checks', () => {
  for (const relative of ['src/v27TrendPatch.js', 'src/v44WhppUiPatch.js', 'public/whpp-v47-auto-run.js', 'src/v49DashboardCorrectnessPatch.js', 'public/v49-dashboard-correctness.js']) {
    const result = spawnSync(process.execPath, ['--check', path.resolve(relative)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative} syntax failed:\n${result.stderr || result.stdout}`);
  }
});
