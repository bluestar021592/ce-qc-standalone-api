import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('V68 WHPP classification runtime is syntax-valid and derives full source truth', () => {
  const file = new URL('../public/v68-whpp-classification-stability.js', import.meta.url);
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /WHPP本土/);
  assert.match(source, /classification-whpp/);
  assert.match(source, /rawRows\s*-\s*stats\.duplicateRows\s*-\s*stats\.missingWaybillRows/);
  assert.match(source, /rawUnique\s*-\s*core/);
  assert.match(source, /classification-valid-unique/);
  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /fetch\s*\(/);
});

test('V68 restores WHPP immediately after unified import rerenders without network polling', () => {
  const source = read('public/v68-whpp-classification-stability.js');
  const injector = read('src/v44WhppUiPatch.js');
  assert.match(source, /renderUnifiedImportResult/);
  assert.match(source, /normalize\(\)/);
  assert.match(source, /#unifiedClassificationSummary/);
  assert.match(source, /new MutationObserver/);
  assert.doesNotMatch(source, /\/api\/import\/unified-latest/);
  assert.doesNotMatch(source, /\/api\/v51\/whpp-state/);
  assert.match(injector, /v68-whpp-classification-stability\.js\?v=20260812-4/);
  assert.ok(injector.indexOf('v68-whpp-classification-stability.js') > injector.indexOf('v66-import-success-whpp.js'));
  assert.ok(injector.indexOf('v68-whpp-classification-stability.js') > injector.indexOf('v64-whpp-total-kpi-integration.js'));
});

test('V68 observer is scoped to the import summary and converges duplicate WHPP cards', () => {
  const source = read('public/v68-whpp-classification-stability.js');
  assert.match(source, /observer\.observe\(root, \{ childList: true, subtree: true, characterData: true \}\)/);
  assert.match(source, /node\.dataset\?\.v54Business === 'WHPP'/);
  assert.match(source, /node\.dataset\?\.v64Business === 'WHPP'/);
  assert.match(source, /node\.dataset\?\.v68Business === 'WHPP'/);
  assert.match(source, /label === 'WHPP本土'/);
  assert.match(source, /card\.dataset\.v64Business = 'WHPP'/);
  assert.match(source, /cards\.slice\(1\)\.forEach\(extra => extra\.remove\(\)\)/);
  assert.doesNotMatch(source, /observer\.observe\(document\.querySelector\('\.app-shell'\)/);
});
