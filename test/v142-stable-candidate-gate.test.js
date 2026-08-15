import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const result=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(result.status,0,`${p}: ${result.stderr||result.stdout}`);};

test('V151 candidate critical runtime files are syntax valid',()=>{
  for(const file of [
    'bootstrap.js','server.js','src/v44WhppUiPatch.js','src/v102UnifiedImportSafetyGatePatch.js','src/v150UnifiedImportFastRoutePatch.js',
    'src/v137TrendTruthPatch.js','src/v142UnifiedSnapshotRepairPatch.js','src/v143HomeTruthPatch.js','src/v146ProcessingReadinessPatch.js','src/unifiedImportStore.js',
    'public/v67-resilient-run-guard.js','public/v137-range-trends.js','public/v139-normal-web-runtime.js','public/v64-whpp-total-kpi-integration.js','public/v150-import-fast-path.js'
  ])syntax(file);
});

test('V151 UI still uses the upload-first browser path',()=>{
  const ui=read('public/v150-import-fast-path.js');
  assert.match(ui,/api\/import\/unified-daily-report/);
  assert.match(ui,/已保存，可以继续上传下一份/);
  assert.doesNotMatch(ui,/api\/state\?compact=1/);
  assert.doesNotMatch(ui,/api\/shopee\/state\?compact=1/);
});

test('V151 safety gate hard-bypasses the legacy heavy import handler',()=>{
  const safety=read('src/v102UnifiedImportSafetyGatePatch.js');
  assert.match(safety,/v151-direct-persist-safety-v5/);
  assert.match(safety,/req\.ceQcParsedUnified = parsed/);
  assert.match(safety,/persistUnifiedUploadFast\(parsed, req\.file\.originalname\)/);
  assert.match(safety,/X-CE-QC-Import-Path/);
  assert.match(safety,/V151-DIRECT-SAFE-PERSIST/);
  assert.match(safety,/legacy unified import final handler is intentionally NOT called/);
});

test('V151 persistence omits carryover summary and giant snapshot row duplication',()=>{
  const fast=read('src/v150UnifiedImportFastRoutePatch.js');
  assert.match(fast,/v151-direct-safe-persist-v2/);
  assert.match(fast,/export function persistUnifiedUploadFast/);
  assert.match(fast,/carryoverDeferred:true/);
  assert.match(fast,/ROWS_NORMALIZED_IN_TABLES_V151/);
  const start=fast.indexOf('export function persistUnifiedUploadFast');
  const end=fast.indexOf('function clearTransientRunState',start);
  const block=fast.slice(start,end);
  assert.doesNotMatch(block,/carryoverSummary/);
  assert.doesNotMatch(block,/getUnifiedProcessingQueue/);
  assert.doesNotMatch(block,/payload\s*=\s*\{[^}]*rows\s*:/s);
});

test('V151 duplicate re-upload returns from indexed import tables without carryover scan',()=>{
  const fast=read('src/v150UnifiedImportFastRoutePatch.js');
  assert.match(fast,/function fastHydrateExisting/);
  const start=fast.indexOf('function fastHydrateExisting');
  const end=fast.indexOf('export function persistUnifiedUploadFast',start);
  const block=fast.slice(start,end);
  assert.doesNotMatch(block,/carryoverSummary/);
  assert.match(block,/unified_import_rows/);
});

test('V151 heavy carry hydration happens only when processing actually starts',()=>{
  const fast=read('src/v150UnifiedImportFastRoutePatch.js');
  assert.match(fast,/const queue=getUnifiedProcessingQueue\(batch\.batchId\)/);
  assert.match(fast,/START_ROUTES=new Set\(\['\/api\/run\/start','\/api\/shopee\/run\/start'\]\)/);
  assert.match(fast,/await hydrateReportState\(requested\)/);
});

test('homepage truth remains event-driven and never background polls SQL',()=>{
  const ui=read('public/v64-whpp-total-kpi-integration.js');
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

test('database schema is not bumped by V151 upload repairs',()=>{
  const migrations=read('src/migrations.js');
  assert.match(migrations,/const SCHEMA_VERSION = 18/);
});
