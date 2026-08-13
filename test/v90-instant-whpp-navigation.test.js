import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const uiUrl = new URL('../public/v90-instant-whpp-navigation.js', import.meta.url);
const serverUrl = new URL('../src/v90FastDashboardReadPatch.js', import.meta.url);
const ui = fs.readFileSync(uiUrl, 'utf8').replace(/\r\n/g, '\n');
const server = fs.readFileSync(serverUrl, 'utf8').replace(/\r\n/g, '\n');
const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const bootstrap = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const launcher = fs.readFileSync(new URL('../Fast_Start_CE_QC.ps1', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cmd = fs.readFileSync(new URL('../Start_CE_QC.cmd', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

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

  const beginAt = ui.indexOf('function beginWhppNavigation');
  const renderAt = ui.indexOf('renderInstant();', beginAt);
  const delayedRefreshAt = ui.indexOf("if(location.pathname==='/whpp'&&typeof global.navigateWhppPage==='function')", renderAt);
  assert.ok(beginAt >= 0, 'beginWhppNavigation must exist');
  assert.ok(renderAt > beginAt, 'WHPP must render immediately after route switch');
  assert.ok(delayedRefreshAt > renderAt, 'full WHPP refresh must run only after the immediate render');

  assert.match(ui, /WHPP\u9875\u9762\u5df2\u5207\u6362\u5b8c\u6210/);
  assert.doesNotMatch(ui, /new MutationObserver/);
});

test('instant WHPP board does not reintroduce impossible CN ZT or 580 cards', () => {
  const start = ui.indexOf('const core=[');
  const end = ui.indexOf('target.className', start);
  assert.ok(start >= 0 && end > start, 'WHPP core metric block must be present');
  const renderBlock = ui.slice(start, end);

  assert.doesNotMatch(
    renderBlock,
    /CCSLCN\u5206\u6d41|CCSLZT\u5206\u6d41|580\u6ede\u7559\u5305\u88f9|CECN\u6ede\u7559\u5305\u88f9|CEZT\u6ede\u7559\u5305\u88f9/
  );
  for (const field of ['metrics.returned','metrics.cancelled','metrics.unresolved','metrics.pending1','metrics.oc1']) {
    assert.match(renderBlock, new RegExp(field.replace('.', '\\.')));
  }
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
  assert.match(injector, /v89-fast-dashboard\.js\?v=20260813-2/);
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
