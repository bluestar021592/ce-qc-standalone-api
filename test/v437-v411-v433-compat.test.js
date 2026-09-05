import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('V433 V169 retains V411 fail-closed compatibility without restoring the retired unconfirmed Start release',()=>{
  const v169=fs.readFileSync(new URL('../public/v169-seven-business-legacy-status-sync.js',import.meta.url),'utf8');
  assert.match(v169,/2026-09-05-v433-v168-single-start-control-owner-v1/);
  assert.match(v169,/2026-09-01-v411-unconfirmed-status-entry-lock-v1/);
  assert.match(v169,/2026-09-04-v424-v169-v67-proof-handoff-v1/);
  assert.match(v169,/state\.kind==='unconfirmed'[\s\S]*lockResumeButtons\(state\)/);
  assert.doesNotMatch(v169,/function releaseStartButtonForConfirmation\(/);
  assert.doesNotMatch(v169,/releaseStartButtonForConfirmation\s*\(/);
});
