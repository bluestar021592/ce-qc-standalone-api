import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const result=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(result.status,0,`${p}: ${result.stderr||result.stdout}`);};

test('V152 upload critical JavaScript is syntax valid',()=>{
  for(const file of ['src/v102UnifiedImportSafetyGatePatch.js','src/v150UnifiedImportFastRoutePatch.js','public/v150-import-fast-path.js'])syntax(file);
});

test('V152 browser upload returns after persistence without dashboard waits',()=>{
  const ui=read('public/v150-import-fast-path.js');
  assert.match(ui,/api\/import\/unified-daily-report/);
  assert.match(ui,/已保存，可以继续上传下一份/);
  assert.doesNotMatch(ui,/api\/state\?compact=1/);
  assert.doesNotMatch(ui,/api\/shopee\/state\?compact=1/);
});

test('V152 safety gate directly persists and never invokes the legacy heavy import final handler',()=>{
  const safety=read('src/v102UnifiedImportSafetyGatePatch.js');
  assert.match(safety,/v151-direct-persist-safety-v5/);
  assert.match(safety,/req\.ceQcParsedUnified = parsed/);
  assert.match(safety,/persistUnifiedUploadFast\(parsed, req\.file\.originalname\)/);
  assert.match(safety,/X-CE-QC-Import-Path/);
  assert.match(safety,/V151-DIRECT-SAFE-PERSIST/);
  assert.match(safety,/legacy unified import final handler is intentionally NOT called/);
});

test('V152 upload persistence excludes full carry queue and carry summary',()=>{
  const fast=read('src/v150UnifiedImportFastRoutePatch.js');
  assert.match(fast,/export function persistUnifiedUploadFast/);
  assert.match(fast,/ROWS_NORMALIZED_IN_TABLES_V151/);
  const start=fast.indexOf('export function persistUnifiedUploadFast');
  const end=fast.indexOf('function clearTransientRunState',start);
  assert.ok(start>=0&&end>start,'persist block not found');
  const block=fast.slice(start,end);
  assert.doesNotMatch(block,/getUnifiedProcessingQueue/);
  assert.doesNotMatch(block,/carryoverSummary/);
});

test('V152 historical carry hydration is deferred until process start',()=>{
  const fast=read('src/v150UnifiedImportFastRoutePatch.js');
  assert.match(fast,/getUnifiedProcessingQueue\(batch\.batchId\)/);
  assert.match(fast,/START_ROUTES=new Set\(\['\/api\/run\/start','\/api\/shopee\/run\/start'\]\)/);
  assert.match(fast,/await hydrateReportState\(requested\)/);
});

test('V152 managed launcher is fail closed after candidate validation',()=>{
  const launcher=read('tools/CE_QC_Managed_Launcher.ps1');
  assert.match(launcher,/FAIL_CLOSED_CANDIDATE_GATE_V152/);
  assert.match(launcher,/\$candidateResult\s*=\s*@\(Test-RemoteCandidate \$remote \$current\)/);
  assert.match(launcher,/\$candidateAccepted\s*=\s*\(\$candidateResult\.Count -eq 1 -and \$candidateResult\[0\] -eq \$true\)/);
  assert.match(launcher,/if \(-not \$candidateAccepted\) \{[\s\S]*?return[\s\S]*?\}/);
});

test('V152 keeps database schema unchanged',()=>{
  assert.match(read('src/migrations.js'),/const SCHEMA_VERSION = 18/);
});
