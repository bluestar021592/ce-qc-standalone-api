import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('WHPP start/resume is accepted immediately and real work stays in background promise',()=>{
  const source=read('src/v134WhppRunSupervisorPatch.js');
  assert.match(source,/runtimePromise = Promise\.resolve\(\)\.then/);
  assert.match(source,/res\.status\(202\)\.json/);
  assert.match(source,/accepted: true/);
  assert.match(source,/WHPP任务已进入后台执行/);
});

test('WHPP persisted running state cannot masquerade as a live runtime after restart',()=>{
  const source=read('src/v134WhppRunSupervisorPatch.js');
  assert.match(source,/const stale = Boolean\(persisted\.running && !runtimeActive\)/);
  assert.match(source,/running: false/);
  assert.match(source,/WHPP等待断点恢复/);
  assert.match(source,/将从已保存断点继续/);
});

test('WHPP checkpoints strip duplicate raw payloads and keep resumable evidence arrays',()=>{
  const source=read('src/v134WhppRunSupervisorPatch.js');
  assert.match(source,/scanResults: \(state\.scanResults \|\| \[\]\)\.map\(stripHeavyRow\)/);
  assert.match(source,/trackEvents: \(state\.trackEvents \|\| \[\]\)\.map\(stripHeavyRow\)/);
  assert.match(source,/exceptionItems: \(state\.exceptionItems \|\| \[\]\)\.map\(stripHeavyRow\)/);
  assert.match(source,/delete copy\.rawJson/);
  assert.match(source,/trackResults: \[\]/);
});

test('WHPP progress exposes actual scan range and uses a dedicated bounded CE timeout',()=>{
  const source=read('src/v134WhppRunSupervisorPatch.js');
  assert.match(source,/WHPP_REQUEST_TIMEOUT_MS \|\| 20_000/);
  assert.match(source,/client\.http\.defaults\.timeout = WHPP_REQUEST_TIMEOUT_MS/);
  assert.match(source,/WHPP订单扫描\\s\+\(\\d\+\)-\(\\d\+\)/);
  assert.match(source,/runtimeActive/);
  assert.match(source,/heartbeatAt/);
});
