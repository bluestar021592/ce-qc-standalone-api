import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('V69 WHPP semantic card dedup runtime is syntax-valid and removes duplicates', () => {
  const file = new URL('../public/v69-whpp-card-dedup.js', import.meta.url);
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /WHPP本土/);
  assert.match(source, /node !== canonical/);
  assert.match(source, /node\.remove\(\)/);
  assert.match(source, /MutationObserver/);
});

test('V69 observer is idempotent and does not create a microtask feedback loop', () => {
  const source = read('public/v69-whpp-card-dedup.js');
  assert.match(source, /span\.textContent !== 'WHPP本土'/);
  assert.match(source, /value\.textContent !== desired/);
  assert.match(source, /mutationTouchesSummary/);
  assert.match(source, /requestAnimationFrame/);
  assert.doesNotMatch(source, /queueMicrotask/);
});

test('V69 loads after V68 with a fresh cache key so legacy WHPP cards converge to one final card', () => {
  const injector = read('src/v44WhppUiPatch.js');
  assert.match(injector, /v69-whpp-card-dedup\.js\?v=20260812-2/);
  assert.ok(injector.indexOf('v69-whpp-card-dedup.js') > injector.indexOf('v68-whpp-classification-stability.js'));
});
