import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('V433 keeps the V334/V428 compatibility markers required by the go-live gate without reverting current ownership',()=>{
  const source=fs.readFileSync(new URL('../public/v295-first-attempt-ui.js',import.meta.url),'utf8');
  const injection=fs.readFileSync(new URL('../src/v295FirstAttemptUiInjectionPatch.js',import.meta.url),'utf8');
  const shell=fs.readFileSync(new URL('../src/v44WhppUiPatch.js',import.meta.url),'utf8');
  assert.match(source,/2026-09-05-v433-status-first-heavy-query-gate-v1/);
  assert.match(source,/v334-saved-history-first-attempt-owner-v1/);
  assert.match(source,/__CE_QC_V328_HISTORY_PAYLOADS__/);
  assert.match(source,/cachedHistoryTrend/);
  assert.match(injection,/v295-first-attempt-ui\.js\?v=20260905-v433-1/);
  assert.match(injection,/v295-first-attempt-ui\.js\?v=20260827-v334-1/);
  assert.match(injection,/2026-08-27-v334-canonical-detail-history-ownership-v1/);
  assert.match(shell,/2026-09-05-v433-unified-status-stability-loader-v1/);
  assert.match(shell,/2026-09-05-v428-base-ccsl-status-owner-loader-v1/);
  assert.match(shell,/v169-seven-business-legacy-status-sync\.js\?v=20260905-v433-1/);
  assert.match(shell,/data-previous-src=.*v169-seven-business-legacy-status-sync\.js\?v=20260904-v424-1/);
});
