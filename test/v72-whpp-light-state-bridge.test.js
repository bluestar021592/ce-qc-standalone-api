import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('V72 bridge is syntax-valid and rewrites only GET WHPP state reads', () => {
  const file = new URL('../public/v72-whpp-light-state-bridge.js', import.meta.url);
  const source = fs.readFileSync(file, 'utf8');
  const check = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(source, /url\.pathname !== '\/api\/whpp\/state'/);
  assert.match(source, /\/api\/v71\/whpp-summary/);
  assert.match(source, /method !== 'GET'/);
  assert.match(source, /reportDate/);
});

test('V72 loads after the legacy WHPP board and all compatibility layers', () => {
  const injector = read('src/v44WhppUiPatch.js');
  assert.match(injector, /v72-whpp-light-state-bridge\.js\?v=20260812-1/);
  assert.ok(injector.indexOf('v72-whpp-light-state-bridge.js') > injector.indexOf('whpp-v44.js'));
  assert.ok(injector.indexOf('v72-whpp-light-state-bridge.js') > injector.indexOf('v69-whpp-card-dedup.js'));
});

test('V71 returns the state/dashboard shape expected by the existing WHPP renderer', () => {
  const source = read('src/v71WhppSummaryPatch.js');
  assert.match(source, /const state = \{ reportDate: date/);
  assert.match(source, /const dashboard = \{ businessType: 'WHPP'/);
  assert.match(source, /metrics, regions/);
  assert.match(source, /loadRegions/);
});
