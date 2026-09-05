import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/accessControl.js', import.meta.url), 'utf8');

test('V430 internal login has a native form fallback and keeps JSON enhancement', () => {
  assert.match(source, /V430_INTERNAL_LOGIN_FALLBACK_ID/);
  assert.ok(source.includes('<form id="login" method="post" action="${endpoint}">'), 'login form must have a real POST action');
  assert.ok(source.includes('<button type="submit">'), 'login button must be an explicit submit button');
  assert.match(source, /application\\\/x-www-form-urlencoded/);
  assert.match(source, /new URLSearchParams\(Buffer\.concat\(chunks\)\.toString\('utf8'\)\)/);
  assert.match(source, /res\.redirect\(303, '\/'\)/);
  assert.match(source, /fetch\('\$\{endpoint\}'/);
  assert.match(source, /登录请求没有完成/);
  assert.doesNotMatch(source, /<form id="login">/);
});

test('V430 keeps failed login feedback visible on the native fallback path', () => {
  assert.match(source, /function authError\(/);
  assert.match(source, /forceHtml: true/);
  assert.match(source, /用户名或密码错误/);
  assert.match(source, /lockedUntil \? 423 : 401/);
});
