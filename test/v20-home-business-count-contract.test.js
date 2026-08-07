import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('home classification counts and business pages share exact unified snapshot path', () => {
  assert.match(app, /unifiedImportState\?\.classificationCounts/);
  assert.match(app, /syncUnifiedSelection\(latestUnified\.reportDate, latestUnified\.snapshotId/);
  assert.match(app, /api\(`\/api\/business-state\/\$\{type\}\?snapshotId=/);
});
