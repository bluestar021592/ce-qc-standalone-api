import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runner = fs.readFileSync(new URL('../public/v67-resilient-run-guard.js', import.meta.url), 'utf8');
const uiPatch = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');

test('V148 daily runner starts current-day processing directly without large state preflight', () => {
  assert.match(runner, /2026-08-16-v148-direct-daily-runner-v1/);
  assert.doesNotMatch(runner, /async function readStates\s*\(/);
  assert.doesNotMatch(runner, /await readStates\s*\(/);
  assert.doesNotMatch(runner, /正在检查七业务状态/);
  assert.match(runner, /正在启动 \$\{target \|\| '当日'\} 七业务处理/);
});

test('V148 directly invokes the three authoritative current-day processing stages', () => {
  assert.match(runner, /start: '\/api\/run', resume: '\/api\/resume'/);
  assert.match(runner, /start: '\/api\/shopee\/run\/start', resume: '\/api\/shopee\/run\/resume'/);
  assert.match(runner, /start: '\/api\/whpp\/run\/start', resume: '\/api\/whpp\/run\/resume'/);
  assert.match(runner, /RUN_ALREADY_COMPLETED/);
  assert.match(runner, /NO_DAILY_REPORT/);
});

test('V148 keeps failures checkpointed and does not mutate or delete historical data', () => {
  assert.match(runner, /失败票已保留到独立重试中心/);
  assert.doesNotMatch(runner, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(runner, /\bDROP\s+TABLE\b/i);
});

test('V148 browser asset is cache-busted by the injected application shell', () => {
  assert.match(uiPatch, /v67-resilient-run-guard\.js\?v=20260816-8/);
  assert.match(uiPatch, /v148-direct-daily-runner-v1/);
});
