import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bootstrapUrl = new URL('../bootstrap.js', import.meta.url);
const bootstrap = fs.readFileSync(bootstrapUrl, 'utf8').replace(/\r\n/g, '\n');

test('bootstrap stays syntax-valid after first-paint maintenance deferral', () => {
  const check = spawnSync(process.execPath, ['--check', fileURLToPath(bootstrapUrl)], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
});

test('server starts before one-time V92/V76 database maintenance executes', () => {
  const mainStart = bootstrap.indexOf("try {\n  console.log(`[CE-QC][BOOT]");
  const serverCall = bootstrap.indexOf("await importPhase('server', './server.js')", mainStart);
  const scheduleCall = bootstrap.indexOf('scheduleDeferredMaintenance({ v92, v76Repair })', serverCall);
  assert.ok(mainStart >= 0, 'bootstrap main phase must exist');
  assert.ok(serverCall > mainStart, 'server import must exist on the startup path');
  assert.ok(scheduleCall > serverCall, 'historical maintenance must be scheduled only after server import');

  const coldStartCriticalPath = bootstrap.slice(mainStart, serverCall);
  assert.doesNotMatch(coldStartCriticalPath, /repairWhppTerminalAuthorityOnce\s*\(/);
  assert.doesNotMatch(coldStartCriticalPath, /prepareShopeeResumeAudit\s*\(/);
  assert.doesNotMatch(coldStartCriticalPath, /repairLatestCeafSplit\s*\(/);
});

test('background maintenance is delayed and does not keep the process alive by itself', () => {
  assert.match(bootstrap, /CE_QC_BACKGROUND_MAINTENANCE_DELAY_MS/);
  assert.match(bootstrap, /Math\.max\(5_000/);
  assert.match(bootstrap, /timer\.unref\?\.\(\)/);
  assert.match(bootstrap, /first paint is not blocked/);
});

test('V93 resume guard remains registered before server without running a startup rekey scan', () => {
  const guardImport = bootstrap.indexOf("importPhase('v93ShopeeResumeResiliencePatch'");
  const serverCall = bootstrap.indexOf("await importPhase('server', './server.js')");
  assert.ok(guardImport >= 0 && guardImport < serverCall, 'V93 request-time resume guard must be installed before routes register');
  assert.doesNotMatch(bootstrap, /\.prepareShopeeResumeAudit\s*\(/);
});
