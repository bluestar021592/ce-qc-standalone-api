import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const root=path.resolve(__dirname,'..');
const runtimePath=path.join(root,'public','v67-resilient-run-guard.js');
const injectorPath=path.join(root,'src','v44WhppUiPatch.js');
const read=p=>fs.readFileSync(p,'utf8');

test('V67 resilient run guard is syntax-valid',()=>{
  const result=spawnSync(process.execPath,['--check',runtimePath],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
});

test('V67 preserves last good dashboard truth on transient GET failure',()=>{
  const source=read(runtimePath);
  assert.match(source,/\/api\/import\/unified-latest/);
  assert.match(source,/\/api\/state/);
  assert.match(source,/\/api\/shopee\/state/);
  assert.match(source,/\/api\/v51\/whpp-state/);
  assert.match(source,/readCache/);
  assert.match(source,/serving last good dashboard truth/);
  assert.match(source,/NETWORK_CONNECTION_INTERRUPTED/);
});

test('V67 resumes every processing family after an interrupted run',()=>{
  const source=read(runtimePath);
  assert.match(source,/['"]\/api\/resume['"]/);
  assert.match(source,/['"]\/api\/shopee\/run\/resume['"]/);
  assert.match(source,/['"]\/api\/whpp\/run\/resume['"]/);
  assert.match(source,/socket hang up/);
  assert.match(source,/failed to fetch/i);
  assert.match(source,/waitForStage/);
});

test('V67 loads before legacy unified run and WHPP dashboard runtimes',()=>{
  const injector=read(injectorPath);
  assert.match(injector,/v67-resilient-run-guard\.js\?v=20260812-1/);
  const v67=injector.indexOf('v67-resilient-run-guard.js');
  const v54=injector.indexOf('v54-whpp-unified-integration.js');
  const v64=injector.indexOf('v64-whpp-total-kpi-integration.js');
  assert.ok(v67>=0 && v54>=0 && v64>=0);
  assert.ok(v67<v54);
  assert.ok(v67<v64);
});
