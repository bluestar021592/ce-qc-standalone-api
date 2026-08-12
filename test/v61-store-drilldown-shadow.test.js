import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v51 = fs.readFileSync(new URL('../public/v51-runtime-fix.js', import.meta.url), 'utf8');
const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');

test('legacy V51 does not rewrite canonical V61 metric-detail back to V50 special-detail', () => {
  assert.match(v51, /url\.pathname==='\/api\/v61\/metric-detail'/);
  assert.match(v51, /Never let this legacy wrapper/);
  assert.match(v51, /global\.__CE_QC_V61_DRILLDOWN_ROUTE_BRIDGE__/);
});

test('V51 store click ownership yields to canonical V61 after bridge install', () => {
  assert.match(v51, /type==='WHPP'\|\|global\.__CE_QC_V61_DRILLDOWN_ROUTE_BRIDGE__/);
  assert.match(v51, /'金边门店':'phnomPenhShop','外省门店':'provinceShop'/);
});

test('UI injects refreshed V51 runtime before V55 V58 and V61 layers', () => {
  assert.match(injector, /v51-runtime-fix\.js\?v=20260812-2/);
  const v51Index = injector.indexOf('v51-runtime-fix.js');
  const v55Index = injector.indexOf('v55-dashboard-reconciliation.js');
  const v58Index = injector.indexOf('v58-drilldown-runtime.js');
  const v61Index = injector.indexOf('v61-drilldown-route-bridge.js');
  assert.ok(v51Index >= 0 && v55Index > v51Index && v58Index > v55Index && v61Index > v58Index);
});
