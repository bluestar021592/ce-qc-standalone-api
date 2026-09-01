import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/businessStore.js', import.meta.url), 'utf8');

test('Shopee running checkpoints avoid full normalized-table rewrites', () => {
  assert.match(source, /BUSINESS_RUNTIME_CHECKPOINT_REVISION = '2026-09-01-shopee-lightweight-runtime-checkpoint-v1'/);
  assert.match(source, /if \(runtimeCheckpoint\) mirrorBusinessRuntimeCheckpoint\(db, normalized, type, now\);\s*else mirrorBusinessTables\(db, normalized, type, now\);/);

  const runtimeStart = source.indexOf('function mirrorBusinessRuntimeCheckpoint');
  const fullStart = source.indexOf('function mirrorBusinessTables');
  assert.ok(runtimeStart >= 0 && fullStart > runtimeStart, 'runtime checkpoint must be a separate lightweight path before full finalization mirror');
  const runtimeBody = source.slice(runtimeStart, fullStart);
  assert.doesNotMatch(runtimeBody, /DELETE FROM business_daily_parse_rows/);
  assert.doesNotMatch(runtimeBody, /DELETE FROM business_track_events/);
  assert.doesNotMatch(runtimeBody, /DELETE FROM business_exception_items/);
  assert.doesNotMatch(runtimeBody, /DELETE FROM business_final_rows/);
  assert.doesNotMatch(runtimeBody, /persistPendingDailyMembers/);
  assert.match(runtimeBody, /UPDATE business_run_locks/);
  assert.match(runtimeBody, /INSERT INTO business_run_checkpoints/);
  assert.match(runtimeBody, /business_pod_locks/);
});

test('runtime evidence remains restart-recoverable until finalization', () => {
  assert.match(source, /function isRuntimeCheckpointActive\(state = \{\}\)/);
  assert.match(source, /state\?\.processing\?\.running === true \|\| state\?\.processing\?\.paused === true/);
  assert.match(source, /scanResults: rows\('scanResults'\)/);
  assert.match(source, /scanQueryStatus: statuses\('scanQueryStatus'\)/);
  assert.match(source, /trackEvents: rows\('trackEvents'\)/);
  assert.match(source, /eventQueryStatus: statuses\('eventQueryStatus'\)/);
  assert.match(source, /exceptionItems: rows\('exceptionItems'\)/);
  assert.match(source, /exceptionQueryStatus: statuses\('exceptionQueryStatus'\)/);
  assert.match(source, /apiBatchStatus: statuses\('apiBatchStatus'\)/);
  assert.match(source, /finalRows: preserveRuntimeEvidence \? \(state\.finalRows \|\| \[\]\)\.map\(stripHeavyBusinessRow\) : \[\]/);
  assert.match(source, /preferRuntimeRows\(state, 'trackEvents', eventTableRows, runtimeActive\)/);
  assert.match(source, /preferRuntimeRows\(state, 'exceptionItems', exceptionTableRows, runtimeActive\)/);
  assert.match(source, /const podLocks = \[\.\.\.new Set\(\[\.\.\.\(state\.podLocks \|\| \[\]\), \.\.\.podLocksFromDb\]\)\]/);
});

test('heavy raw API bodies stay out of runtime checkpoint JSON', () => {
  assert.match(source, /delete copy\.rawJson/);
  assert.match(source, /delete copy\.raw/);
  assert.match(source, /delete copy\.events/);
  assert.match(source, /delete copy\.trackEvents/);
  assert.match(source, /delete copy\.exceptionItems/);
  assert.match(source, /delete copy\.scanRaw/);
  assert.match(source, /compactBusinessStatePayload\(normalizeBusinessState\(state, type\), false\)/, 'immutable snapshot must explicitly disable runtime evidence');
});
