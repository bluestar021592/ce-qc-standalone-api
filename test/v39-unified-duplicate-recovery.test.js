import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const storage = fs.readFileSync(new URL('../src/storage.js', import.meta.url), 'utf8');
const recovery = fs.readFileSync(new URL('../src/v39UnifiedSnapshotRecoveryPatch.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
const unified = fs.readFileSync(new URL('../src/unifiedImportStore.js', import.meta.url), 'utf8');

test('CCSL persistence normalizes duplicate final rows before snapshot creation', () => {
  assert.match(storage, /dedupeRowsByBill/);
  assert.match(storage, /state\.finalRows\s*=\s*normalized\.finalRows/);
  assert.match(storage, /Later rows win|Later rows/);
});

test('legacy recovery is limited to duplicate-only CCSL reconciliation failures', () => {
  assert.match(recovery, /最终结果存在重复运单号/);
  assert.match(recovery, /duplicateOnlyConsistency/);
  assert.match(recovery, /buildConsistencyReport\(state\)/);
  assert.match(recovery, /ERRORS_REMAIN_AFTER_DEDUPE/);
  assert.match(recovery, /status='VALID'/);
  assert.match(recovery, /reconciliationStatus='COMPLETED'/);
  assert.doesNotMatch(recovery, /DELETE FROM (?:final_rows|scan_results|track_events|business_final_rows|unified_import_rows)/);
});

test('unified parent still enforces strict count and terminal-state reconciliation', () => {
  assert.match(unified, /uniqueBills\.size === payload\.finalRows\.length/);
  assert.match(unified, /Object\.values\(countChecks\)\.every\(Boolean\)/);
  assert.match(unified, /podInboundIntersection\.length === 0/);
  assert.match(unified, /returnInboundIntersection\.length === 0/);
});

test('recovery guard is installed before server routes register', () => {
  const recoveryIndex = bootstrap.indexOf('v39UnifiedSnapshotRecoveryPatch');
  const serverIndex = bootstrap.indexOf("importPhase('server', './server.js')");
  assert.ok(recoveryIndex >= 0);
  assert.ok(serverIndex > recoveryIndex);
  assert.match(recovery, /\/api\/shopee\/run\/start/);
  assert.match(recovery, /\/api\/shopee\/run\/resume/);
});
