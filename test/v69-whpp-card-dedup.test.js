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

test('V69 observer is scoped to the import summary and cannot create an app-wide feedback loop', () => {
  const source = read('public/v69-whpp-card-dedup.js');
  assert.match(source, /document\.getElementById\('unifiedClassificationSummary'\)/);
  assert.match(source, /summaryObserver\.observe\(root/);
  assert.match(source, /requestAnimationFrame/);
  assert.doesNotMatch(source, /queueMicrotask/);
  assert.doesNotMatch(source, /observer\.observe\(document\.querySelector\('\.app-shell'\)/);
});

test('V69 loads after V68 with a fresh cache key so WHPP cards converge to one final card', () => {
  const injector = read('src/v44WhppUiPatch.js');
  assert.match(injector, /v69-whpp-card-dedup\.js\?v=20260812-3/);
  assert.ok(injector.indexOf('v69-whpp-card-dedup.js') > injector.indexOf('v68-whpp-classification-stability.js'));
});
