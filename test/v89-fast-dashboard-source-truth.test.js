import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const files = {
  server: new URL('../src/v89InstantDashboardPatch.js', import.meta.url),
  staticCache: new URL('../src/v89StaticAssetCachePatch.js', import.meta.url),
  ui: new URL('../public/v89-fast-dashboard.js', import.meta.url),
  startup: new URL('../public/v81-startup-source-truth.js', import.meta.url),
  cleanup: new URL('../public/v85-business-rule-ui.js', import.meta.url),
  bootstrap: new URL('../bootstrap.js', import.meta.url),
  injector: new URL('../src/v44WhppUiPatch.js', import.meta.url)
};
const read = key => fs.readFileSync(files[key], 'utf8');

test('V89 dashboard/performance runtimes are syntax valid', () => {
  for (const key of ['server', 'staticCache', 'ui', 'startup', 'cleanup']) {
    const check = spawnSync(process.execPath, ['--check', fileURLToPath(files[key])], { encoding: 'utf8' });
    assert.equal(check.status, 0, `${key}: ${check.stderr || check.stdout}`);
  }
});

test('instant dashboard corrects exact CCAF/CEAF source markers without rewriting completed data', () => {
  const source = read('server');
  assert.match(source, /SUMMARY_ROUTE = '\/api\/v89\/instant-dashboard'/);
  assert.match(source, /DETAIL_ROUTE = '\/api\/v89\/shopee-whpp-detail'/);
  assert.match(source, /normalized === 'CCAF' \|\| normalized === 'CEAF'/);
  assert.match(source, /business_daily_parse_rows/);
  assert.match(source, /businessType='WHPP'/);
  assert.match(source, /rowHasExactAirMarker/);
  assert.match(source, /corrected\.CEAF = Number\(corrected\.CEAF \|\| 0\) \+ 1/);
  assert.match(source, /removedFromWhpp/);
  assert.match(source, /without rewriting immutable historical snapshots/);
  assert.doesNotMatch(source, /\bDELETE\s+FROM\b|\bUPDATE\s+[A-Za-z_]|\bINSERT\s+INTO\b|\bDROP\s+TABLE\b/i);
});

test('Shopee WHPP summary/detail is one responsibility bucket using normalized final rows plus source business membership', () => {
  const source = read('server');
  assert.match(source, /shopeeWhppCount/);
  assert.match(source, /business_final_rows f/);
  assert.match(source, /unified_import_rows u/);
  assert.match(source, /f\.businessType IN \('SHOPEE', \?\)/);
  assert.match(source, /u\.snapshotId=\?/);
  assert.match(source, /u\.businessType=\?/);
  assert.match(source, /latestNode/);
  assert.match(source, /latestEventDesc/);
  assert.match(source, /SHOPEE_WHPP_RETENTION/);
  assert.match(source, /COALESCE\(f\.isPod,0\)=0/);
  assert.match(source, /RETURN_COMPLETED/);
});

test('home and Shopee models receive corrected source truth before native V18 rendering', () => {
  const source = read('ui');
  assert.match(source, /'CEAF空运':'CEAF'/);
  assert.match(source, /'WHPP本土':'WHPP'/);
  assert.match(source, /patchHomeModel/);
  assert.match(source, /patchShopeeModel/);
  assert.match(source, /WHPP滞留包裹/);
  assert.match(source, /metricKey: 'whppRetention'/);
  assert.match(source, /WHPP责任/);
  assert.match(source, /\/api\/v89\/instant-dashboard/);
  assert.match(source, /\/api\/v89\/shopee-whpp-detail/);
  assert.match(source, /localStorage\.setItem\(CACHE_KEY/);
});

test('cold startup no longer duplicates app.js primary refresh and V85 no longer observes the whole document', () => {
  const startup = read('startup');
  const cleanup = read('cleanup');
  assert.match(startup, /PRIMARY_GRACE_MS/);
  assert.match(startup, /refreshPromise/);
  assert.match(startup, /Promise\.race/);
  assert.doesNotMatch(startup, /scheduleNormalRefresh/);
  assert.doesNotMatch(cleanup, /MutationObserver/);
  assert.doesNotMatch(cleanup, /\/api\/v85\/shopee-whpp-retention/);
  assert.match(cleanup, /V89 injects WHPP into the dashboard model itself/);
});

test('static JS/CSS may reuse browser bodies while HTML remains controlled by the legacy no-store layer', () => {
  const source = read('staticCache');
  assert.match(source, /express\.application\.use/);
  assert.match(source, /serveStatic/);
  assert.match(source, /private, no-cache/);
  assert.match(source, /js\|css\|svg\|png/);
  assert.doesNotMatch(source, /max-age=31536000|immutable/);
});

test('V89 patches are loaded before server and injected with fresh browser cache keys', () => {
  const bootstrap = read('bootstrap');
  const injector = read('injector');
  assert.match(bootstrap, /v89StaticAssetCachePatch/);
  assert.match(bootstrap, /v89InstantDashboardPatch/);
  assert.ok(bootstrap.indexOf('v89InstantDashboardPatch') < bootstrap.indexOf("importPhase('server'"));
  assert.match(injector, /v81-startup-source-truth\.js\?v=20260813-3/);
  assert.match(injector, /v85-business-rule-ui\.js\?v=20260813-2/);
  assert.match(injector, /v89-fast-dashboard\.js\?v=20260813-1/);
});
