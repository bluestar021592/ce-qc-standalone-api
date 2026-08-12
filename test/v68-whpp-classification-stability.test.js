import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('V68 WHPP classification runtime is syntax-valid and preserves last good truth', () => {
  const file = new URL('../public/v68-whpp-classification-stability.js', import.meta.url);
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /WHPP本土/);
  assert.match(source, /classification-whpp/);
  assert.match(source, /localStorage\.getItem\(CACHE_KEY\)/);
  assert.match(source, /rawUnique\s*-\s*core/);
  assert.match(source, /classificationConflicts/);
  assert.match(source, /Promise\.allSettled/);
});

test('V68 restores WHPP after unified import rerenders and is loaded last', () => {
  const source = read('public/v68-whpp-classification-stability.js');
  const injector = read('src/v44WhppUiPatch.js');
  assert.match(source, /renderUnifiedImportResult/);
  assert.match(source, /MutationObserver/);
  assert.match(injector, /v68-whpp-classification-stability\.js\?v=20260812-1/);
  assert.ok(injector.indexOf('v68-whpp-classification-stability.js') > injector.indexOf('v66-import-success-whpp.js'));
  assert.ok(injector.indexOf('v68-whpp-classification-stability.js') > injector.indexOf('v64-whpp-total-kpi-integration.js'));
});
