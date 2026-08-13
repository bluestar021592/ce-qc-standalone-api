import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../tools/Repair_20260801_CEAF_And_Start.ps1', import.meta.url), 'utf8');

test('V78 one-shot launcher backs up, repairs, verifies exact source truth, and only then opens browser', () => {
  assert.match(source, /pre_ceaf_repair_/);
  assert.match(source, /repairLatestCeafSplit/);
  assert.match(source, /CEAF_SPLIT_OK/);
  assert.match(source, /CEAF\s*=\s*80/);
  assert.match(source, /WHPP\s*=\s*196/);
  assert.match(source, /Total\s*=\s*9540/);
  assert.match(source, /business_daily_parse_rows/);
  assert.match(source, /business_daily_reports/);
  assert.match(source, /Stop-CeQcProcesses/);
  assert.match(source, /Invoke-RestMethod -Uri 'http:\/\/127\.0\.0\.1:5177\/api\/health'/);

  const repair = source.indexOf('Invoke-CurrentCeafRepair');
  const verify = source.lastIndexOf('Assert-ExpectedSplit $actual');
  const start = source.lastIndexOf('Start-CeQcAndWait');
  const browser = source.lastIndexOf('Start-Process "http://127.0.0.1:5177/import');
  assert.ok(repair >= 0);
  assert.ok(verify > repair, 'database truth must be verified after repair');
  assert.ok(start > verify, 'backend must start only after exact data verification passes');
  assert.ok(browser > start, 'browser must open only after backend health succeeds');
});

test('V78 launcher never reimports the report or deletes data', () => {
  assert.doesNotMatch(source, /unified-daily-report/);
  assert.doesNotMatch(source, /Invoke-WebRequest.*upload/i);
  assert.doesNotMatch(source, /Remove-Item.*(?:sqlite|\.db)/i);
  assert.doesNotMatch(source, /git\s+reset\s+--hard/i);
});
