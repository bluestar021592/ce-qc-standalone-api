import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const track = fs.readFileSync(new URL('../src/trackBatching.js', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../src/v147TrackTimeoutConfig.js', import.meta.url), 'utf8');
const uiPatch = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');

function pos(source, text) {
  const index = source.indexOf(text);
  assert.ok(index >= 0, `missing: ${text}`);
  return index;
}

test('V147 bounds one track batch instead of allowing recursive waits forever', () => {
  assert.match(track, /BATCH_TIME_BUDGET_EXCEEDED/);
  assert.match(track, /CE_TRACK_BATCH_BUDGET_MS/);
  assert.match(track, /deadlineAt/);
  assert.match(track, /主流程立即继续下一批/);
  assert.match(track, /TRACK_FALLBACK_SIZES = Object\.freeze\(\[25, 10, 5, 1\]\)/);
  assert.match(track, /DEFAULT_TRANSIENT_RETRIES/);
});

test('V147 keeps at least three transient retries and shortens each CE network wait', () => {
  assert.match(config, /REQUEST_TIMEOUT_MS\) process\.env\.REQUEST_TIMEOUT_MS = '20000'/);
  assert.match(config, /CE_TRACK_BATCH_BUDGET_MS\) process\.env\.CE_TRACK_BATCH_BUDGET_MS = '90000'/);
  assert.match(config, /CE_TRANSIENT_RETRIES\) process\.env\.CE_TRANSIENT_RETRIES = '3'/);
});

test('V147 timeout config loads before any business patch can construct CE clients', () => {
  const configPos = pos(uiPatch, "import './v147TrackTimeoutConfig.js';");
  const firstBusinessPos = pos(uiPatch, "import './v51CarryDashboardPatch.js';");
  const retryCenterPos = pos(uiPatch, "import './v145SevenBusinessRetryCenterPatch.js';");
  assert.ok(configPos < firstBusinessPos);
  assert.ok(configPos < retryCenterPos);
  assert.match(uiPatch, /v147-track-time-budget-v1/);
});

test('V147 recovery code does not delete historical business data', () => {
  const combined = `${track}\n${config}`;
  assert.doesNotMatch(combined, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(combined, /\bDROP\s+TABLE\b/i);
});
