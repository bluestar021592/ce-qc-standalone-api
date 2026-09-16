import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const sourceFile = path.join(root, 'src', 'v294PostProcessAttemptBackfillPatch.js');

function source() {
  return fs.readFileSync(sourceFile, 'utf8');
}

test('V550 history guard source remains syntax-valid', () => {
  const check = spawnSync(process.execPath, ['--check', sourceFile], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
});

test('V550 removes startup-time history materialization from the 5177 process', () => {
  const text = source();
  assert.match(text, /2026-09-16-v550-no-startup-history-one-shot-v1/);
  assert.match(text, /\[CE-QC\]\[V550_STARTUP_HISTORY_GUARD\]/);
  assert.doesNotMatch(text, /FINAL_HISTORY_STARTUP_ONE_SHOT/);
  assert.equal((text.match(/latestUnifiedReportDate\(\)/g) || []).length, 1, 'latest report lookup must remain a definition only and never run at startup');
  assert.doesNotMatch(text, /setTimeout\(\(\)=>\{const date=latestUnifiedReportDate\(\)/);
});

test('V550 keeps final history materialization event-driven after processing completes', () => {
  const text = source();
  assert.match(text, /globalThis\.__CE_QC_FINALIZE_PERSISTED_DASHBOARD_HISTORY__=materializeV294CompletedUnifiedHistory/);
  assert.match(text, /if\(scopes\.family==='SHOPEE'&&sevenBusinessTerminal\(date\)\)finalization=materializeV294CompletedUnifiedHistory\(date\)/);
  assert.match(text, /schedulePersistedHistoryBuild\(date\)/);
  assert.match(text, /ROUTES=new Set\(\['\/api\/import\/unified-daily-report','\/api\/run','\/api\/run\/start'/);
});
