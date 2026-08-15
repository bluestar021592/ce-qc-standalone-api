import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const result=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(result.status,0,`${p}: ${result.stderr||result.stdout}`);};

test('V156 import runtime JavaScript is syntax valid',()=>{
  for(const file of ['src/v156SessionHotPathPatch.js','src/v102UnifiedImportSafetyGatePatch.js','src/v150UnifiedImportFastRoutePatch.js','src/v153UnifiedImportQueue.js','src/v153UnifiedImportWorker.js','src/unifiedImportSafety.js','src/v153RuntimeBuildPatch.js','public/v150-import-fast-path.js','public/v153-build-sync.js'])syntax(file);
});

test('V156 validated sessions are cached off the SQLite hot path',()=>{
  const hot=read('src/v156SessionHotPathPatch.js');
  const ingress=read('src/v102UnifiedImportSafetyGatePatch.js');
  assert.match(ingress,/import '\.\/v156SessionHotPathPatch\.js'/);
  assert.match(hot,/handler\.name!=='accessIdentity'/);
  assert.match(hot,/ce_internal_session/);
  assert.match(hot,/X-CE-QC-Session-Cache/);
  assert.match(hot,/cacheExpiresAt/);
  assert.doesNotMatch(hot,/getDb\(/);
  assert.doesNotMatch(hot,/from '\.\/db\.js'/);
});

test('V156 unified HTTP ingress hard replaces legacy route multer',()=>{
  const ingress=read('src/v102UnifiedImportSafetyGatePatch.js');
  assert.match(ingress,/V156-LOCALAPPDATA-ZERO-DB-DISK/);
  assert.match(ingress,/fastSpoolDir/);
  assert.match(ingress,/LOCALAPPDATA/);
  assert.match(ingress,/fastUnifiedUpload\.single\('file'\),queuedHandler/);
  assert.match(ingress,/do not forward any legacy route-level upload middleware/i);
  assert.match(ingress,/res\.status\(202\)/);
  assert.doesNotMatch(ingress,/parseUnifiedDailyExcel/);
  assert.doesNotMatch(ingress,/persistUnifiedUploadFast/);
  assert.doesNotMatch(ingress,/getDb\(/);
});

test('V156 queue metadata is localappdata only and imports no db runtime',()=>{
  const queue=read('src/v153UnifiedImportQueue.js');
  assert.match(queue,/LOCALAPPDATA/);
  assert.match(queue,/upload_spool/);
  assert.match(queue,/queueDir=path\.join\(spoolRoot,'jobs'\)/);
  assert.match(queue,/LOCALAPPDATA_ZERO_DB_DISK/);
  assert.doesNotMatch(queue,/getRuntimeConfig/);
  assert.doesNotMatch(queue,/from '\.\/db\.js'/);
  assert.doesNotMatch(queue,/copyFile/);
  assert.doesNotMatch(queue,/moveFile/);
  assert.match(queue,/new Worker\(/);
  assert.match(queue,/RECOVERED_AFTER_RESTART/);
});

test('V156 worker publishes auto classification before SQLite persistence',()=>{
  const worker=read('src/v153UnifiedImportWorker.js');
  assert.match(worker,/classificationPreview/);
  assert.match(worker,/type:'classified'/);
  assert.match(worker,/CLASSIFY_FIRST_PERSIST_BACKGROUND_V155/);
  assert.ok(worker.indexOf("type:'classified'")<worker.indexOf("phase:'PERSISTING'"),'classification preview must be published before persistence');
  assert.match(worker,/persistWithRetry/);
  assert.match(worker,/SQLITE_BUSY/);
  assert.match(worker,/SQLITE_LOCKED/);
  assert.match(worker,/attempt<=8/);
});

test('V156 queue persists classification preview for the browser',()=>{
  const queue=read('src/v153UnifiedImportQueue.js');
  assert.match(queue,/message\?\.type==='classified'/);
  assert.match(queue,/phase:'CLASSIFIED'/);
  assert.match(queue,/preview/);
  assert.match(queue,/classifiedAt/);
});

test('V156 browser restores upload recognize auto-classify experience',()=>{
  const ui=read('public/v150-import-fast-path.js');
  assert.match(ui,/LOCAL_FAST_SPOOL_CLASSIFY_FIRST_BACKGROUND_PERSIST_V155/);
  assert.match(ui,/识别完成，已自动分类/);
  assert.match(ui,/正在自动识别并分类/);
  assert.match(ui,/bindState\(item\.job\.preview\)/);
  assert.match(ui,/ce-qc-unified-import-classified/);
  assert.match(ui,/页面已释放，可以继续选择下一份日报/);
  assert.doesNotMatch(ui,/api\/state\?compact=1/);
  assert.doesNotMatch(ui,/api\/shopee\/state\?compact=1/);
});

test('V156 queue status APIs expose jobs without local filesystem paths',()=>{
  const runtime=read('src/v153RuntimeBuildPatch.js');
  assert.match(runtime,/api\/import\/unified-queue/);
  assert.match(runtime,/getUnifiedImportJob/);
  assert.match(runtime,/getUnifiedImportQueueSummary/);
});

test('V156 persistence is staging-only and processing materialization stays deferred',()=>{
  const fast=read('src/v150UnifiedImportFastRoutePatch.js');
  assert.match(fast,/UPLOAD_STAGING_ONLY_V152/);
  const persistStart=fast.indexOf('export function persistUnifiedUploadFast');
  const persistEnd=fast.indexOf('function clearTransientRunState',persistStart);
  const persist=fast.slice(persistStart,persistEnd);
  assert.doesNotMatch(persist,/shipment_current_state/);
  assert.doesNotMatch(persist,/carryover_open_items/);
  assert.doesNotMatch(persist,/shipment_daily_snapshots/);
  assert.match(fast,/function materializeProcessingMembership/);
  assert.match(fast,/getUnifiedProcessingQueue\(batch\.batchId\)/);
  assert.match(fast,/START_ROUTES=new Set\(\['\/api\/run\/start','\/api\/shopee\/run\/start'\]\)/);
});

test('V156 import runtime is no-store and build-sync protected',()=>{
  const cache=read('src/v89StaticAssetCachePatch.js');
  const html=read('src/v44WhppUiPatch.js');
  const sync=read('public/v153-build-sync.js');
  const runtime=read('src/v153RuntimeBuildPatch.js');
  assert.match(cache,/v150-import-fast-path\|v153-build-sync/);
  assert.match(cache,/no-store, max-age=0/);
  assert.match(html,/__CE_QC_UI_BUILD_ID__/);
  assert.match(html,/v153-build-sync\.js/);
  assert.match(html,/v150-import-fast-path\.js\?v=20260815-8/);
  assert.match(html,/v156-zero-db-disk-upload/);
  assert.match(sync,/api\/runtime-build/);
  assert.match(sync,/location\.reload\(\)/);
  assert.match(runtime,/api\/runtime-build/);
});

test('V156 managed launcher remains fail closed after candidate validation',()=>{
  const launcher=read('tools/CE_QC_Managed_Launcher.ps1');
  assert.match(launcher,/FAIL_CLOSED_CANDIDATE_GATE_V152/);
  assert.match(launcher,/\$candidateResult\s*=\s*@\(Test-RemoteCandidate \$remote \$current\)/);
  assert.match(launcher,/\$candidateAccepted\s*=\s*\(\$candidateResult\.Count -eq 1 -and \$candidateResult\[0\] -eq \$true\)/);
});

test('V156 keeps database schema unchanged',()=>{
  assert.match(read('src/migrations.js'),/const SCHEMA_VERSION = 18/);
});
