import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const sources = Object.freeze({
  runner: load('../public/v67-resilient-run-guard.js'),
  shell: load('../src/v44WhppUiPatch.js'),
});

function requireTokens(sourceName, tokens) {
  const source = sources[sourceName];
  for (const token of tokens) {
    assert.ok(source.includes(token), `${sourceName} missing required V165 token: ${token}`);
  }
}

function forbidTokens(sourceName, tokens) {
  const source = sources[sourceName];
  for (const token of tokens) {
    assert.equal(source.includes(token), false, `${sourceName} contains retired token: ${token}`);
  }
}

test('V165 stage contract owns the seven-business runner', () => {
  requireTokens('runner', [
    '2026-08-17-v165-seven-business-stage-verification-v2',
    "/api/run",
    "/api/shopee/run/start",
    "/api/whpp/run/start",
    'verifyWhpp(target)',
  ]);
});

test('V165 requires a finalized WHPP stage before seven-business completion', () => {
  requireTokens('runner', [
    'WHPP_REPORT_MISSING',
    'WHPP_RUN_ALREADY_ACTIVE',
    'WHPP_STAGE_NOT_FINALIZED',
    '七业务未全部完成',
    '已完成断点保留',
  ]);
});

test('V165 does not restore heavyweight preflight or destructive history mutation', () => {
  forbidTokens('runner', [
    'async function readStates(',
    'await readStates(',
    '正在检查七业务状态',
    'DELETE FROM',
    'DROP TABLE',
  ]);
});

test('V165 browser shell pins the current runner build', () => {
  requireTokens('shell', [
    'v67-resilient-run-guard.js?v=20260817-1',
    'v165-seven-business-stage-verification-v2',
  ]);
});
