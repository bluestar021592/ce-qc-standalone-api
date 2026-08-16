import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const patch = fs.readFileSync(new URL('../src/v161UnifiedImportRuntimeTruthPatch.js', import.meta.url), 'utf8');
const boot = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');

test('V161 keeps current imported-day runtime facts authoritative during refresh', () => {
  assert.match(patch, /CURRENT_IMPORT_MEMBERS/);
  assert.match(patch, /historicalSeparate:\s*true/);
  assert.match(patch, /regionCountsJson/);
  assert.match(patch, /unified_import_rows/);
  assert.match(patch, /containerFormat/);
  assert.match(patch, /\/api\/bootstrap/);
  assert.match(patch, /\/api\/import\/unified-latest/);
  assert.match(boot, /v161UnifiedImportRuntimeTruthPatch/);
});
