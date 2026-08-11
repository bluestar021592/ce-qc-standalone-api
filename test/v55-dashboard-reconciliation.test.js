import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const read=file=>fs.readFileSync(path.resolve(file),'utf8');

test('V55 facade is the canonical compact dashboard reader',()=>{
  const facade=read('src/rangeDashboardStore.js');
  assert.match(facade,/rangeDashboardStoreV55Compact/);
  const bootstrap=read('bootstrap.js');
  assert.match(bootstrap,/v55DashboardReconciliationPatch/);
  assert.ok(bootstrap.indexOf('v55DashboardReconciliationPatch')<bootstrap.indexOf("'server'"));
});

test('V55 mutually excludes final CCSLCN ZT 580 and normal destinations from genuine unresolved',()=>{
  const source=read('src/rangeDashboardStoreV55.js');
  assert.match(source,/function isGenuineOpen\(r\)\{return !isTerminal\(r\)&&!destination\(r\)&&!isSelfPickup\(r\)&&!isReturnInProgress\(r\)&&!isNormalOperationalOpen\(r\)&&!isActiveShop\(r\);\}/);
  assert.match(source,/ROUTING_DESTINATIONS\.CCSLCN/);
  assert.match(source,/ROUTING_DESTINATIONS\.CCSLZT/);
  assert.match(source,/ROUTING_DESTINATIONS\.CCSL580/);
  assert.match(source,/provinceOpen:tab\('外省未完结POD件',rows\.filter\(isProvinceOpen\)\)/);
});

test('V55 distinguishes Phnom Penh shops from provincial and SHV shops',()=>{
  const source=read('src/rangeDashboardStoreV55.js');
  assert.match(source,/phnomPenhShop:tab\('金边门店'/);
  assert.match(source,/provinceShop:tab\('外省门店'/);
  assert.match(source,/SHV/);
  assert.match(source,/SIHANOUK/);
  assert.match(source,/CCSL\[_:\\s-\]\*PV/);
});

test('V55 province-open is a location metric and does not itself create an abnormal',()=>{
  const source=read('src/rangeDashboardStoreV55.js');
  const abnormal=source.match(/function isActionableAbnormal\(r\)\{[\s\S]*?\n\}/)?.[0]||'';
  assert.ok(abnormal,'isActionableAbnormal must exist');
  assert.doesNotMatch(abnormal,/isProvinceOpen\(r\)/);
  assert.match(abnormal,/isActiveShop\(r\)/);
  assert.match(abnormal,/isStorePendingOrOc\(r\)/);
  assert.match(abnormal,/shopRetentionNaturalDays/);
});

test('V55 one source drives card summary and exact detail rows',()=>{
  const source=read('src/rangeDashboardStoreV55.js');
  assert.match(source,/state\.finalRows = rows/);
  assert.match(source,/state\.detailTabs = \{ \.\.\.\(state\.detailTabs \|\| \{\}\), \.\.\.details \}/);
  assert.match(source,/v55Summary/);
  assert.match(source,/loadMetricDetail/);
  assert.match(source,/accountingDifference:Math\.max\(0,total-pod-returned-normal-open\)/);
});

test('V55 compact facade keeps metric rows but not full shipment tables',()=>{
  const source=read('src/rangeDashboardStoreV55Compact.js');
  assert.match(source,/state\.finalRows=\[\]/);
  assert.match(source,/key==='dashboard'/);
  assert.match(source,/rows\.slice\(0,300\)/);
  assert.match(source,/\/api\/v55\/metric-detail/);
});

test('V55 UI directly owns the real V18 drilldown entry points',()=>{
  const ui=read('public/v55-dashboard-reconciliation.js');
  assert.match(ui,/global\.openV18MetricDetail=function v55OpenV18MetricDetail/);
  assert.match(ui,/global\.openMetricDetail=function v55OpenMetricDetail/);
  assert.match(ui,/\/api\/v55\/metric-detail/);
  for(const label of ['CCSLCN分流','CCSLZT分流','580滞留包裹','金边门店','外省门店','外省未完结POD件','当前未闭环'])assert.match(ui,new RegExp(label));
});

test('V55 UI reconciles legacy top cards from the authoritative V55 summary endpoint',()=>{
  const ui=read('public/v55-dashboard-reconciliation.js');
  assert.match(ui,/\/api\/v55\/reconciliation/);
  assert.match(ui,/syncVisibleBusinessPage/);
  assert.match(ui,/'当前未闭环':s\.open/);
  assert.match(ui,/'CCSLCN分流':s\.ccslCnDiversion/);
  assert.match(ui,/ensureCoreCard\(grid,type,label/);
  assert.match(ui,/MutationObserver/);
  assert.match(ui,/function setText\(node,text\)/);
  assert.match(ui,/record\.addedNodes/);
});

test('V55 home core metrics use the same exact drilldown endpoint',()=>{
  const ui=read('public/v55-home-drilldown.js');
  assert.match(ui,/\/api\/v55\/metric-detail/);
  assert.match(ui,/businessType:'CCSL'/);
  assert.match(ui,/外省未完结POD件/);
  assert.match(ui,/金边门店/);
  assert.match(ui,/外省门店/);
});

test('V55 is injected after previous dashboard compatibility scripts with a fresh cache key',()=>{
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(injector,/v55-dashboard-reconciliation\.js\?v=20260811-4/);
  assert.match(injector,/v55-home-drilldown\.js/);
  assert.ok(injector.indexOf('v55-dashboard-reconciliation.js')>injector.indexOf('v50-dashboard-source-truth.js'));
});

test('V55 JavaScript files pass syntax checks',()=>{
  for(const relative of ['src/rangeDashboardStoreV55.js','src/rangeDashboardStoreV55Compact.js','src/v55DashboardReconciliationPatch.js','public/v55-dashboard-reconciliation.js','public/v55-home-drilldown.js']){
    const result=spawnSync(process.execPath,['--check',path.resolve(relative)],{encoding:'utf8'});
    assert.equal(result.status,0,`${relative} syntax failed:\n${result.stderr||result.stdout}`);
  }
});