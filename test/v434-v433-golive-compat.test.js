import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('V433 keeps the V334 saved-history compatibility marker required by the go-live gate',()=>{
  const source=fs.readFileSync(new URL('../public/v295-first-attempt-ui.js',import.meta.url),'utf8');
  assert.match(source,/2026-09-05-v433-status-first-heavy-query-gate-v1/);
  assert.match(source,/v334-saved-history-first-attempt-owner-v1/);
  assert.match(source,/__CE_QC_V328_HISTORY_PAYLOADS__/);
  assert.match(source,/cachedHistoryTrend/);
});
