import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const v90Url = new URL('../src/v90FastDashboardReadPatch.js', import.meta.url);
const v94Url = new URL('../src/v94ShopeeWhppSourceTruthPatch.js', import.meta.url);
const v90 = fs.readFileSync(v90Url, 'utf8');
const v94 = fs.readFileSync(v94Url, 'utf8');

test('V90/V94 summary patches stay syntax-valid', () => {
  for (const url of [v90Url, v94Url]) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(url)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test('V94 asks V90 for base classification only and replaces legacy WHPP counts with strict truth', () => {
  assert.match(v90, /skipShopeeWhpp/);
  assert.match(v90, /skipShopeeWhpp \? \{ SHOPEECN:0, SHOPEEVN:0 \}/);
  assert.match(v90, /inspectV90FastDashboard\(requestedDate='', options=\{\}\)/);
  assert.match(v94, /inspectV90FastDashboard\(requestedDate, \{ skipShopeeWhpp: true \}\)/);
  assert.match(v94, /loadStrictShopeeWhppRetentionRows/);
  assert.match(v94, /LATEST_EFFECTIVE_LOCATION_WHPP_AND_NOT_POD_RETURN_OR_OUTBOUND/);
});
