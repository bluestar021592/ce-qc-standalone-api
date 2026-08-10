import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

for (const relativePath of [
  'scripts/CE_QC_Production_Audit.mjs',
  'scripts/CE_QC_Production_Diagnostic_ReadOnly.mjs',
  'scripts/CE_QC_First_Day_GoLive_Verify_ReadOnly.mjs'
]) {
  test(`${relativePath} opens SQLite in read-only mode without runtime migration imports`, () => {
    const source = read(relativePath);
    assert.match(source, /new DatabaseSync\([^\n]+\{\s*readOnly:\s*true\s*\}\)/);
    assert.doesNotMatch(source, /from\s+['"]\.\.\/src\/db\.js['"]/);
    assert.doesNotMatch(source, /migrateDatabase\s*\(/);
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b\s+/i);
  });
}

test('production audit reads the canonical db_schema_version key', () => {
  const source = read('scripts/CE_QC_Production_Audit.mjs');
  assert.match(source, /key='db_schema_version'/);
});

test('first-day go-live gate requires source payload normalized and current-state equality', () => {
  const source = read('scripts/CE_QC_First_Day_GoLive_Verify_ReadOnly.mjs');
  assert.match(source, /expected\[type\]\s*===\s*payloadCount\[type\]/);
  assert.match(source, /expected\[type\]\s*===\s*normalizedCount\[type\]/);
  assert.match(source, /expected\[type\]\s*===\s*currentCount\[type\]/);
  assert.match(source, /payloadPod\[type\]\s*===\s*normalizedPod\[type\]/);
  assert.match(source, /payloadPod\[type\]\s*===\s*currentPod\[type\]/);
  assert.match(source, /GO_LIVE_RESULT:\s*\$\{allPass \? 'READY' : 'BLOCKED'\}/);
});
