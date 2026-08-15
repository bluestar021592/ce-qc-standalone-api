import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const result=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(result.status,0,`${p}: ${result.stderr||result.stdout}`);};

test('V143 candidate critical runtime files are syntax valid',()=>{
  for(const file of [
    'bootstrap.js','server.js','src/v44WhppUiPatch.js','src/v137TrendTruthPatch.js',
    'src/v142UnifiedSnapshotRepairPatch.js','src/v143HomeTruthPatch.js','src/unifiedImportStore.js',
    'public/v137-range-trends.js','public/v139-normal-web-runtime.js','public/v64-whpp-total-kpi-integration.js'
  ])syntax(file);
});

test('V143 UI cache bust loads canonical home truth after all legacy home mutators',()=>{
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(injector,/2026-08-15-v143-canonical-home-truth-v32/);
  assert.match(injector,/import '\.\/v143HomeTruthPatch\.js'/);
  assert.match(injector,/v137-range-trends\.js\?v=20260815-6/);
  assert.match(injector,/v64-whpp-total-kpi-integration\.js\?v=20260815-7/);
  assert.ok(injector.indexOf('v139-normal-web-runtime.js?v=20260815-5')<injector.indexOf('v64-whpp-total-kpi-integration.js?v=20260815-7'));
  assert.doesNotMatch(injector,/<script src="\/v56-trend-truth\.js/);
});

test('V143 home core source excludes Shopee while top total keeps all seven businesses',()=>{
  const backend=read('src/v143HomeTruthPatch.js');
  const ui=read('public/v64-whpp-total-kpi-integration.js');
  assert.match(backend,/CORE_TYPES=new Set\(\['CE','CEAF','TBKH','ALI1688','WHPP'\]\)/);
  assert.match(backend,/SHOPEE_TYPES=new Set\(\['SHOPEECN','SHOPEEVN'\]\)/);
  assert.match(backend,/core:coreSummary\(rows\)/);
  assert.match(backend,/dispatch:dispatchSummary\(rows,date\)/);
  assert.match(ui,/CANONICAL_CORE_FIVE_BUSINESSES/);
  assert.match(ui,/CANONICAL_SHOPEE_ATTEMPT_TRUTH/);
  assert.doesNotMatch(ui,/baseValue\(/);
  assert.doesNotMatch(ui,/\+ Number\(addValue/);
});

test('V143 dispatch never fabricates 0 percent when a POD group has no attempt evidence',()=>{
  const backend=read('src/v143HomeTruthPatch.js');
  assert.match(backend,/group\.pod>0&&group\.known===0/);
  assert.match(backend,/group\.values=\[null,null,null\]/);
  assert.match(backend,/business_track_events/);
  assert.match(backend,/podAttemptNo/);
  assert.match(backend,/fallbackAttempt/);
});

test('selected-day trend endpoint exposes lifecycle truth and automatic persisted repair',()=>{
  const backend=read('src/v137TrendTruthPatch.js');const repair=read('src/v142UnifiedSnapshotRepairPatch.js');
  assert.match(backend,/repairUnifiedSnapshotCompletion\(to\)/);assert.match(backend,/requestedDateLifecycle:lifecycle/);assert.match(backend,/business_track_events/);assert.match(backend,/trackAttemptCount/);
  assert.match(repair,/latestCcslSnapshot/);assert.match(repair,/latestShopeeSnapshot/);assert.match(repair,/VALID/);assert.match(repair,/COMPLETED/);assert.match(repair,/completeUnifiedSnapshot/);
});

test('front end distinguishes not imported processing reconciliation failure and generic version mismatch fallback',()=>{
  const ui=read('public/v137-range-trends.js');assert.match(ui,/requestedDateLifecycle/);assert.match(ui,/尚未导入日报/);assert.match(ui,/正在等待处理完成/);assert.match(ui,/一致性检查未通过/);assert.match(ui,/没有 VALID \+ COMPLETED 的有效日报快照/);
});

test('unified snapshot completion still blocks invalid reconciliation rather than fabricating a completed day',()=>{
  const store=read('src/unifiedImportStore.js');assert.match(store,/INVALID_FAILED_RECONCILIATION/);assert.match(store,/UNIFIED_RECONCILIATION_FAILED/);assert.match(store,/validationPassed/);assert.match(store,/status='COMPLETED'/);
});

test('database schema is not bumped by V143 read-only dashboard truth',()=>{
  const migrations=read('src/migrations.js');assert.match(migrations,/const SCHEMA_VERSION = 18/);
  const backend=read('src/v143HomeTruthPatch.js');assert.doesNotMatch(backend,/INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/);
});
