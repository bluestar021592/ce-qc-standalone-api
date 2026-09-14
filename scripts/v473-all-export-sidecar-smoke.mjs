import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read=relative=>fs.readFileSync(new URL(relative,import.meta.url),'utf8');
for(const file of ['../src/v473ExportSidecar.js','../src/v473AllBusinessExportWorker.js','../public/v473-all-export-sidecar-ui.js','../public/v194-export-token-ui.js','../src/v193ExportSidecar.js','../src/v505ExportAdmissionGuard.js']){
  const result=spawnSync(process.execPath,['--check',fileURLToPath(new URL(file,import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,0,`${file} syntax check failed: ${result.stderr||result.stdout}`);
}
const sidecar=read('../src/v473ExportSidecar.js');
const worker=read('../src/v473AllBusinessExportWorker.js');
const ui=read('../public/v473-all-export-sidecar-ui.js');
const shim=read('../src/v193ExportSidecar.js');
const admission=read('../src/v505ExportAdmissionGuard.js');
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

assert.match(worker,/2026-09-13-v512-v473-whpp-source-membership-gate-v1/);
assert.match(worker,/auditSevenBusinessHistory/);
assert.match(worker,/assertWhppSourceMembershipRange/,'V473 ALL export must enforce exact WHPP source membership before workbook generation');
assert.match(worker,/if\(!audit\?\.exportReady\)/);
assert.match(worker,/SEVEN_BUSINESS_HISTORY_INCOMPLETE/);
assert.match(worker,/historyPreflight:'PASSED'/);
assert.match(worker,/workerPid:process\.pid/,'ALL export must publish a live worker PID before the potentially long history audit');
assert.match(worker,/heartbeatAt:new Date\(\)\.toISOString\(\)/);
const pidPublishAt=worker.indexOf('workerPid:process.pid');
const auditAt=worker.indexOf('try{audit=auditSevenBusinessHistory');
const membershipAt=worker.indexOf('assertWhppSourceMembershipRange({fromDate:range.from,toDate:range.to})');
const legacyWorkerAt=worker.indexOf("await import('./v84ExportJobWorker.js')");
assert.ok(pidPublishAt>=0&&auditAt>pidPublishAt,'V473 ALL worker must publish workerPid before the actual history audit call');
assert.ok(auditAt>=0&&membershipAt>auditAt&&legacyWorkerAt>membershipAt,'V473 ALL worker must pass history audit and V512 WHPP membership guard before workbook generation begins');

assert.match(ui,/2026-09-08-v473-all-export-sidecar-ui-v2/);
assert.match(ui,/http:\/\/\$\{location\.hostname\}:5178/);
assert.match(ui,/\/api\/v473\/export-ping/);
assert.match(ui,/\/api\/v473\/export-period\/prepare/);
assert.match(ui,/V473导出创建接口/);
assert.doesNotMatch(ui,/\/api\/export-period\/prepare/,'V473 UI must never create export jobs on 5177');
assert.match(ui,/dataset\.ceQcExportOwner='v193'/,'V473 button must remain compatible with the earlier V193 DOM guard');
assert.match(ui,/error\.jobTerminal=true/,'terminal worker failures must surface immediately instead of entering network-retry loop');
assert.match(ui,/global\.exportPeriodReport=exportCompat/,'legacy exportPeriodReport callers must hand off to V473');
assert.match(ui,/global\.resumeActiveExportJob=resume/,'legacy resume callers must hand off to V473');
assert.match(ui,/exportProgressV194/,'V473 must recover an existing V194 progress DOM when present');

assert.match(boot,/\.\/src\/v193ExportSidecar\.js/,'historical bootstrap filename stays stable');
const admissionAt=shim.indexOf("import './v505ExportAdmissionGuard.js'");
const v473At=shim.indexOf("import './v473ExportSidecar.js'");
assert.ok(admissionAt>=0&&v473At>admissionAt,'legacy sidecar entry must install V505 export/purge admission before starting the single V473 authority');
assert.doesNotMatch(shim,/app\.listen|express from/,'legacy sidecar entry must not start a second server');
assert.match(admission,/v505PurgeWriteFreezeGuard,v505ExportAdmissionGuard,\.\.\.handlers/,'5178 export creation must pass purge freeze and admission handshake before V473 handlers');
assert.match(admission,/const afterAcquire=inspectPurgeWriteFreezeState\(\)/,'cross-process race must be double-checked after export admission lock acquisition');
assert.match(tokenUi,/v473-all-export-sidecar-ui\.js\?v=20260908-v473-2/,'existing token UI slot must hand ownership to final cache-busted V473 UI');
assert.doesNotMatch(tokenUi,/v473-all-export-sidecar-ui\.js\?v=20260908-v473-1/,'retired V473 UI cache key must not remain active');
const v84At=shell.indexOf('v84-async-export-ui.js?v=20260818-v193-1');
const tokenAt=shell.indexOf('v194-export-token-ui.js?v=20260818-v195-1');
assert.ok(v84At>=0&&tokenAt>v84At,'V473 loader slot must remain after V84 compatibility UI so its cloned button becomes authoritative');

console.log('[V473] isolated ALL+single export sidecar smoke passed · V505 export/purge admission is serialized · ALL worker PID is published before long preflight · V512 exact WHPP membership is enforced before workbook generation · terminal failures surface · legacy export globals preserved');
