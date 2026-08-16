import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const syntax=file=>{const r=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});assert.equal(r.status,0,`${file}: ${r.stderr||r.stdout}`);};

test('V143 WHPP retry queue is independent, persistent and only targets failed WHPP rows',()=>{
  syntax('src/v143WhppRetryQueuePatch.js');
  const s=read('src/v143WhppRetryQueuePatch.js');
  assert.match(s,/v143-whpp-independent-retry-queue-v1/);
  assert.match(s,/businessType='WHPP'/);
  assert.match(s,/API_PENDING_RETRY/);
  assert.match(s,/\/api\/v143\/whpp-retry-queue/);
  assert.match(s,/\/api\/v143\/whpp-retry-queue\/recheck/);
  assert.match(s,/roundSizes=\[25,10,5,1\]/);
  assert.match(s,/attempt<3/);
  assert.match(s,/UPDATE business_final_rows/);
  assert.match(s,/UPDATE carryover_open_items/);
  assert.match(s,/UPDATE shipment_current_state/);
  assert.doesNotMatch(s,/DELETE FROM/);
});

test('V143 retry UI gives WHPP its own button and removes the import-page masonry gap',()=>{
  syntax('public/v141-whpp-retry-isolation-ui.js');
  const ui=read('public/v141-whpp-retry-isolation-ui.js');
  assert.match(ui,/v143-whpp-retry-layout-ui-v1/);
  assert.match(ui,/WHPP接口待重试/);
  assert.match(ui,/独立重试下一批/);
  assert.match(ui,/25→10→5→1/);
  assert.match(ui,/grid-template-areas:"import summary" "run run" "carry carry"/);
  assert.match(ui,/#importPage #runPanel\{grid-area:run/);
  assert.match(ui,/#importPage #v139CarryManualPanel\{grid-area:carry/);
});

test('V143 is wired through the already-installed V141 backend entry point',()=>{
  const backend=read('src/v141WhppDailyRetryIsolationPatch.js');
  assert.match(backend,/import '\.\/v143WhppRetryQueuePatch\.js'/);
});
