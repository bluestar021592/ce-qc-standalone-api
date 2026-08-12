import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const carrySource=fs.readFileSync(new URL('../src/v51CarryDashboardPatch.js',import.meta.url),'utf8');
const uiSource=fs.readFileSync(new URL('../public/v51-runtime-fix.js',import.meta.url),'utf8');
const injectSource=fs.readFileSync(new URL('../src/v44WhppUiPatch.js',import.meta.url),'utf8');

test('V51 inherited anomaly excludes dedicated normal destinations and includes WHPP/CEAF business dimensions',()=>{
  assert.match(carrySource,/ROUTING_DESTINATIONS\.CCSLCN/);
  assert.match(carrySource,/ROUTING_DESTINATIONS\.CCSLZT/);
  assert.match(carrySource,/ROUTING_DESTINATIONS\.CCSL580/);
  assert.match(carrySource,/CCSLCN_DIVERSION/);
  assert.match(carrySource,/CCSLZT_DIVERSION/);
  assert.match(carrySource,/CCSL580_DIVERSION/);
  assert.match(carrySource,/SHOP_TRANSFER_IN_PROGRESS/);
  assert.match(carrySource,/SHOP_ARRIVED_CURRENT/);
  assert.match(carrySource,/\['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'\]/);
  assert.match(carrySource,/if \(!reason\) continue/);
});

test('V57 carry anomaly honors explicit business thresholds before generic stale age',()=>{
  assert.match(carrySource,/hasExplicitThresholdState/);
  assert.match(carrySource,/盘点1天 is NOT promoted/);
  assert.match(carrySource,/if \(cycle >= 2\) return '盘点2天\+'/);
  assert.match(carrySource,/if \(hasExplicitThresholdState\) return ''/);
  assert.ok(carrySource.indexOf("if (hasExplicitThresholdState) return ''") < carrySource.indexOf("if (stale >= 3) return '3天+无新节点'"));
});

test('V51 browser runtime keeps exact drilldown and uses lightweight WHPP home summary',()=>{
  assert.match(uiSource,/\/api\/v71\/whpp-summary/);
  assert.doesNotMatch(uiSource,/\/api\/v50\/whpp-state/);
  assert.match(uiSource,/\/api\/v50\/whpp-metric-detail/);
  assert.match(uiSource,/\/api\/v50\/special-detail/);
  assert.match(uiSource,/\/api\/v51\/carry-monitor/);
  assert.match(uiSource,/WHPP本土/);
  assert.match(uiSource,/占总票数/);
  assert.match(uiSource,/CCSLCN分流/);
  assert.match(uiSource,/CCSLZT分流/);
  assert.match(uiSource,/580滞留包裹/);
  assert.match(uiSource,/金边门店/);
});

test('V51 browser runtime is event-driven and never observes or polls the whole app',()=>{
  assert.doesNotMatch(uiSource,/new MutationObserver/);
  assert.doesNotMatch(uiSource,/setInterval/);
  assert.match(uiSource,/ce-qc-run-complete/);
  assert.match(uiSource,/visibilitychange/);
});

test('V51 runtime is injected after V50 on every application page with current cache key',()=>{
  const v50=injectSource.indexOf('/v50-dashboard-source-truth.js');
  const v51=injectSource.indexOf('/v51-runtime-fix.js?v=20260812-3');
  assert.ok(v50>=0);
  assert.ok(v51>v50);
  assert.match(injectSource,/import '\.\/v51CarryDashboardPatch\.js'/);
});
