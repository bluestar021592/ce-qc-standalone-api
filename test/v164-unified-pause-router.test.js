import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const patch = fs.readFileSync(new URL('../public/v164-unified-pause-router.js', import.meta.url), 'utf8');
const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');
const runner = fs.readFileSync(new URL('../public/v67-resilient-run-guard.js', import.meta.url), 'utf8');

test('legacy unified pause was CCSL-only and V164 overrides it with active business routing', () => {
  assert.match(app, /async function pauseUnified\(\) \{ await pauseProcess\(\); \}/);
  assert.match(patch, /\/api\/shopee\/run\/pause/);
  assert.match(patch, /\/api\/pause/);
  assert.match(patch, /shopee\?\.running===true/);
  assert.match(patch, /ccsl\?\.running===true/);
  assert.match(patch, /global\.pauseUnified=pauseUnified/);
});

test('V164 pause router is loaded after the base application scripts', () => {
  assert.match(injector, /v164-unified-pause-router\.js/);
  assert.match(injector, /v164-unified-pause-router-v1/);
});

test('V165 seven-business runner owns the current-day orchestration contract', () => {
  assert.match(runner, /2026-08-17-v165-seven-business-stage-verification-v2/);
  assert.match(runner, /start: '\/api\/run', resume: '\/api\/resume'/);
  assert.match(runner, /start: '\/api\/shopee\/run\/start', resume: '\/api\/shopee\/run\/resume'/);
  assert.match(runner, /start: '\/api\/whpp\/run\/start', resume: '\/api\/whpp\/run\/resume'/);
  assert.match(runner, /verifyWhpp\(target\)/);
  assert.match(runner, /WHPP_STAGE_NOT_FINALIZED/);
  assert.match(runner, /七业务未全部完成/);
});

test('V165 runner has no retired V148 contract or heavyweight state preflight', () => {
  assert.doesNotMatch(runner, /v148-direct-daily-runner-v1/);
  assert.doesNotMatch(runner, /async function readStates\s*\(/);
  assert.doesNotMatch(runner, /await readStates\s*\(/);
  assert.doesNotMatch(runner, /正在检查七业务状态/);
  assert.doesNotMatch(runner, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(runner, /\bDROP\s+TABLE\b/i);
});

test('browser shell pins V165 and contains no retired V148 build marker', () => {
  assert.match(injector, /v67-resilient-run-guard\.js\?v=20260817-1/);
  assert.match(injector, /v165-seven-business-stage-verification-v2/);
  assert.doesNotMatch(injector, /v148-direct-daily-runner-v1/);
});
