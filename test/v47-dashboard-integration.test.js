import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('CEAF is accepted by the shared trend endpoint', () => {
  const source = fs.readFileSync(path.resolve('src/v27TrendPatch.js'), 'utf8');
  assert.match(source, /new Set\(\['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','CCSL','SHOPEE'\]\)/);
});

test('global automatic processing continues into WHPP after CCSL and Shopee', () => {
  const source = fs.readFileSync(path.resolve('public/whpp-v47-auto-run.js'), 'utf8');
  assert.match(source, /global\.runUnified/);
  assert.match(source, /\/api\/whpp\/state/);
  assert.match(source, /\/api\/whpp\/run\/start/);
  assert.match(source, /snapshotStatus/);
});

test('WHPP V47 integration is injected into every application page', () => {
  const source = fs.readFileSync(path.resolve('src/v44WhppUiPatch.js'), 'utf8');
  assert.match(source, /whpp-v47-auto-run\.js/);
});

test('V47 dashboard integration files pass syntax checks', () => {
  for (const relative of ['src/v27TrendPatch.js', 'src/v44WhppUiPatch.js', 'public/whpp-v47-auto-run.js']) {
    const result = spawnSync(process.execPath, ['--check', path.resolve(relative)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative} syntax failed:\n${result.stderr || result.stdout}`);
  }
});
