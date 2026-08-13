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

test('V84 export runtime is syntax valid', () => {
  for (const key of ['patch', 'job', 'business', 'ui']) {
    const check = spawnSync(process.execPath, ['--check', fileURLToPath(files[key])], { encoding: 'utf8' });
    assert.equal(check.status, 0, `${key}: ${check.stderr || check.stdout}`);
  }
});

test('period export prepare is replaced by a detached job and never blocks on Excel generation', () => {
  const source = read('patch');
  assert.match(source, /PREPARE_PATH = '\/api\/export-period\/prepare'/);
  assert.match(source, /STATUS_PATH = '\/api\/v84\/export-job\/:jobId'/);
  assert.match(source, /spawn\(process\.execPath/);
  assert.match(source, /detached: true/);
  assert.match(source, /res\.status\(202\)\.json/);
  assert.match(source, /Suppress the legacy synchronous handler/);
  assert.doesNotMatch(source, /exportPeriodReports/);
  assert.doesNotMatch(source, /DELETE FROM|DROP TABLE|reimport/i);
});

test('large all-business export is split and isolated by business/date part', () => {
  const source = read('job');
  assert.match(source, /ALL_TYPES = Object\.freeze\(\['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'\]\)/);
  assert.match(source, /LARGE_BUSINESS_THRESHOLD/);
  assert.match(source, /splitRange\(range\)/);
  assert.match(source, /spawnSync\(process\.execPath/);
  assert.match(source, /max-old-space-size/);
  assert.match(source, /createManagementSummary/);
  assert.match(source, /不重复装载20万票明细/);
  assert.match(source, /archiver\('zip'/);
  assert.doesNotMatch(source, /unified_snapshots\.payloadJson/);
  assert.doesNotMatch(source, /DELETE FROM|DROP TABLE|UPDATE unified_import/i);
});

test('each business part keeps the existing template exporter and normalized SQLite reader', () => {
  const source = read('business');
  assert.match(source, /listLightweightCompletedUnifiedSnapshots/);
  assert.match(source, /createShopeeTemplateWorkbook/);
  assert.match(source, /\['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'\]/);
  assert.doesNotMatch(source, /unified_snapshots\.payloadJson/);
});

test('browser polls background progress instead of waiting on one long request', () => {
  const source = read('ui');
  assert.match(source, /\/api\/export-period\/prepare/);
  assert.match(source, /\/api\/v84\/export-job\//);
  assert.match(source, /await sleep\(1200\)/);
  assert.match(source, /后台导出仍在运行/);
  assert.match(source, /global\.exportPeriodReport = exportPeriodReportV84/);
  assert.match(read('bootstrap'), /v84AsyncExportPatch/);
  assert.match(read('injector'), /v84-async-export-ui\.js\?v=20260813-1/);
});
