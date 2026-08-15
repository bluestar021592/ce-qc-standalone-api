import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const r=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(r.status,0,`${p}: ${r.stderr||r.stdout}`);};

test('V138 runtime javascript is syntax valid',()=>{
  for(const file of ['src/v137TrendTruthPatch.js','public/v137-range-trends.js','public/v108-route-lazy-features.js','public/v109-instant-business-navigation.js','src/v44WhppUiPatch.js'])syntax(file);
});

test('home desktop layout keeps all eight business cards on one row',()=>{
  const css=read('public/v138-dashboard-speed-layout.css');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(css,/#homePage\.v18-dashboard-page>\.v18-business-grid/);
  assert.match(css,/grid-template-columns:repeat\(8,minmax\(0,1fr\)\)!important/);
  assert.match(injector,/v138-dashboard-speed-layout\.css\?v=20260815-1/);
});

test('V138 is the only live trend renderer and legacy V56 is not injected',()=>{
  const ui=read('public/v137-range-trends.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(ui,/v138-range-trends-exclusive-v2/);
  assert.match(ui,/v137-exclusive-trends/);
  assert.match(ui,/data-replaced-by|replacedBy/);
  assert.match(ui,/v137-attempt-trends/);
  assert.match(ui,/SHOPEE CN/);
  assert.match(ui,/SHOPEE VN/);
  assert.match(injector,/v137-range-trends\.js\?v=20260815-2/);
  assert.doesNotMatch(injector,/<script src="\/v56-trend-truth\.js/);
});

test('trend backend computes a selected range once and reuses it across business navigation',()=>{
  const backend=read('src/v137TrendTruthPatch.js');
  assert.match(backend,/CACHE_TTL_MS=15_000/);
  assert.match(backend,/const trendCache=new Map\(\)/);
  assert.match(backend,/function cacheEntry/);
  assert.match(backend,/for\(const type of TYPES\)byType\[type\]=build/);
  assert.match(backend,/cacheHit/);
  assert.match(backend,/related=type==='TOTAL'/);
});

test('business navigation no longer performs duplicate full hydration or reloads legacy V90',()=>{
  const lazy=read('public/v108-route-lazy-features.js');
  const nav=read('public/v109-instant-business-navigation.js');
  assert.match(lazy,/v138-route-lazy-features-v9/);
  assert.doesNotMatch(lazy,/v90-instant-whpp-navigation/);
  assert.match(lazy,/BUSINESS_PAGES/);
  assert.match(lazy,/if\(!BUSINESS_PAGES\.has\(p\)&&typeof global\.renderAll/);
  assert.match(nav,/v138-summary-only-business-navigation-v2/);
  assert.match(nav,/V138_BOOTSTRAP_SUMMARY_ONLY/);
  assert.doesNotMatch(nav,/backgroundHydrate/);
});
