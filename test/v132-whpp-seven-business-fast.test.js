import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const r=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(r.status,0,`${p}: ${r.stderr||r.stdout}`);};

test('V132 WHPP fast summary is compact cached and snapshot-aware',()=>{
  const backend=read('src/v132WhppFastIntegrationPatch.js');
  syntax('src/v132WhppFastIntegrationPatch.js');
  assert.match(backend,/v132-whpp-fast-summary-v1/);
  assert.match(backend,/\/api\/v132\/whpp-fast-summary/);
  assert.match(backend,/business_history_summary/);
  assert.match(backend,/business_final_rows/);
  assert.match(backend,/CACHE_MS/);
  assert.match(backend,/cacheHit:true/);
  assert.match(backend,/snapshotStatus:history\?'COMPLETED':'PENDING'/);
  assert.doesNotMatch(backend,/SELECT valueJson FROM business_states/);
});

test('V132 page never treats imported-only WHPP as real all-unclosed result',()=>{
  const ui=read('public/v132-whpp-seven-business-fast.js');
  syntax('public/v132-whpp-seven-business-fast.js');
  assert.match(ui,/v132-whpp-seven-business-fast-v2/);
  assert.match(ui,/当前“未闭环”只是待处理占位/);
  assert.match(ui,/不代表\$\{fmt\(total\)\}票真实全部未闭环/);
  assert.match(ui,/\/api\/v132\/whpp-fast-summary/);
  assert.match(ui,/ce_qc_v132_whpp_fast_summary/);
  assert.doesNotMatch(ui,/navigateWhppPage\(date\).*250/s);
});

test('V132 final auto-process authority requires WHPP completed snapshot',()=>{
  const ui=read('public/v132-whpp-seven-business-fast.js');
  const base=read('public/v67-resilient-run-guard.js');
  assert.match(base,/WHPP本土/);
  assert.match(base,/\/api\/whpp\/run\/start/);
  assert.match(ui,/ensureWhppCompleted/);
  assert.match(ui,/WHPP最终快照已验证/);
  assert.match(ui,/系统不会把它误报为七业务处理完成/);
  assert.match(ui,/\/api\/whpp\/progress/);
  assert.match(ui,/\/api\/whpp\/run\/resume/);
  assert.match(ui,/WHPP_RUN_ALREADY_ACTIVE/);
  assert.match(ui,/global\.runUnified=\(\)=>runSeven\('start'\)/);
  assert.match(ui,/global\.resumeUnified=\(\)=>runSeven\('resume'\)/);
});

test('V132 is the final WHPP navigation path and old V90 full-refresh bridge is not injected',()=>{
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(injector,/v132-whpp-fast-seven-business-v19/);
  assert.match(injector,/\.\/v132WhppFastIntegrationPatch\.js/);
  assert.match(injector,/v132-whpp-seven-business-fast\.js\?v=20260814-1/);
  assert.doesNotMatch(injector,/v90-instant-whpp-navigation\.js/);
  assert.ok(injector.indexOf('v103-home-whpp-card-guard.js')<injector.indexOf('v132-whpp-seven-business-fast.js'));
});
