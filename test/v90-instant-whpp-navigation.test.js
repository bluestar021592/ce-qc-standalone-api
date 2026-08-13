import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const uiUrl = new URL('../public/v90-instant-whpp-navigation.js', import.meta.url);
const serverUrl = new URL('../src/v90FastDashboardReadPatch.js', import.meta.url);
const ui = fs.readFileSync(uiUrl, 'utf8');
const server = fs.readFileSync(serverUrl, 'utf8');
const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
const launcher = fs.readFileSync(new URL('../Fast_Start_CE_QC.ps1', import.meta.url), 'utf8');
const cmd = fs.readFileSync(new URL('../Start_CE_QC.cmd', import.meta.url), 'utf8');

for (const [name, url] of [['V90 UI', uiUrl], ['V90 server', serverUrl]]) {
  test(`${name} is syntax-valid`, () => {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(url)], { encoding:'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}

test('WHPP click switches visible content before any full async WHPP refresh', () => {
  assert.match(ui, /addEventListener\('click'/);
  assert.match(ui, /\.side-link\[data-page="whpp"\]/);
  assert.match(ui, /stopImmediatePropagation/);
  assert.match(ui, /currentPage='whpp'/);
  assert.match(ui, /renderInstant\(\)/);
  assert.match(ui, /navigateWhppPage/);
  assert.ok(ui.indexOf('renderInstant();') < ui.indexOf("setTimeout(()=>{\n        if(location.pathname==='/whpp'&&typeof global.navigateWhppPage"));
  assert.match(ui, /不再保留上一页SHOPEE内容/);
  assert.doesNotMatch(ui, /new MutationObserver/);
});

test('instant WHPP board does not reintroduce impossible CN ZT or 580 cards', () => {
  const renderBlock = ui.slice(ui.indexOf('const core=['), ui.indexOf('target.className'));
  assert.doesNotMatch(renderBlock, /CCSLCN分流|CCSLZT分流|580滞留包裹|CECN滞留包裹|CEZT滞留包裹/);
  for (const label of ['已退回件','订单取消','当前未闭环','Pending1+','OC1+']) assert.match(renderBlock, new RegExp(label));
});

test('V90 replaces V89 startup summary with normalized SQL rather than large rawJson LIKE scans', () => {
  assert.match(server, /SUMMARY_ROUTE = '\/api\/v89\/instant-dashboard'/);
  assert.match(server, /business_final_rows f/);
  assert.match(server, /business_scan_results sr/);
  assert.match(server, /unified_import_rows u/);
  assert.match(server, /latestNode/);
  assert.match(server, /latestEventDesc/);
  assert.doesNotMatch(server, /rawJson\s+LIKE|rawJson\s+NOT\s+LIKE/i);
  assert.match(server, /whppSummary:fastWhppSummary/);
  assert.match(server, /business_history_summary/);
  assert.doesNotMatch(server, /DELETE FROM|UPDATE business_|INSERT INTO business_|DROP TABLE/i);
});

test('V90 loads after V89 and before server, and the UI runtime is injected after V89', () => {
  const v89 = bootstrap.indexOf('v89InstantDashboardPatch');
  const v90 = bootstrap.indexOf('v90FastDashboardReadPatch');
  const mainServer = bootstrap.indexOf("importPhase('server'");
  assert.ok(v89 >= 0 && v90 > v89 && mainServer > v90);
  assert.match(injector, /v89-fast-dashboard\.js\?v=20260813-1/);
  assert.match(injector, /v90-instant-whpp-navigation\.js\?v=20260813-1/);
  assert.ok(injector.indexOf('v90-instant-whpp-navigation.js') > injector.indexOf('v89-fast-dashboard.js'));
});

test('desktop launcher reuses an already-running backend before entering the cold-start supervisor', () => {
  assert.match(cmd, /Fast_Start_CE_QC\.ps1/i);
  assert.match(launcher, /Test-CeQcAlreadyRunning/);
  assert.match(launcher, /Backend is already running\. Reusing it without restart/);
  assert.match(launcher, /Start-Process \$LocalUrl/);
  assert.match(launcher, /Start_CE_QC\.ps1/);
  assert.doesNotMatch(launcher, /npm\s+ls|Clear-CeQcPort|taskkill/i);
  assert.ok(launcher.indexOf('if (Test-CeQcAlreadyRunning)') < launcher.indexOf("$launcher = Join-Path $ProjectRoot 'Start_CE_QC.ps1'"));
});
