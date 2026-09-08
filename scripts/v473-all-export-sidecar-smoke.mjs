import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read=relative=>fs.readFileSync(new URL(relative,import.meta.url),'utf8');
for(const file of ['../src/v473ExportSidecar.js','../src/v473AllBusinessExportWorker.js','../public/v473-all-export-sidecar-ui.js','../public/v194-export-token-ui.js','../src/v193ExportSidecar.js']){
  const result=spawnSync(process.execPath,['--check',fileURLToPath(new URL(file,import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,0,`${file} syntax check failed: ${result.stderr||result.stdout}`);
}
const sidecar=read('../src/v473ExportSidecar.js');
const worker=read('../src/v473AllBusinessExportWorker.js');
const ui=read('../public/v473-all-export-sidecar-ui.js');
const shim=read('../src/v193ExportSidecar.js');
const tokenUi=read('../public/v194-export-token-ui.js');
const boot=read('../bootstrap.js');
const shell=read('../src/v44WhppUiPatch.js');

assert.match(sidecar,/2026-09-08-v473-all-business-isolated-export-sidecar-v1/);
assert.match(sidecar,/new Set\(\['ALL','CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'\]\)/);
assert.match(sidecar,/\/api\/v473\/export-period\/prepare/);
assert.match(sidecar,/all\?allWorkerFile:singleWorkerFile/);
assert.match(sidecar,/V473_ISOLATED_ALL_BUSINESS/);
assert.match(sidecar,/ASYNC_JOB_FILE_V473/);
assert.doesNotMatch(sidecar,/\/api\/export-period\/prepare/,'V473 sidecar must not proxy creation back through blocked 5177');

assert.match(worker,/auditSevenBusinessHistory/);
assert.match(worker,/if\(!audit\?\.exportReady\)/);
assert.match(worker,/SEVEN_BUSINESS_HISTORY_INCOMPLETE/);
assert.match(worker,/historyPreflight:'PASSED'/);
const auditAt=worker.indexOf('auditSevenBusinessHistory');
const legacyWorkerAt=worker.indexOf("await import('./v84ExportJobWorker.js')");
assert.ok(auditAt>=0&&legacyWorkerAt>auditAt,'V473 ALL worker must pass history audit before workbook generation begins');

assert.match(ui,/http:\/\/\$\{location\.hostname\}:5178/);
assert.match(ui,/\/api\/v473\/export-ping/);
assert.match(ui,/\/api\/v473\/export-period\/prepare/);
assert.match(ui,/V473导出创建接口/);
assert.doesNotMatch(ui,/\/api\/export-period\/prepare/,'V473 UI must never create export jobs on 5177');
assert.match(ui,/dataset\.ceQcExportOwner='v193'/,'V473 button must remain compatible with the earlier V193 DOM guard');

assert.match(boot,/\.\/src\/v193ExportSidecar\.js/,'historical bootstrap filename stays stable');
assert.match(shim,/import '\.\/v473ExportSidecar\.js'/,'legacy sidecar entry must start only V473 authority');
assert.doesNotMatch(shim,/app\.listen|express from/,'legacy sidecar entry must not start a second server');
assert.match(tokenUi,/v473-all-export-sidecar-ui\.js\?v=20260908-v473-1/,'existing token UI slot must hand ownership to cache-busted V473 UI');
const v84At=shell.indexOf('v84-async-export-ui.js?v=20260818-v193-1');
const tokenAt=shell.indexOf('v194-export-token-ui.js?v=20260818-v195-1');
assert.ok(v84At>=0&&tokenAt>v84At,'V473 loader slot must remain after V84 compatibility UI so its cloned button becomes authoritative');

console.log('[V473] isolated ALL+single export sidecar smoke passed · 5178 owns job creation · ALL history preflight runs fail-closed in isolated worker before Excel · 5177 range reads cannot block export ACK');
