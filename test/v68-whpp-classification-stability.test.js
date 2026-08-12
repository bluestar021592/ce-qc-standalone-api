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
});

test('V68 restores WHPP after unified import rerenders without a mutation polling loop', () => {
  const source = read('public/v68-whpp-classification-stability.js');
  const injector = read('src/v44WhppUiPatch.js');
  assert.match(source, /renderUnifiedImportResult/);
  assert.match(source, /\/api\/import\/unified-latest\?compact=1/);
  assert.doesNotMatch(source, /new MutationObserver/);
  assert.doesNotMatch(source, /\/api\/v51\/whpp-state/);
  assert.match(injector, /v68-whpp-classification-stability\.js\?v=20260812-3/);
  assert.ok(injector.indexOf('v68-whpp-classification-stability.js') > injector.indexOf('v66-import-success-whpp.js'));
  assert.ok(injector.indexOf('v68-whpp-classification-stability.js') > injector.indexOf('v64-whpp-total-kpi-integration.js'));
});

test('V68 converges legacy V54 V64 and V68 WHPP cards to exactly one semantic card', () => {
  const source = read('public/v68-whpp-classification-stability.js');
  assert.match(source, /node\.dataset\?\.v54Business === 'WHPP'/);
  assert.match(source, /node\.dataset\?\.v64Business === 'WHPP'/);
  assert.match(source, /node\.dataset\?\.v68Business === 'WHPP'/);
  assert.match(source, /label === 'WHPP本土'/);
  assert.match(source, /card\.dataset\.v64Business = 'WHPP'/);
  assert.match(source, /cards\.slice\(1\)\.forEach\(extra => extra\.remove\(\)\)/);
});
