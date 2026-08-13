import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const script = fs.readFileSync(new URL('../tools/Apply_V94_SHOPEE_WHPP_SourceTruth_Fix.ps1', import.meta.url), 'utf8');

test('V94 deployment keeps the current backend online until the focused source gate passes', () => {
  const focused = script.indexOf("Running V94 focused deployment gate while current backend stays online");
  const stop = script.indexOf("Stopping existing CE QC backend/supervisor only after focused gate passed");
  assert.ok(focused >= 0, 'focused gate marker must exist');
  assert.ok(stop > focused, 'backend stop must occur only after the focused gate');
  assert.match(script, /Current backend was left running; no deployment was attempted/);
});
