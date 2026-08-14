import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const r=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(r.status,0,`${p}: ${r.stderr||r.stdout}`);};

test('carry live UI remains syntax-valid and backend-owned',()=>{
  syntax('public/v99-carry-live-ui.js');
  syntax('src/v98CarryRefreshEndpointPatch.js');
  const live=read('public/v99-carry-live-ui.js');
  const backend=read('src/v98CarryRefreshEndpointPatch.js');
  assert.match(live,/v27CarryRefreshCurrent/);
  assert.match(live,/POLL_MS=60\*1000/);
  assert.match(backend,/startCarryoverRefreshScheduler/);
});

test('normal HTML injection still includes carry live UI',()=>{
  const source=read('src/v44WhppUiPatch.js');
  assert.match(source,/v99-carry-live-ui\.js/);
});
