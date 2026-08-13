import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../tools/Repair_20260801_CEAF_And_Start.ps1', import.meta.url), 'utf8');

test('one-shot launcher backs up, verifies exact source truth, then starts and opens browser', () => {
  assert.match(source, /pre_ceaf_repair_/);
  assert.match(source, /repairLatestCeafSplit/);
  assert.match(source, /CEAF_SPLIT_OK/);
  assert.match(source, /CEAF\s*=\s*80/);
  assert.match(source, /WHPP\s*=\s*196/);
  assert.match(source, /Total\s*=\s*9540/);
  assert.match(source, /business_daily_parse_rows/);
  assert.match(source, /business_daily_reports/);
  assert.match(source, /Stop-CeQcProcesses/);

  const repair = source.indexOf('Invoke-CurrentCeafRepair');
  const verify = source.lastIndexOf('Assert-ExpectedSplit $actual');
  const start = source.lastIndexOf('Start-CeQcAndWait');
  const browser = source.lastIndexOf('Start-Process "http://127.0.0.1:5177/import');
  assert.ok(repair >= 0);
  assert.ok(verify > repair, 'database truth must be verified after repair');
  assert.ok(start > verify, 'backend must start only after exact data verification passes');
  assert.ok(browser > start, 'browser must open only after backend readiness succeeds');
});

test('launcher accepts the authenticated root response, including HTTP 401, as backend ready', () => {
  assert.match(source, /Invoke-WebRequest -Uri 'http:\/\/127\.0\.0\.1:5177\/'/);
  assert.match(source, /\$status -ge 200 -and \$status -lt 500/);
  assert.match(source, /Exception\.Response\.StatusCode/);
  assert.match(source, /Get-NetTCPConnection -LocalPort 5177 -State Listen/);
  assert.match(source, /BACKEND_READY HTTP=/);
  assert.doesNotMatch(source, /\/api\/health/);
});

test('launcher never reimports the report or deletes data', () => {
  assert.doesNotMatch(source, /unified-daily-report/);
  assert.doesNotMatch(source, /Invoke-WebRequest.*upload/i);
  assert.doesNotMatch(source, /Remove-Item.*(?:sqlite|\.db)/i);
  assert.doesNotMatch(source, /git\s+reset\s+--hard/i);
});

test('backup keeps the Unicode database path inside Node instead of round-tripping through Windows PowerShell', () => {
  assert.match(source, /getRuntimeConfig\(\)\.dbFile/);
  assert.match(source, /fs\.copyFileSync/);
  assert.match(source, /BACKUP_OK/);
  assert.doesNotMatch(source, /\$dbPath\s*=\s*\(&\s*node/);
  assert.doesNotMatch(source, /Test-Path\s+\$dbPath/);
  assert.doesNotMatch(source, /Split-Path\s+\$dbPath/);
});
