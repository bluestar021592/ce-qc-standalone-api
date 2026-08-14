import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const r=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(r.status,0,`${p}: ${r.stderr||r.stdout}`);};

test('managed launcher remains fast-forward only and non-destructive',()=>{
  const launcher=read('tools/CE_QC_Managed_Launcher.ps1');
  assert.match(read('Start_CE_QC.cmd'),/CE_QC_Managed_Launcher\.ps1/);
  assert.match(launcher,/JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(launcher,/pull','--ff-only/);
  assert.match(launcher,/CE_QC_PreUpdate_Backup\.mjs/);
  assert.doesNotMatch(launcher,/reset\s+--hard/i);
});

test('current responsive runtime and purge files are syntax valid',()=>{
  for(const file of ['bootstrap.js','server.js','src/db.js','src/dataPurge.js','src/v105AsyncPurgePatch.js','src/v44WhppUiPatch.js','public/v104-fast-purge-ui.js','public/v108-route-lazy-features.js','public/v125-local-api-resilience.js'])syntax(file);
});

test('V130 purge submit and execute paths recover delayed completed jobs',()=>{
  const patch=read('src/v105AsyncPurgePatch.js');
  const purge=read('src/dataPurge.js');
  const ui=read('public/v104-fast-purge-ui.js');
  assert.match(patch,/v130-purge-job-recovery-v1/);
  assert.match(patch,/RECOVER_STATUS_PATH/);
  assert.match(patch,/function recentJobFor/);
  assert.match(ui,/v130-resilient-purge-submit-v4/);
  assert.match(ui,/recoverRecentJob/);
  assert.match(ui,/signal is aborted\|aborted without reason/);
  assert.match(ui,/Promise\.race\(\[submitPromise,recoveryPromise\]\)/);
  assert.match(purge,/FAST_TABLE_DELETE_FK_GUARDED/);
  assert.match(purge,/integrityCheck:'TRANSACTION_AND_SCHEMA'/);
  assert.doesNotMatch(purge,/wal_checkpoint\(TRUNCATE\)/);
});

test('request coalescing lazy loading and V125 resilience remain enabled',()=>{
  const req=read('public/v65-request-coalescing.js');
  const lazy=read('public/v108-route-lazy-features.js');
  const resilience=read('public/v125-local-api-resilience.js');
  assert.match(req,/const recent = new Map\(\)/);
  assert.match(lazy,/v108-route-lazy-features-v8/);
  assert.match(lazy,/v104-fast-purge-ui\.js\?v=20260814-8/);
  assert.match(resilience,/v125-local-api-resilience-v1/);
  assert.match(resilience,/\['GET','HEAD'\]\.includes\(method\)/);
});

test('WHPP total conservation guard remains after fast render',()=>{
  const guard=read('public/v103-home-whpp-card-guard.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(guard,/WHPP本土/);
  assert.match(guard,/const residual=Math\.max\(0,total-sixTotal\)/);
  assert.ok(injector.indexOf('v105-fast-render.js')<injector.indexOf('v103-home-whpp-card-guard.js'));
});
