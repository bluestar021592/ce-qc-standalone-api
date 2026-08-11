import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const read=file=>fs.readFileSync(path.resolve(file),'utf8');

test('V61 bridge rewrites every legacy V55 metric-detail request to the canonical route',()=>{
  const source=read('public/v61-drilldown-route-bridge.js');
  assert.match(source,/\/api\/v55\/metric-detail\?/);
  assert.match(source,/\/api\/v61\/metric-detail\?/);
  assert.match(source,/global\.fetch=function ceQcV61Fetch/);
  assert.match(source,/new Request\(next,input\)/);
});

test('V61 bridge is injected after all legacy dashboard click handlers',()=>{
  const source=read('src/v44WhppUiPatch.js');
  assert.match(source,/v61-drilldown-route-bridge\.js\?v=20260811-1/);
  assert.ok(source.indexOf('v61-drilldown-route-bridge.js')>source.indexOf('v55-dashboard-reconciliation.js'));
  assert.ok(source.indexOf('v61-drilldown-route-bridge.js')>source.indexOf('v55-home-drilldown.js'));
  assert.ok(source.indexOf('v61-drilldown-route-bridge.js')>source.indexOf('v58-drilldown-runtime.js'));
});

test('V61 bridge passes JavaScript syntax check',()=>{
  const result=spawnSync(process.execPath,['--check',path.resolve('public/v61-drilldown-route-bridge.js')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
});
