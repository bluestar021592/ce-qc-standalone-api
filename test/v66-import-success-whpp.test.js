import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('V66 import success alert includes WHPP from unified import response', () => {
  const file = new URL('../public/v66-import-success-whpp.js', import.meta.url);
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', file.pathname], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /classificationCounts\?\.WHPP/);
  assert.match(source, /payload\?\.whpp\?\.count/);
  assert.match(source, /WHPP本土/);
  assert.match(source, /综合日报导入成功/);
});

test('V66 runtime is injected after V64 and preserves V65 request layer', () => {
  const injector = read('src/v44WhppUiPatch.js');
  assert.match(injector, /v65-request-coalescing\.js\?v=20260812-1/);
  assert.match(injector, /v66-import-success-whpp\.js\?v=20260812-1/);
  assert.ok(injector.indexOf('v66-import-success-whpp.js') > injector.indexOf('v64-whpp-total-kpi-integration.js'));
});
