import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const result=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(result.status,0,`${p}: ${result.stderr||result.stdout}`);};

test('V150 candidate critical runtime files are syntax valid',()=>{
  for(const file of [
    'bootstrap.js','server.js','src/v44WhppUiPatch.js','src/v102UnifiedImportSafetyGatePatch.js','src/v150UnifiedImportFastRoutePatch.js',
    'src/v137TrendTruthPatch.js','src/v142UnifiedSnapshotRepairPatch.js','src/v143HomeTruthPatch.js','src/v146ProcessingReadinessPatch.js','src/unifiedImportStore.js',
    'public/v67-resilient-run-guard.js','public/v137-range-trends.js','public/v139-normal-web-runtime.js','public/v64-whpp-total-kpi-integration.js','public/v150-import-fast-path.js'
  ])syntax(file);
});

test('V150 UI loads import fast path last and cache busts event-driven home truth',()=>{
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(injector,/2026-08-15-v150-import-first-stability-v38/);
  assert.match(injector,/v64-whpp-total-kpi-integration\.js\?v=20260815-10/);
  assert.match(injector,/v150-import-fast-path\.js\?v=20260815-3/);
  assert.ok(injector.indexOf('v64-whpp-total-kpi-integration.js?v=20260815-10')<injector.indexOf('v150-import-fast-path.js?v=20260815-3'));
});

test('V150 browser import returns after persistence and does not wait for dashboard states',()=>{
  const ui=read('public/v150-import-fast-path.js');
  assert.match(ui,/v150-import-fast-path-v3/);
  assert.match(ui,/api\/import\/unified-daily-report/);
  assert.match(ui,/已保存，可以继续上传下一份/);
  assert.doesNotMatch(ui,/api\/state\?compact=1/);
  assert.doesNotMatch(ui,/api\/shopee\/state\?compact=1/);
});

test('V150 safety gate parses workbook once and hands parsed object to persistence route',()=>{
  const safety=read('src/v102UnifiedImportSafetyGatePatch.js');
  assert.match(safety,/v150-single-parse-import-safety-v4/);
  assert.match(safety,/req\.ceQcParsedUnified = parsed/);
  assert.match(safety,/await import\('\.\/v150UnifiedImportFastRoutePatch\.js'\)/);
});

test('V150 upload-first backend removes full carry queue from upload request',()=>{
  const fast=read('src/v150UnifiedImportFastRoutePatch.js');
  assert.match(fast,/v150-upload-first-route-v1/);
  assert.match(fast,/req\.ceQcParsedUnified\|\|parseUnifiedDailyExcel/);
  assert.match(fast,/saveUnifiedImport\(parsed,req\.file\.originalname\)/);
  assert.match(fast,/processingDeferred:true/);
  assert.match(fast,/statePreparation:'ON_PROCESS_START'/);
  const importStart=fast.indexOf('async function fastImportHandler');
  const importEnd=fast.indexOf('const previousPost=',importStart);
  const importBlock=fast.slice(importStart,importEnd);
  assert.doesNotMatch(importBlock,/getUnifiedProcessingQueue/);
  assert.doesNotMatch(importBlock,/loadState\(/);
  assert.doesNotMatch(importBlock,/loadBusinessState\(/);
});

test('V150 heavy carry hydration moves to actual process start',()=>{
  const fast=read('src/v150UnifiedImportFastRoutePatch.js');
  assert.match(fast,/const queue=getUnifiedProcessingQueue\(batch\.batchId\)/);
  assert.match(fast,/START_ROUTES=new Set\(\['\/api\/run\/start','\/api\/shopee\/run\/start'\]\)/);
  assert.match(fast,/await hydrateReportState\(requested\)/);
  assert.match(fast,/unifiedBatchId=batch\.batchId/);
});

test('V150 homepage truth is event-driven and never background polls SQL',()=>{
  const ui=read('public/v64-whpp-total-kpi-integration.js');
  assert.match(ui,/v150-event-driven-home-truth-v4/);
  assert.match(ui,/EVENT_DRIVEN_NO_BACKGROUND_POLL/);
  assert.doesNotMatch(ui,/setInterval/);
  assert.doesNotMatch(ui,/MutationObserver/);
});

test('homepage core remains isolated from Shopee',()=>{
  const backend=read('src/v143HomeTruthPatch.js');
  assert.match(backend,/CORE_TYPES=new Set\(\['CE','CEAF','TBKH','ALI1688','WHPP'\]\)/);
});

test('unified snapshot completion still blocks failed reconciliation',()=>{
  const store=read('src/unifiedImportStore.js');
  assert.match(store,/UNIFIED_RECONCILIATION_FAILED/);
  assert.match(store,/validationPassed/);
  assert.match(store,/status='COMPLETED'/);
});

test('database schema is not bumped by V150 upload repairs',()=>{
  const migrations=read('src/migrations.js');
  assert.match(migrations,/const SCHEMA_VERSION = 18/);
});
