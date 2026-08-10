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
  'scripts/CE_QC_Production_Diagnostic_ReadOnly.mjs'
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
