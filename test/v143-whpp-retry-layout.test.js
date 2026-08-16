import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const syntax=file=>{const r=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});assert.equal(r.status,0,`${file}: ${r.stderr||r.stdout}`);};

test('V143 WHPP retry queue remains independent, persistent, async and only targets failed WHPP rows',()=>{
  syntax('src/v143WhppRetryQueuePatch.js');
  const s=read('src/v143WhppRetryQueuePatch.js');
  assert.match(s,/v143-whpp-independent-retry-queue-v2/);
  assert.match(s,/businessType='WHPP'/);
  assert.match(s,/API_PENDING_RETRY/);
  assert.match(s,/\/api\/v143\/whpp-retry-queue/);
  assert.match(s,/roundSizes=\[25,10,5,1\]/);
  assert.match(s,/attempt<3/);
  assert.match(s,/setImmediate/);
  assert.match(s,/UPDATE carryover_open_items/);
});

test('V145 reuses V143 WHPP engine inside the seven-business recovery center',()=>{
  syntax('public/v141-whpp-retry-isolation-ui.js');
  const ui=read('public/v141-whpp-retry-isolation-ui.js');
  assert.match(ui,/v145-seven-business-retry-center-v1/);
  assert.match(ui,/七业务接口失败 \/ 失效重试中心/);
  assert.match(ui,/\/api\/v143\/whpp-retry-queue\/recheck/);
  assert.match(ui,/WHPP本土/);
  assert.match(ui,/重新登录CE并继续重试/);
});

test('V143 backend remains wired through the already-installed V141 backend entry point',()=>{
  const backend=read('src/v141WhppDailyRetryIsolationPatch.js');
  assert.match(backend,/import '\.\/v143WhppRetryQueuePatch\.js'/);
});
