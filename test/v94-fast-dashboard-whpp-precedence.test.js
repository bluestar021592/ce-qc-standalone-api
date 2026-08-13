import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('V89 dashboard runtime is syntax-valid after V94 source-truth precedence fix', () => {
  const url = new URL('../public/v89-fast-dashboard.js', import.meta.url);
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(url)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('SHOPEE WHPP card prefers strict V94 summary over legacy snapshot metrics', () => {
  const source = read('public/v89-fast-dashboard.js');
  assert.match(source, /function strictWhppValue/);
  assert.match(source, /const strict = strictWhppValue\(data, type\)/);
  assert.match(source, /const whppValue = strict !== null \? strict : \(fromState !== null \? fromState : 0\)/);
  assert.ok(source.indexOf('const strict = strictWhppValue(data, type)') < source.indexOf('const whppValue = strict !== null'));
});

test('HTML injector cache-busts the strict V94-compatible V89 runtime', () => {
  const injector = read('src/v44WhppUiPatch.js');
  assert.match(injector, /v89-fast-dashboard\.js\?v=20260813-2/);
  assert.match(injector, /v94-business-source-truth-ui-v2\.js\?v=20260813-2/);
});
