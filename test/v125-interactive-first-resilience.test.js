import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const r=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(r.status,0,`${p}: ${r.stderr||r.stdout}`);};

test('V125 retries only safe local API reads and does not duplicate writes',()=>{
  const file='public/v125-local-api-resilience.js';
  syntax(file);
  const source=read(file);
  assert.match(source,/v125-local-api-resilience-v1/);
  assert.match(source,/RETRY_DELAYS=\[250,800,1600\]/);
  assert.match(source,/url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(source,/\['GET','HEAD'\]\.includes\(method\)/);
  assert.doesNotMatch(source,/\['POST'/);
  assert.match(source,/networkFailure\(error\)/);
  assert.match(source,/lastSuccessfulApiAt/);
});

test('V125 health probe needs repeated evidence before declaring local backend unavailable',()=>{
  const source=read('public/v125-local-api-resilience.js');
  assert.match(source,/robustHealthProbe\(timeoutMs=6500\)/);
  assert.match(source,/const attempts=2/);
  assert.match(source,/Date\.now\(\)-lastSuccessfulApiAt<15_000/);
  assert.match(source,/global\.rawHealthProbe=robustHealthProbe/);
});

test('V125 loads before app.js while request coalescing remains first',()=>{
  syntax('src/v44WhppUiPatch.js');
  const injector=read('src/v44WhppUiPatch.js');
  const coalesce=injector.indexOf('/v65-request-coalescing.js?v=20260814-3');
  const resilience=injector.indexOf('/v125-local-api-resilience.js?v=20260814-1');
  const runner=injector.indexOf('/v67-resilient-run-guard.js?v=20260814-5');
  assert.ok(coalesce>=0&&resilience>coalesce&&runner>resilience);
  assert.match(injector,/v125-responsive-performance-spine-v16/);
});

test('startup dashboard cache warm is deferred from 1.5s to at least 30s and defaults to 120s',()=>{
  syntax('bootstrap.js');
  const source=read('bootstrap.js');
  assert.match(source,/DASHBOARD_CACHE_STARTUP_DELAY_MS/);
  assert.match(source,/DASHBOARD_CACHE_STARTUP_DELAY_MS = '120000'/);
  assert.match(source,/async function importServerInteractiveFirst\(\)/);
  assert.match(source,/Number\(delay\) === 1500/);
  assert.match(source,/launchDashboardCacheWorker/);
  assert.match(source,/STARTUP_WARM/);
  assert.match(source,/Math\.max\(30_000/);
  assert.match(source,/globalThis\.setTimeout = nativeSetTimeout/);
  assert.match(source,/await importServerInteractiveFirst\(\)/);
});
