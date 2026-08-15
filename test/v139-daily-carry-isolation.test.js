import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const syntax = file => {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
};
const functionBody = (source, name, nextName) => {
  const start = source.indexOf(`function ${name}`);
  const next = source.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0 && next > start, `cannot locate ${name}`);
  return source.slice(start, next);
};

test('V139 daily import no longer hydrates historical carry into automatic runtime states', () => {
  syntax('src/v139DailyCarryIsolationPatch.js');
  const source = read('src/v139DailyCarryIsolationPatch.js');
  assert.match(source, /route === '\/api\/import\/unified-daily-report'/);
  assert.match(source, /state\.carryBills = \[\]/);
  assert.match(source, /state\.priorCarryRows = \[\]/);
  assert.match(source, /historicalCarryInDailyRun: 0/);
  assert.doesNotMatch(source, /getUnifiedProcessingQueue/);
  assert.doesNotMatch(source, /DELETE FROM carryover_open_items/i);
});

test('V139 reuses the workbook parse already validated by V102 instead of parsing the Excel twice', () => {
  syntax('src/v102UnifiedImportSafetyGatePatch.js');
  const gate = read('src/v102UnifiedImportSafetyGatePatch.js');
  const source = read('src/v139DailyCarryIsolationPatch.js');
  assert.match(gate, /req\.ceQcParsedUnified = parsed/);
  assert.match(source, /req\.ceQcParsedUnified \|\| parseUnifiedDailyExcel/);
  assert.match(source, /parseReusedFromSafetyGate/);
});

test('V139 current and resumed daily runs strip carry sources but preserve scan and track checkpoints', () => {
  const source = read('src/v139DailyCarryIsolationPatch.js');
  assert.match(source, /DAILY_RUN_ROUTES/);
  assert.match(source, /SHOPEE_RUN_ROUTES/);
  const ccsl = functionBody(source, 'isolateCcslCarry', 'isolateShopeeCarry');
  const shopee = functionBody(source, 'isolateShopeeCarry', 'listHistoricalCarry');
  for (const body of [ccsl, shopee]) {
    assert.match(body, /carryBills = \[\]/);
    assert.match(body, /priorCarryRows = \[\]/);
    assert.match(body, /nextCarryBills = \[\]/);
    assert.doesNotMatch(body, /scanResults = \[\]/);
    assert.doesNotMatch(body, /trackResults = \[\]/);
    assert.doesNotMatch(body, /trackEvents = \[\]/);
  }
});

test('V139 exposes a separate manual carry queue and bounded 200-ticket recheck action', () => {
  syntax('public/v139-carry-manual-window.js');
  const source = read('src/v139DailyCarryIsolationPatch.js');
  const ui = read('public/v139-carry-manual-window.js');
  assert.match(source, /\/api\/v139\/carryover/);
  assert.match(source, /\/api\/v139\/carryover\/recheck/);
  assert.match(source, /sourceReportDate</);
  assert.match(source, /MANUAL_LIMIT_MAX = 200/);
  assert.match(ui, /跨日遗留独立处理/);
  assert.match(ui, /手动复查下一批200票/);
  assert.match(ui, /不再进入当日日报全自动/);
});

test('V139 retries missing confirm rows and read-only trajectory requests at least three final rounds', () => {
  syntax('src/v70ConfirmQueryResiliencePatch.js');
  const source = read('src/v70ConfirmQueryResiliencePatch.js');
  assert.match(source, /FINAL_RETRY_ROUNDS = Math\.max\(3/);
  assert.match(source, /confirm-query final retry/);
  assert.match(source, /track-query/);
  assert.match(source, /exception-query/);
  assert.match(source, /MAX_BATCH = Math\.max\(10, Math\.min\(100/);
});

test('V139 manual carry UI is injected into the managed HTML build', () => {
  const injector = read('src/v44WhppUiPatch.js');
  assert.match(injector, /v138-ccsl-scan-progress\.js\?v=20260816-2/);
  assert.match(injector, /v139-carry-manual-window\.js\?v=20260816-1/);
});
