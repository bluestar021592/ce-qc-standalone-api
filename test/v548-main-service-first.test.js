import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const bootstrapFile = path.join(root, 'bootstrap.js');

function source() {
  return fs.readFileSync(bootstrapFile, 'utf8');
}

test('V548 bootstrap remains syntax-valid', () => {
  const check = spawnSync(process.execPath, ['--check', bootstrapFile], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
});

test('V548 keeps the 5178 export sidecar off normal startup and exposes on-demand start', () => {
  const text = source();
  assert.match(text, /2026-09-15-v548-main-service-first-v1/);
  assert.match(text, /CE_QC_ENABLE_EXPORT_SIDECAR_AT_STARTUP/);
  assert.match(text, /function scheduleExportSidecar\(\)/);
  assert.match(text, /ON_DEMAND_ONLY/);
  assert.match(text, /globalThis\.__CE_QC_START_EXPORT_SIDECAR__/);

  const serverReady = text.lastIndexOf('await importServerInteractiveFirst();');
  const sidecarPolicy = text.lastIndexOf('scheduleExportSidecar();');
  assert.ok(serverReady >= 0, 'main server startup must remain present');
  assert.ok(sidecarPolicy > serverReady, 'sidecar policy must be applied only after the main server is ready');

  assert.doesNotMatch(
    text,
    /process\.once\('exit',[\s\S]{0,180}?\}\);\s*startExportSidecar\(\);/,
    'the old eager pre-server export-sidecar launch must not return'
  );
});

test('V548 skips the V167 startup repair in recovery/interactive-first mode', () => {
  const text = source();
  assert.match(text, /CE_QC_POST_SERVER_REPAIR_DELAY_MS/);
  assert.match(text, /function schedulePostServerRepair\(v167Repair\)/);
  assert.match(text, /CE_QC_SKIP_STARTUP_POD_REPAIR/);
  assert.match(text, /STARTUP_REPAIR_DISABLED/);
  assert.match(text, /setTimeout\(\(\) => \{[\s\S]*repairLatestCcslPodLockFacts\(\)/);

  const serverReady = text.lastIndexOf('await importServerInteractiveFirst();');
  const repairSchedule = text.lastIndexOf('schedulePostServerRepair(v167Repair);');
  assert.ok(repairSchedule > serverReady, 'V167 repair must be scheduled after server startup');
  assert.doesNotMatch(
    text.slice(serverReady, repairSchedule),
    /repairLatestCcslPodLockFacts\(\)/,
    'V167 repair must not execute synchronously between server startup and its deferred schedule'
  );
});
