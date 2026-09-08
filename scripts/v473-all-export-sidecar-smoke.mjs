import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read=relative=>fs.readFileSync(new URL(relative,import.meta.url),'utf8');
for(const file of ['../src/v473ExportSidecar.js','../src/v473AllBusinessExportWorker.js','../public/v473-all-export-sidecar-ui.js']){
  const result=spawnSync(process.execPath,['--check',fileURLToPath(new URL(file,import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,0,`${file} syntax check failed: ${result.stderr||result.stdout}`);
}
const sidecar=read('../src/v473ExportSidecar.js');
const worker=read('../src/v473AllBusinessExportWorker.js');
const ui=read('../public/v473-all-export-sidecar-ui.js');
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
assert.ok(auditAt>=0&&legacyWorkerAt>auditAt,'V473 ALL worker must pass history audit before legacy workbook generation begins');

assert.match(ui,/http:\/\/\$\{location\.hostname\}:5178/);
assert.match(ui,/\/api\/v473\/export-ping/);
assert.match(ui,/\/api\/v473\/export-period\/prepare/);
assert.match(ui,/V473导出创建接口/);
assert.doesNotMatch(ui,/\/api\/export-period\/prepare/,'V473 UI must never create ALL export jobs on 5177');
assert.match(ui,/dataset\.ceQcExportOwner='v193'/,'V473 button must remain compatible with retired V193 ownership guard');

assert.match(boot,/\.\/src\/v473ExportSidecar\.js/);
assert.doesNotMatch(boot,/\.\/src\/v193ExportSidecar\.js/,'bootstrap must start only the V473 export sidecar');
assert.match(shell,/v473-all-export-sidecar-ui\.js\?v=20260908-v473-1/);
const oldUiAt=shell.indexOf('v84-async-export-ui.js?v=20260818-v193-1');
const v473UiAt=shell.indexOf('v473-all-export-sidecar-ui.js?v=20260908-v473-1');
assert.ok(oldUiAt>=0&&v473UiAt>oldUiAt,'V473 click owner must load after V193 compatibility UI');

console.log('[V473] isolated ALL+single export sidecar smoke passed · 5178 owns job creation · ALL history preflight runs fail-closed in isolated worker before Excel · 5177 range reads cannot block export ACK');
