import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const result=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(result.status,0,`${p}: ${result.stderr||result.stdout}`);};

test('V154 upload queue critical JavaScript is syntax valid',()=>{
  for(const file of ['src/v102UnifiedImportSafetyGatePatch.js','src/v150UnifiedImportFastRoutePatch.js','src/v153UnifiedImportQueue.js','src/v153UnifiedImportWorker.js','src/unifiedImportSafety.js','src/v153RuntimeBuildPatch.js','public/v150-import-fast-path.js','public/v153-build-sync.js'])syntax(file);
});

test('V154 HTTP upload ingress is queue-only and never parses or opens SQLite',()=>{
  const ingress=read('src/v102UnifiedImportSafetyGatePatch.js');
  assert.match(ingress,/V153-DURABLE-WORKER-QUEUE/);
  assert.match(ingress,/enqueueUnifiedImport/);
  assert.match(ingress,/res\.status\(202\)/);
  assert.doesNotMatch(ingress,/parseUnifiedDailyExcel/);
  assert.doesNotMatch(ingress,/persistUnifiedUploadFast/);
  assert.doesNotMatch(ingress,/getDb\(/);
});

test('V154 browser releases immediately after queue acceptance',()=>{
  const ui=read('public/v150-import-fast-path.js');
  assert.match(ui,/DURABLE_WORKER_QUEUE_NONBLOCKING_WITH_STATUS/);
  assert.match(ui,/已进入后台导入队列/);
  assert.match(ui,/可以直接继续上传下一份日报/);
  assert.doesNotMatch(ui,/api\/state\?compact=1/);
  assert.doesNotMatch(ui,/api\/shopee\/state\?compact=1/);
});

test('V154 durable queue serializes worker jobs and survives restart',()=>{
  const queue=read('src/v153UnifiedImportQueue.js');
  assert.match(queue,/new Worker\(/);
  assert.match(queue,/let activeJobId=''/);
  assert.match(queue,/RECOVERED_AFTER_RESTART/);
  assert.match(queue,/unified_queue/);
  assert.match(queue,/setImmediate\(pump\)/);
});

test('V154 worker owns parse safety persistence and retries sqlite locks',()=>{
  const worker=read('src/v153UnifiedImportWorker.js');
  assert.match(worker,/parseUnifiedDailyExcel/);
  assert.match(worker,/assertUnifiedImportSafety/);
  assert.match(worker,/persistWithRetry/);
  assert.match(worker,/SQLITE_BUSY/);
  assert.match(worker,/SQLITE_LOCKED/);
  assert.match(worker,/WAITING_SQLITE/);
  assert.match(worker,/attempt<=8/);
});

test('V154 queue status APIs expose completion without filesystem paths',()=>{
  const runtime=read('src/v153RuntimeBuildPatch.js');
  assert.match(runtime,/api\/import\/unified-queue/);
  assert.match(runtime,/getUnifiedImportJob/);
  assert.match(runtime,/getUnifiedImportQueueSummary/);
  assert.match(runtime,/const \{queueDir,\.\.\.summary\}/);
});

test('V154 UI polls background jobs and shows completed or failed status',()=>{
  const ui=read('public/v150-import-fast-path.js');
  assert.match(ui,/importQueueStatus/);
  assert.match(ui,/pollQueueJobs/);
  assert.match(ui,/api\/import\/unified-queue/);
  assert.match(ui,/COMPLETED/);
  assert.match(ui,/FAILED/);
  assert.match(ui,/数据库忙，自动重试/);
});

test('V154 persistence is staging-only and duplicate hydration is metadata-only',()=>{
  const fast=read('src/v150UnifiedImportFastRoutePatch.js');
  assert.match(fast,/UPLOAD_STAGING_ONLY_V152/);
  const persistStart=fast.indexOf('export function persistUnifiedUploadFast');
  const persistEnd=fast.indexOf('function clearTransientRunState',persistStart);
  const persist=fast.slice(persistStart,persistEnd);
  assert.doesNotMatch(persist,/shipment_current_state/);
  assert.doesNotMatch(persist,/carryover_open_items/);
  assert.doesNotMatch(persist,/shipment_daily_snapshots/);
  const dupStart=fast.indexOf('function fastHydrateExisting');
  const dupEnd=fast.indexOf('// Upload persistence is intentionally STAGING-ONLY',dupStart);
  const duplicate=fast.slice(dupStart,dupEnd);
  assert.match(duplicate,/unified_snapshots/);
  assert.doesNotMatch(duplicate,/unified_import_rows/);
  assert.doesNotMatch(duplicate,/GROUP BY/);
});

test('V154 processing materialization remains deferred until run start',()=>{
  const fast=read('src/v150UnifiedImportFastRoutePatch.js');
  assert.match(fast,/function materializeProcessingMembership/);
  assert.match(fast,/getUnifiedProcessingQueue\(batch\.batchId\)/);
  assert.match(fast,/START_ROUTES=new Set\(\['\/api\/run\/start','\/api\/shopee\/run\/start'\]\)/);
});

test('V154 import assets are no-store and stale tabs can auto reload',()=>{
  const cache=read('src/v89StaticAssetCachePatch.js');
  const html=read('src/v44WhppUiPatch.js');
  const sync=read('public/v153-build-sync.js');
  const runtime=read('src/v153RuntimeBuildPatch.js');
  assert.match(cache,/v150-import-fast-path\|v153-build-sync/);
  assert.match(cache,/no-store, max-age=0/);
  assert.match(html,/__CE_QC_UI_BUILD_ID__/);
  assert.match(html,/v153-build-sync\.js/);
  assert.match(html,/v150-import-fast-path\.js\?v=20260815-6/);
  assert.match(sync,/api\/runtime-build/);
  assert.match(sync,/location\.reload\(\)/);
  assert.match(runtime,/api\/runtime-build/);
});

test('V154 managed launcher remains fail closed after candidate validation',()=>{
  const launcher=read('tools/CE_QC_Managed_Launcher.ps1');
  assert.match(launcher,/FAIL_CLOSED_CANDIDATE_GATE_V152/);
  assert.match(launcher,/\$candidateResult\s*=\s*@\(Test-RemoteCandidate \$remote \$current\)/);
  assert.match(launcher,/\$candidateAccepted\s*=\s*\(\$candidateResult\.Count -eq 1 -and \$candidateResult\[0\] -eq \$true\)/);
});

test('V154 keeps database schema unchanged',()=>{
  assert.match(read('src/migrations.js'),/const SCHEMA_VERSION = 18/);
});
