import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const files = {
  patch: new URL('../src/v84AsyncExportPatch.js', import.meta.url),
  job: new URL('../src/v84ExportJobWorker.js', import.meta.url),
  business: new URL('../src/v84ExportBusinessWorker.js', import.meta.url),
  ui: new URL('../public/v84-async-export-ui.js', import.meta.url),
  bootstrap: new URL('../bootstrap.js', import.meta.url),
  injector: new URL('../src/v44WhppUiPatch.js', import.meta.url)
};
const read = key => fs.readFileSync(files[key], 'utf8');

test('V84/V193/V202 export runtime is syntax valid', () => {
  for (const key of ['patch', 'job', 'business', 'ui']) {
    const check = spawnSync(process.execPath, ['--check', fileURLToPath(files[key])], { encoding: 'utf8' });
    assert.equal(check.status, 0, `${key}: ${check.stderr || check.stdout}`);
  }
});

test('period export prepare is detached, reusable and never blocks on Excel generation', () => {
  const source = read('patch');
  assert.match(source, /PREPARE_PATH = '\/api\/export-period\/prepare'/);
  assert.match(source, /STATUS_PATH = '\/api\/v84\/export-job\/:jobId'/);
  assert.match(source, /spawn\(process\.execPath/);
  assert.match(source, /detached: true/);
  assert.match(source, /res\.status\(202\)\.json/);
  assert.match(source, /function payloadKey\(payload\)/);
  assert.match(source, /function reusableJob\(key, requester/);
  assert.match(source, /reused: 'ACTIVE'/);
  assert.match(source, /reused: 'COMPLETED'/);
  assert.doesNotMatch(source, /exportPeriodReports/);
  assert.doesNotMatch(source, /DELETE FROM|DROP TABLE|reimport/i);
});

test('ALL export owns seven businesses and creates one complete workbook per business with bounded child processes', () => {
  const source = read('job');
  assert.match(source, /ALL_TYPES=Object\.freeze\(\['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'\]\)/);
  assert.match(source, /ONE_WORKBOOK_PER_BUSINESS/);
  assert.match(source, /spawn\(process\.execPath/);
  assert.match(source, /max-old-space-size/);
  assert.match(source, /createManagementSummary/);
  assert.match(source, /每个业务仅1个完整Excel/);
  assert.match(source, /archiver\('zip'/);
  assert.doesNotMatch(source, /splitRange\(/);
  assert.doesNotMatch(source, /unified_snapshots\.payloadJson/);
  assert.doesNotMatch(source, /DELETE FROM|DROP TABLE|UPDATE unified_import/i);
});

test('isolated business child delegates to the V200 reference workbook and forbids date-part splitting', () => {
  const source = read('business');
  assert.match(source, /createV200ReferenceDashboardWorkbook/);
  assert.match(source, /new Set\(\['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'\]\)/);
  assert.match(source, /if\(partCount>1\|\|partIndex!==1\)throw new Error/);
  assert.match(source, /每个业务必须一次生成一份完整Excel/);
  assert.match(source, /realDeliveryCycleTruth:true/);
  assert.match(source, /terminalTruth:true/);
});

test('V193 browser export UI exposes all seven businesses, persists jobs and polls background status', () => {
  const source = read('ui');
  assert.match(source, /ACTIVE_JOB_KEY = 'ce_qc_active_export_job_v193'/);
  assert.match(source, /管理汇总 \+ 7业务（每业务1个完整Excel）/);
  assert.match(source, /\['CEAF', '仅CEAF空运完整表'\]/);
  assert.match(source, /\['WHPP', '仅WHPP本土完整表'\]/);
  assert.match(source, /saveActiveJob/);
  assert.match(source, /loadActiveJob/);
  assert.match(source, /resumeActiveJob/);
  assert.match(source, /导出状态接口/);
  assert.match(read('bootstrap'), /v84AsyncExportPatch/);
  assert.match(read('injector'), /v84-async-export-ui\.js\?v=20260818-v193-1/);
});
