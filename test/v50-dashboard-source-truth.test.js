import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('V50 forces special cards to exact dedicated detail endpoint', () => {
  const ui=fs.readFileSync(path.resolve('public/v50-dashboard-source-truth.js'),'utf8');
  assert.match(ui,/\/api\/v50\/special-detail/);
  assert.match(ui,/金边门店/);
  assert.match(ui,/ccslZtDiversion/);
  assert.match(ui,/stopImmediatePropagation/);
});

test('V50 WHPP reader hydrates normalized scan/final/current tables and honors terminal order status', () => {
  const server=fs.readFileSync(path.resolve('src/v50DashboardSourceTruthPatch.js'),'utf8');
  assert.match(server,/business_scan_results/);
  assert.match(server,/business_final_rows/);
  assert.match(server,/shipment_current_state/);
  assert.match(server,/status==='85'/);
  assert.match(server,/status==='100'/);
  assert.match(server,/status==='10'/);
  assert.match(server,/\/api\/whpp\/state/);
});

test('V50 terminal rows cannot remain in live Phnom Penh shop', () => {
  const server=fs.readFileSync(path.resolve('src/v50DashboardSourceTruthPatch.js'),'utf8');
  assert.match(server,/if\(isTerminal\(row\)\)return false/);
  assert.match(server,/shopState:''/);
});

test('V50 is loaded and injected', () => {
  const bootstrap=fs.readFileSync(path.resolve('bootstrap.js'),'utf8');
  const injector=fs.readFileSync(path.resolve('src/v44WhppUiPatch.js'),'utf8');
  assert.match(bootstrap,/v50DashboardSourceTruthPatch/);
  assert.match(injector,/v50-dashboard-source-truth\.js/);
});

test('V50 files pass syntax checks', () => {
  for(const relative of ['src/v50DashboardSourceTruthPatch.js','public/v50-dashboard-source-truth.js']){
    const result=spawnSync(process.execPath,['--check',path.resolve(relative)],{encoding:'utf8'});
    assert.equal(result.status,0,`${relative} syntax failed:\n${result.stderr||result.stdout}`);
  }
});
