import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const unifiedStore = fs.readFileSync(new URL('../src/unifiedImportStore.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('unified history exposes only latest VALID import batch for each report date', () => {
  assert.match(unifiedStore, /WHERE b\.status='VALID'/);
  assert.doesNotMatch(unifiedStore, /CASE s\.status WHEN 'COMPLETED' THEN 0 WHEN 'IMPORTED' THEN 1 ELSE 2 END/);
});

test('current selected date prefers exact newest unified import snapshot over older same-date history', () => {
  assert.match(app, /unifiedImportState\?\.reportDate === historyModeDate/);
  assert.match(app, /\? unifiedImportState\s*:\s*\(historyCatalog\.UNIFIED/);
});

test('CE TBKH ALI1688 cards preserve imported business ticket count before processing', () => {
  assert.match(app, /sourceState\.pnhBills\?\.length \|\| sourceState\.dailyParseSummary\?\.totalRecognized \|\| sourceState\.dailyParseRows\?\.length/);
  assert.match(app, /dashboard\.pnh \|\| dashboard\.totalMonitored \|\| importedTotal/);
});

test('SHOPEE CN VN cards preserve imported business ticket count before processing', () => {
  assert.match(app, /state\.pnhBills\?\.length \|\| state\.dailyParseSummary\?\.totalRecognized \|\| state\.dailyParseRows\?\.length/);
  assert.match(app, /if \(!Number\(metrics\.total \|\| 0\) && importedTotal\) metrics\.total = importedTotal/);
});
