import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const patch = fs.readFileSync(new URL('../src/v53WhppRefreshGatePatch.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');

test('WHPP refresh gate clears successful query checkpoints for unresolved bills', () => {
  assert.match(patch, /scanQueryStatus\s*=\s*filterStatuses/);
  assert.match(patch, /eventQueryStatus\s*=\s*filterStatuses/);
  assert.match(patch, /exceptionQueryStatus\s*=\s*filterStatuses/);
  assert.match(patch, /WHPP待刷新终态/);
  assert.match(patch, /api\/whpp\/run\/start/);
  assert.match(patch, /api\/whpp\/run\/resume/);
});

test('WHPP refresh gate loads before V42 registers WHPP run routes', () => {
  const gate = bootstrap.indexOf("v53WhppRefreshGatePatch");
  const whpp = bootstrap.indexOf("v42WhppPatch");
  assert.ok(gate >= 0, 'V53 refresh gate must be loaded');
  assert.ok(whpp >= 0, 'V42 WHPP patch must be loaded');
  assert.ok(gate < whpp, 'V53 must load before V42 so it can wrap WHPP run routes');
});
