import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('carry filter exposes a refresh hook that reuses the active status',()=>{
  const source=read('public/v27-carry-business-filter.js');
  assert.match(source,/__CE_QC_CARRY_FILTER_STATE__/);
  assert.match(source,/v27CarryRefreshCurrent/);
  assert.match(source,/v27SetCarryStatus\(status\)/);
});

test('carry live UI refreshes only a visible carry page every minute',()=>{
  const relative='public/v99-carry-live-ui.js';
  const source=read(relative);
  const syntax=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  assert.match(source,/POLL_MS=60\*1000/);
  assert.match(source,/v27CarryRefreshCurrent/);
  assert.match(source,/document\.visibilityState==='hidden'/);
  assert.match(source,/v27CarryContent/);
});

test('normal UI injection includes the carry live runtime after the carry renderer',()=>{
  const source=read('src/v44WhppUiPatch.js');
  const base=source.indexOf('v51-runtime-fix.js');
  const live=source.indexOf('v99-carry-live-ui.js');
  assert.ok(base>=0 && live>base);
  assert.match(source,/v99-carry-live-ui\.js\?v=20260814-1/);
});
