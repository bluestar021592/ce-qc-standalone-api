import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CEClient } from '../src/ceClient.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('V70 confirm-query resilience runtime is syntax-valid and bounded', () => {
  const file = new URL('../src/v70ConfirmQueryResiliencePatch.js', import.meta.url);
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /CONFIRM_QUERY_BATCH_SIZE \|\| 50/);
  assert.match(source, /CONFIRM_QUERY_TIMEOUT_MS \|\| 25000/);
  assert.match(source, /Math\.min\(100/);
  assert.match(source, /return \[\]/);
  assert.match(source, /isAuthError/);
  assert.match(source, /previousTimeout/);
});

test('V70 splits a transient timeout to tiny children, defers only failed children, and restores axios timeout', { concurrency: false }, async () => {
  const original = CEClient.prototype.confirmQuery;
  const calls = [];
  CEClient.prototype.confirmQuery = async function fakeOriginal(codes) {
    calls.push({ size: codes.length, timeout: this.http?.defaults?.timeout });
    if (codes.includes('AUTH')) {
      const error = new Error('unauthorized');
      error.ceStatus = 401;
      throw error;
    }
    const error = new Error('confirm-query失败：timeout of 25000ms exceeded');
    error.code = 'ECONNABORTED';
    throw error;
  };

  try {
    await import(`../src/v70ConfirmQueryResiliencePatch.js?test=${Date.now()}`);
    const patched = CEClient.prototype.confirmQuery;
    const client = Object.create(CEClient.prototype);
    client.http = { defaults: { timeout: 45000 } };

    const result = await patched.call(client, ['CC001','CC002','CC003','CC004','CC005','CC006']);
    assert.deepEqual(result, []);
    assert.equal(client.http.defaults.timeout, 45000);
    assert.ok(calls.some(call => call.size <= 5), `expected adaptive child calls, got ${JSON.stringify(calls)}`);
    assert.ok(calls.every(call => call.timeout === 25000), `expected per-confirm timeout override, got ${JSON.stringify(calls)}`);

    await assert.rejects(() => patched.call(client, ['AUTH']), /unauthorized/);
  } finally {
    CEClient.prototype.confirmQuery = original;
  }
});

test('V70 is loaded before the main server so every processing route uses it', () => {
  const bootstrap = read('bootstrap.js');
  assert.match(bootstrap, /v70ConfirmQueryResiliencePatch/);
  assert.ok(bootstrap.indexOf('v70ConfirmQueryResiliencePatch') < bootstrap.indexOf("importPhase('server'"));
});
