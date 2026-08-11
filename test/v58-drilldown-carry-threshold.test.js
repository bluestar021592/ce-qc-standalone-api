import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const read=file=>fs.readFileSync(path.resolve(file),'utf8');

test('V58 carry truth makes dedicated thresholds outrank generic record age',()=>{
  const source=read('src/rangeDashboardStoreV58.js');
  assert.match(source,/if\(\/盘点\/i\.test\(c\)\|\|cycle>0\)return cycle>=2/);
  assert.match(source,/return oc>=2/);
  assert.match(source,/return isPendingNonContinuous\(row\)\|\|pending>=3/);
  assert.match(source,/A 41-day-old source/);
  assert.match(source,/isSevereCarryRow/);
});

test('V58 excludes CEZT CCSLCN CCSL580 normal registration destinations from carry anomalies',()=>{
  const source=read('src/rangeDashboardStoreV58.js');
  assert.match(source,/isNormalRegistryDestination/);
  assert.match(source,/classifyFinalRoutingDestination\(row\)\.destination/);
  assert.match(source,/CCSLCN_DIVERSION/);
  assert.match(source,/CCSLZT_DIVERSION/);
  assert.match(source,/CCSL580_\(\?:RETENTION\|DIVERSION\)/);
});

test('V58 becomes the compact dashboard and metric-detail source of truth',()=>{
  const compact=read('src/rangeDashboardStoreV55Compact.js');
  const api=read('src/v55DashboardReconciliationPatch.js');
  assert.match(compact,/rangeDashboardStoreV58/);
  assert.match(api,/rangeDashboardStoreV58/);
  assert.match(api,/\/api\/v55\/metric-detail/);
});

test('V58 drilldown resolves business context and renamed registry cards without relying only on pathname',()=>{
  const ui=read('public/v58-drilldown-runtime.js');
  assert.match(ui,/inlineBusinessType/);
  assert.match(ui,/currentBusinessType/);
  assert.match(ui,/v18-page-heading h2/);
  assert.match(ui,/ensureDetailHost/);
  assert.match(ui,/addEventListener\('click',onClick,true\)/);
  assert.match(ui,/\/api\/v55\/metric-detail/);
  assert.match(ui,/normalizeSpecialLabels/);
  for(const label of ['CCSL580','CEZT','CCSLCN','金边门店','外省门店','严重异常'])assert.match(ui,new RegExp(label));
});

test('V58 UI is injected after V55 and trend compatibility layers with fresh cache key',()=>{
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(injector,/v58-drilldown-runtime\.js\?v=20260811-2/);
  assert.ok(injector.indexOf('v58-drilldown-runtime.js')>injector.indexOf('v55-dashboard-reconciliation.js'));
  assert.ok(injector.indexOf('v58-drilldown-runtime.js')>injector.indexOf('v56-trend-truth.js'));
});

test('V58 JavaScript files pass syntax checks',()=>{
  for(const relative of ['src/rangeDashboardStoreV58.js','public/v58-drilldown-runtime.js','src/v55DashboardReconciliationPatch.js','src/rangeDashboardStoreV55Compact.js']){
    const result=spawnSync(process.execPath,['--check',path.resolve(relative)],{encoding:'utf8'});
    assert.equal(result.status,0,`${relative} syntax failed:\n${result.stderr||result.stdout}`);
  }
});
