import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const r=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(r.status,0,`${p}: ${r.stderr||r.stdout}`);};

test('V139 normal-web runtime files are syntax valid',()=>{
  for(const file of ['src/v139InstantBootstrapPatch.js','public/v139-normal-web-runtime.js','public/dashboard-v18.js','public/v132-whpp-seven-business-fast.js','public/v27-trend-mount-fix.js','src/v89StaticAssetCachePatch.js','src/v137TrendTruthPatch.js','src/v44WhppUiPatch.js'])syntax(file);
});

test('business renderer never probes processing APIs or blocks navigation after paint',()=>{
  const ui=read('public/dashboard-v18.js');
  assert.doesNotMatch(ui,/\/api\/business-state/);
  assert.doesNotMatch(ui,/\/api\/v33\/run-progress/);
  assert.doesNotMatch(ui,/protectUnfinishedBusinessDashboard/);
  assert.doesNotMatch(ui,/button\.disabled\s*=\s*true/);
  assert.match(ui,/后台扫描\/轨迹处理中，页面可正常浏览，完成后自动更新/);
  assert.match(ui,/__CE_QC_DASHBOARD_V18_BASE__/);
});

test('current import bootstrap supplies seven business shells from classified totals instead of prior completed date',()=>{
  const patch=read('src/v139InstantBootstrapPatch.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(patch,/v27BootstrapHandler/);
  assert.match(patch,/SELECT businessType,COUNT\(DISTINCT shipmentCode\)/);
  assert.match(patch,/classificationCounts/);
  for(const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'])assert.match(patch,new RegExp(type));
  assert.match(patch,/_instantImportShell:true/);
  assert.match(patch,/snapshotStatus:'PROCESSING'/);
  assert.match(patch,/this\.route\(path\)\.get\(handler\)/);
  assert.match(injector,/v139InstantBootstrapPatch\.js/);
});

test('WHPP current-day page uses imported classification count immediately and fetches summary only in background',()=>{
  const ui=read('public/v132-whpp-seven-business-fast.js');
  assert.match(ui,/v139-whpp-normal-web-v3/);
  assert.match(ui,/classificationCounts\?\.WHPP/);
  assert.match(ui,/render\(cached\|\|importShell\(date\)\)/);
  assert.match(ui,/void fetchFast\(date\)\.then/);
  assert.doesNotMatch(ui,/正在后台校验最新WHPP摘要/);
  assert.doesNotMatch(ui,/当前无WHPP本土数据/);
});

test('legacy V27 trend DOM runner is retired and old V27 network work is suppressed',()=>{
  const retired=read('public/v27-trend-mount-fix.js');
  const runtime=read('public/v139-normal-web-runtime.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(retired,/legacy V27 browser trend mount retired/);
  assert.doesNotMatch(retired,/api\/v27\/trends/);
  assert.match(runtime,/__CE_QC_DASHBOARD_V18_BASE__/);
  assert.match(runtime,/removeLegacyTrendDom/);
  assert.match(runtime,/api\\\/v27\\\/trends/);
  assert.match(runtime,/X-CE-QC-Retired/);
  assert.match(injector,/v139-normal-web-runtime\.js\?v=20260815-2/);
});

test('versioned JS CSS and images are immutable while HTML remains outside static asset cache',()=>{
  const cache=read('src/v89StaticAssetCachePatch.js');
  assert.match(cache,/public, max-age=31536000, immutable/);
  assert.match(cache,/versioned/);
  assert.doesNotMatch(cache,/\.html\$.*max-age=31536000/);
});

test('attempt trends never display fabricated zero percent when POD has no attempt evidence',()=>{
  const trend=read('src/v137TrendTruthPatch.js');
  assert.match(trend,/const evidence=d\.a1\+d\.a2\+d\.a3/);
  assert.match(trend,/d\.pod===0\|\|evidence>0/);
  assert.match(trend,/d\.pod>0\?rate\(d\.a1,d\.total\):null/);
  assert.match(trend,/d\.pod>0&&evidence===0/);
});
