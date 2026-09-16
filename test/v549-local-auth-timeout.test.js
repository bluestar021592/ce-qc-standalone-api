import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFile = path.join(root, 'src', 'v506LocalAuthBridgePatch.js');

test('V549 auth bridge source is valid JavaScript', () => {
  const run = spawnSync(process.execPath, ['--check', sourceFile], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test('V549 gives backend timeout authority and keeps frontend failsafe longer', () => {
  const moduleUrl = pathToFileURL(sourceFile).href;
  const script = `
    import {
      classifyV549AuthBridgeError,
      rewriteV506LoginHtml,
      v506AuthBridgeStateForTests
    } from ${JSON.stringify(moduleUrl)};
    const state = v506AuthBridgeStateForTests();
    if (state.timeoutMs !== 25000) throw new Error('expected backend timeout 25000ms, got ' + state.timeoutMs);
    if (state.frontendTimeoutMs <= state.timeoutMs) throw new Error('frontend failsafe must exceed backend timeout');
    const timeout = classifyV549AuthBridgeError(new Error('AUTH_SIDECAR_TIMEOUT'));
    if (timeout.status !== 504 || timeout.code !== 'LOCAL_AUTH_BRIDGE_TIMEOUT') throw new Error('timeout classification failed');
    const unavailable = classifyV549AuthBridgeError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5179'), { code: 'ECONNREFUSED' }));
    if (unavailable.status !== 503 || unavailable.code !== 'LOCAL_AUTH_BRIDGE_UNAVAILABLE') throw new Error('unavailable classification failed');
    const html = '<form action="http://127.0.0.1:5179/api/local-auth/login"></form><script>var timer=setTimeout(function(){if(controller)controller.abort();},8000);fetch("http://127.0.0.1:5179/api/local-auth/login");var msg="登录认证8秒内未完成，独立认证服务没有响应。";</script><div>独立登录通道 5179，不占用质控主数据库写入锁。</div>';
    const rewritten = rewriteV506LoginHtml(html);
    if (!rewritten.includes('/api/local-auth-proxy/login')) throw new Error('same-origin endpoint rewrite missing');
    if (!rewritten.includes('},35000);fetch(')) throw new Error('frontend failsafe rewrite missing');
    if (rewritten.includes('登录认证8秒内未完成')) throw new Error('stale 8-second message remains');
    if (!rewritten.includes('后端负责认证超时判定')) throw new Error('new bridge status message missing');
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CE_QC_AUTH_BRIDGE_TIMEOUT_MS: '25000' }
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});
