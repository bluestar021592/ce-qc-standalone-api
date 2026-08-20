import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const storeUrl = new URL('../src/v87WhppExportStore.js', import.meta.url);
const workerUrl = new URL('../src/v84ExportJobWorker.js', import.meta.url);
const businessUrl = new URL('../src/v84ExportBusinessWorker.js', import.meta.url);
const uiUrl = new URL('../public/v84-async-export-ui.js', import.meta.url);
const store = fs.readFileSync(storeUrl, 'utf8');
const worker = fs.readFileSync(workerUrl, 'utf8');
const business = fs.readFileSync(businessUrl, 'utf8');
const ui = fs.readFileSync(uiUrl, 'utf8');

test('V87 WHPP export reader and current workers are syntax valid', () => {
  for (const url of [storeUrl, workerUrl, businessUrl, uiUrl]) {
    const check = spawnSync(process.execPath, ['--check', fileURLToPath(url)], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr || check.stdout);
  }
});

test('WHPP export reads current normalized final rows instead of historical payload blobs', () => {
  assert.match(store, /business_final_rows f/);
  assert.match(store, /business_daily_parse_rows p/);
  assert.match(store, /business_export_snapshots s/);
  assert.match(store, /s\.businessType='WHPP'/);
  assert.match(store, /f\.businessType='WHPP'/);
  assert.match(store, /listCompletedWhppSnapshots/);
  assert.match(store, /whppDailyCounts/);
  assert.doesNotMatch(store, /business_export_snapshots[^\n]*payloadJson/i);
  assert.doesNotMatch(store, /DELETE FROM|UPDATE |INSERT INTO|DROP TABLE/i);
});

test('ALL background export includes WHPP as the seventh business in the one-complete-workbook plan', () => {
  assert.match(worker, /ALL_TYPES=Object\.freeze\(\['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'\]\)/);
  assert.match(worker, /countCompletedWhppRows\(range\.from,range\.to\)/);
  assert.match(worker, /whppDailyCounts\(range\.from,range\.to\)/);
  assert.match(worker, /ONE_WORKBOOK_PER_BUSINESS/);
  assert.match(worker, /7业务/);
  assert.doesNotMatch(worker, /splitRange\(/);
});

test('isolated business worker accepts WHPP and delegates complete workbook truth to V200 exporter', () => {
  assert.match(business, /createV200ReferenceDashboardWorkbook/);
  assert.match(business, /new Set\(\['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'\]\)/);
  assert.match(business, /if\(partCount>1\|\|partIndex!==1\)/);
  assert.match(business, /realDeliveryCycleTruth:true/);
  assert.match(business, /terminalTruth:true/);
});

test('report selector exposes CEAF and WHPP explicitly and defaults ALL to seven complete business workbooks', () => {
  assert.match(ui, /\['ALL', '管理汇总 \+ 7业务（每业务1个完整Excel）'\]/);
  assert.match(ui, /\['CEAF', '仅CEAF空运完整表'\]/);
  assert.match(ui, /\['WHPP', '仅WHPP本土完整表'\]/);
  assert.match(ui, /ensureBusinessOptions\(\)/);
});
