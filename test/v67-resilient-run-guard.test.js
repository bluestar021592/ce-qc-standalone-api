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
const progressBridgePath=path.join(root,'public','v96-v67-live-progress-bridge.js');
const injectorPath=path.join(root,'src','v44WhppUiPatch.js');
const read=p=>fs.readFileSync(p,'utf8');

test('V67 authoritative seven-business runner is syntax-valid',()=>{
  const result=spawnSync(process.execPath,['--check',runtimePath],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
});

test('V67 reads only compact CCSL/Shopee state plus lightweight WHPP summary',()=>{
  const source=read(runtimePath);
  assert.match(source,/\/api\/state\?compact=1/);
  assert.match(source,/\/api\/shopee\/state\?compact=1/);
  assert.match(source,/\/api\/v71\/whpp-summary/);
  assert.doesNotMatch(source,/\/api\/v51\/whpp-state/);
  assert.doesNotMatch(source,/\/api\/whpp\/state/);
});

test('V67 owns start and resume for all three processing families with bounded retry',()=>{
  const source=read(runtimePath);
  for(const route of ['/api/run','/api/resume','/api/shopee/run/start','/api/shopee/run/resume','/api/whpp/run/start','/api/whpp/run/resume']) assert.match(source,new RegExp(route.replaceAll('/','\\/')));
  assert.match(source,/attempt < 3/);
  assert.match(source,/results\.push\(await runStage/);
  assert.match(source,/isAuth/);
  assert.match(source,/isTransient/);
  assert.match(source,/socket hang up/);
  assert.match(source,/failed to fetch/i);
});

test('V67 skips a persisted completed snapshot regardless of operational unresolved count',()=>{
  const source=read(runtimePath);
  assert.match(source,/if \(!hasReport\(state, stage\.key\) \|\| completed\(state\)\)/);
  assert.match(source,/status === 'COMPLETED'/);
  assert.doesNotMatch(source,/completed\(state\).*unresolved/);
});

test('V96 restores read-only V33 live progress without replacing V67 runner',()=>{
  const source=read(progressBridgePath);
  const syntax=spawnSync(process.execPath,['--check',progressBridgePath],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  assert.match(source,/\/api\/v33\/run-progress\?businessType=/);
  assert.match(source,/readProgress\('CCSL'\)/);
  assert.match(source,/readProgress\('SHOPEE'\)/);
  assert.match(source,/POLL_MS\s*=\s*1200/);
  assert.match(source,/item\?\.running === true/);
  assert.doesNotMatch(source,/global\.runUnified\s*=/);
  assert.doesNotMatch(source,/global\.resumeUnified\s*=/);
  assert.doesNotMatch(source,/method:\s*['"]POST['"]/);
});

test('V67 and V96 progress bridge are injected with current cache keys',()=>{
  const injector=read(injectorPath);
  assert.match(injector,/v67-resilient-run-guard\.js\?v=20260812-4/);
  assert.match(injector,/v96-v67-live-progress-bridge\.js\?v=20260813-1/);
  const v67=injector.indexOf('v67-resilient-run-guard.js');
  const v47=injector.indexOf('whpp-v47-auto-run.js');
  const v54=injector.indexOf('v54-whpp-unified-integration.js');
  const v64=injector.indexOf('v64-whpp-total-kpi-integration.js');
  const v96=injector.indexOf('v96-v67-live-progress-bridge.js');
  assert.ok(v67>=0 && v47>=0 && v54>=0 && v64>=0 && v96>=0);
  assert.ok(v67<v47);
  assert.ok(v67<v54);
  assert.ok(v67<v64);
  assert.ok(v96>v67);
});
