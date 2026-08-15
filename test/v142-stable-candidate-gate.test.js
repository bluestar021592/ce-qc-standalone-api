import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const result=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(result.status,0,`${p}: ${result.stderr||result.stdout}`);};

test('V153 upload queue critical JavaScript is syntax valid',()=>{
  for(const file of ['src/v102UnifiedImportSafetyGatePatch.js','src/v150UnifiedImportFastRoutePatch.js','src/v153UnifiedImportQueue.js','src/v153UnifiedImportWorker.js','src/unifiedImportSafety.js','public/v150-import-fast-path.js'])syntax(file);
});

test('V153 HTTP upload ingress is queue-only and never parses or opens SQLite',()=>{
  const ingress=read('src/v102UnifiedImportSafetyGatePatch.js');
  assert.match(ingress,/V153-DURABLE-WORKER-QUEUE/);
  assert.match(ingress,/enqueueUnifiedImport/);
  assert.match(ingress,/res\.status\(202\)/);
  assert.doesNotMatch(ingress,/parseUnifiedDailyExcel/);
  assert.doesNotMatch(ingress,/persistUnifiedUploadFast/);
  assert.doesNotMatch(ingress,/getDb\(/);
});

test('V153 browser releases immediately after queue acceptance',()=>{
  const ui=read('public/v150-import-fast-path.js');
  assert.match(ui,/DURABLE_WORKER_QUEUE_NONBLOCKING/);
  assert.match(ui,/已进入后台导入队列/);
  assert.match(ui,/可以直接继续上传下一份日报/);
  assert.doesNotMatch(ui,/api\/state\?compact=1/);
  assert.doesNotMatch(ui,/api\/shopee\/state\?compact=1/);
});

test('V153 durable queue serializes worker jobs and survives restart',()=>{
  const queue=read('src/v153UnifiedImportQueue.js');
  assert.match(queue,/new Worker\(/);
  assert.match(queue,/let activeJobId=''/);
  assert.match(queue,/RECOVERED_AFTER_RESTART/);
  assert.match(queue,/unified_queue/);
  assert.match(queue,/setImmediate\(pump\)/);
});

test('V153 worker owns parse safety and persistence off the HTTP thread',()=>{
  const worker=read('src/v153UnifiedImportWorker.js');
  assert.match(worker,/parseUnifiedDailyExcel/);
  assert.match(worker,/assertUnifiedImportSafety/);
  assert.match(worker,/persistUnifiedUploadFast/);
  assert.match(worker,/parentPort\?\.postMessage\(\{type:'done'/);
});

test('V153 persistence is staging-only and duplicate hydration is metadata-only',()=>{
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

test('V153 processing materialization remains deferred until run start',()=>{
  const fast=read('src/v150UnifiedImportFastRoutePatch.js');
  assert.match(fast,/function materializeProcessingMembership/);
  assert.match(fast,/getUnifiedProcessingQueue\(batch\.batchId\)/);
  assert.match(fast,/START_ROUTES=new Set\(\['\/api\/run\/start','\/api\/shopee\/run\/start'\]\)/);
});

test('V153 managed launcher remains fail closed after candidate validation',()=>{
  const launcher=read('tools/CE_QC_Managed_Launcher.ps1');
  assert.match(launcher,/FAIL_CLOSED_CANDIDATE_GATE_V152/);
  assert.match(launcher,/\$candidateResult\s*=\s*@\(Test-RemoteCandidate \$remote \$current\)/);
  assert.match(launcher,/\$candidateAccepted\s*=\s*\(\$candidateResult\.Count -eq 1 -and \$candidateResult\[0\] -eq \$true\)/);
});

test('V153 keeps database schema unchanged',()=>{
  assert.match(read('src/migrations.js'),/const SCHEMA_VERSION = 18/);
});
