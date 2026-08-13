import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const firstDayUrl = new URL('../scripts/CE_QC_First_Day_GoLive_Verify_ReadOnly.mjs', import.meta.url);
const businessUrl = new URL('../scripts/CE_QC_Business_Snapshot_Audit_ReadOnly.mjs', import.meta.url);
const fullUrl = new URL('../scripts/CE_QC_Full_Acceptance_Verify_ReadOnly.mjs', import.meta.url);
const batchUrl = new URL('../CE_QC_Full_Acceptance_Verify_ReadOnly.bat', import.meta.url);
const read = url => fs.readFileSync(url, 'utf8');

for (const [name,url] of [['first-day audit',firstDayUrl],['business audit',businessUrl],['full acceptance',fullUrl]]) {
  test(`${name} is syntax-valid`, () => {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(url)], { encoding:'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}

test('live audits never run full integrity_check or parse giant immutable snapshot payloads', () => {
  const first = read(firstDayUrl);
  const business = read(businessUrl);
  for (const source of [first,business]) {
    assert.doesNotMatch(source, /PRAGMA\s+integrity_check/i);
    assert.doesNotMatch(source, /payloadJson/);
    assert.match(source, /readOnly:\s*true/);
    assert.match(source, /PRAGMA query_only=ON/);
    assert.match(source, /busy_timeout=1500/);
  }
  assert.match(first, /SLOWEST_DB_CHECK_MS/);
  assert.match(first, /PERFORMANCE_RESULT/);
  assert.match(business, /QUERY_MS/);
});

test('full acceptance gate covers data truth, seven businesses, strict tracking, drilldowns, exports and the complete go-live suite', () => {
  const source = read(fullUrl);
  assert.match(source, /CE_QC_First_Day_GoLive_Verify_ReadOnly\.mjs/);
  assert.match(source, /CE_QC_Business_Snapshot_Audit_ReadOnly\.mjs/);
  assert.match(source, /v86-strict-track-status-gate\.test\.js/);
  assert.match(source, /v61-drilldown-route-bridge\.test\.js/);
  assert.match(source, /v84-async-large-range-export\.test\.js/);
  assert.match(source, /v90-instant-whpp-navigation\.test\.js/);
  assert.match(source, /test:golive/);
  assert.match(source, /ACCEPTANCE_RESULT/);
  assert.match(read(batchUrl), /CE_QC_Full_Acceptance_Verify_ReadOnly\.mjs/);
});
