import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Candidate sync marker: 2026-08-17-v165-gate-refresh-v1.
// This file is intentionally touched so managed desktop updates cannot retain the
// pre-V165 V148 assertion while installing the current V165 runner.
const runner = fs.readFileSync(new URL('../public/v67-resilient-run-guard.js', import.meta.url), 'utf8');
const uiPatch = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');

test('V165 daily runner starts current-day processing directly without large state preflight', () => {
  assert.match(runner, /2026-08-17-v165-seven-business-stage-verification-v2/);
  assert.doesNotMatch(runner, /async function readStates\s*\(/);
  assert.doesNotMatch(runner, /await readStates\s*\(/);
  assert.doesNotMatch(runner, /正在检查七业务状态/);
  assert.match(runner, /正在启动 \$\{target \|\| '当日'\} 七业务处理/);
});

test('V165 directly invokes all three authoritative stages with the same reportDate', () => {
  assert.match(runner, /start: '\/api\/run', resume: '\/api\/resume'/);
  assert.match(runner, /start: '\/api\/shopee\/run\/start', resume: '\/api\/shopee\/run\/resume'/);
  assert.match(runner, /start: '\/api\/whpp\/run\/start', resume: '\/api\/whpp\/run\/resume'/);
  assert.match(runner, /JSON\.stringify\(\{ reportDate: target \|\| '' \}\)/);
  assert.match(runner, /verifyWhpp\(target\)/);
});

test('V165 never treats missing or already-active WHPP as completed without verification', () => {
  assert.match(runner, /WHPP_REPORT_MISSING/);
  assert.match(runner, /WHPP_RUN_ALREADY_ACTIVE/);
  assert.match(runner, /WHPP_STAGE_NOT_FINALIZED/);
  assert.match(runner, /七业务未全部完成/);
  assert.doesNotMatch(runner, /if \(alreadyDone\(error\) \|\| noReport\(error\)\)/);
  assert.doesNotMatch(runner, /\['RUN_ALREADY_COMPLETED','WHPP_RUN_ALREADY_ACTIVE'\]/);
});

test('V165 keeps failures checkpointed and does not mutate or delete historical data', () => {
  assert.match(runner, /已完成断点保留/);
  assert.doesNotMatch(runner, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(runner, /\bDROP\s+TABLE\b/i);
});

test('browser asset remains cache-busted by the injected application shell', () => {
  assert.match(uiPatch, /v67-resilient-run-guard\.js\?v=20260816-8/);
  assert.match(uiPatch, /v148-direct-daily-runner-v1|v165-seven-business-stage-verification/);
});
