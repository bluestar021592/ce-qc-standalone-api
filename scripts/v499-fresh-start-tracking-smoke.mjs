import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

for (const file of [
  'src/v499FreshStartTrackingPolicy.js',
  'src/v206InteractiveFirstRuntimePatch.js',
  'src/v246QcTrackingRuntimePatch.js',
  'scripts/CE_QC_PurgeDeleteWorker.mjs',
  'src/v105AsyncPurgePatch.js'
]) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });

const read = file => fs.readFileSync(file, 'utf8');
const policy = read('src/v499FreshStartTrackingPolicy.js');
const v206 = read('src/v206InteractiveFirstRuntimePatch.js');
const runtime = read('src/v246QcTrackingRuntimePatch.js');
const worker = read('scripts/CE_QC_PurgeDeleteWorker.mjs');
const purgePatch = read('src/v105AsyncPurgePatch.js');

assert.match(policy, /V499_FRESH_START_TRACKING_POLICY_ID='2026-09-10-v499-fresh-start-v246-auto-tracking-v1'/);
assert.match(policy, /CE_QC_HARD_DISABLE_V246_TRACKING/);
assert.match(policy, /delete process\.env\.CE_QC_DISABLE_V246_TRACKING/);
const policyImport = v206.indexOf("import './v499FreshStartTrackingPolicy.js';");
const runtimeImport = v206.indexOf("import './v246QcTrackingRuntimePatch.js';");
assert.ok(policyImport >= 0 && runtimeImport > policyImport, 'V499 must clear the temporary managed-bootstrap disable flag before V246 runtime evaluates');

assert.match(runtime, /HOURLY_ANTI_LEAK_RECONCILE/);
assert.match(runtime, /if\(clock\.minuteOfDay<120\)return/);
assert.match(runtime, /fromDate:addDays\(clock\.date,-29\),toDate:clock\.date,days:30/);
assert.match(runtime, /CAMBODIA_0200_30DAY_AUTO/);
assert.match(runtime, /v246_daily_0200_success_date/);

assert.match(worker, /key LIKE 'v246_daily_0200_%'/, 'clean purge must reset V246 02:00 success/failure state');
assert.match(purgePatch, /CE_QC_PurgeDeleteWorker\.mjs/);
assert.match(purgePatch, /runIsolatedExecute/);

const enabledProbe = execFileSync(process.execPath, ['--input-type=module', '-e', `
  process.env.CE_QC_DISABLE_V246_TRACKING='1';
  const m=await import('./src/v499FreshStartTrackingPolicy.js?probe=enabled');
  process.stdout.write(JSON.stringify(m.inspectV499FreshStartTrackingPolicy()));
`], { cwd: process.cwd(), encoding: 'utf8' }).trim().split(/\r?\n/).at(-1);
const enabled = JSON.parse(enabledProbe);
assert.equal(enabled.inheritedDisable, true);
assert.equal(enabled.hardDisable, false);
assert.equal(enabled.v246Enabled, true, 'managed recovery flag must not disable production V246 freshness tracking');

const disabledProbe = execFileSync(process.execPath, ['--input-type=module', '-e', `
  process.env.CE_QC_DISABLE_V246_TRACKING='1';
  process.env.CE_QC_HARD_DISABLE_V246_TRACKING='1';
  const m=await import('./src/v499FreshStartTrackingPolicy.js?probe=hard-disabled');
  process.stdout.write(JSON.stringify(m.inspectV499FreshStartTrackingPolicy()));
`], { cwd: process.cwd(), encoding: 'utf8' }).trim().split(/\r?\n/).at(-1);
const disabled = JSON.parse(disabledProbe);
assert.equal(disabled.hardDisable, true);
assert.equal(disabled.v246Enabled, false, 'explicit emergency hard-disable must remain available');

console.log('[V499] fresh-start tracking gate passed · managed startup enables V246 hourly/02:00 tracking · explicit hard stop preserved · isolated full purge resets V246 daily scheduler state');
