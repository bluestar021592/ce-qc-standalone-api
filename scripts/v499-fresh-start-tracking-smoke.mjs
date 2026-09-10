import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

for (const file of [
  'src/v499FreshStartTrackingPolicy.js',
  'src/v206InteractiveFirstRuntimePatch.js',
  'src/v246QcTrackingRuntimePatch.js',
  'src/dataPurge.js',
  'scripts/CE_QC_PurgeDeleteWorker.mjs',
  'src/v105AsyncPurgePatch.js'
]) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });

const read = file => fs.readFileSync(file, 'utf8');
const policy = read('src/v499FreshStartTrackingPolicy.js');
const v206 = read('src/v206InteractiveFirstRuntimePatch.js');
const runtime = read('src/v246QcTrackingRuntimePatch.js');
const directPurge = read('src/dataPurge.js');
const worker = read('scripts/CE_QC_PurgeDeleteWorker.mjs');
const purgePatch = read('src/v105AsyncPurgePatch.js');

assert.match(policy, /V499_FRESH_START_TRACKING_POLICY_ID='2026-09-10-v500-managed-fresh-start-v246-gate-v1'/);
assert.match(policy, /V499_FRESH_START_READY_KEY='v499_fresh_start_tracking_ready'/);
assert.match(policy, /waitingForFreshStart/);
assert.match(policy, /CE_QC_HARD_DISABLE_V246_TRACKING/);
assert.match(policy, /freshStartReady\)delete process\.env\.CE_QC_DISABLE_V246_TRACKING/);
const policyImport = v206.indexOf("import './v499FreshStartTrackingPolicy.js';");
const runtimeImport = v206.indexOf("import './v246QcTrackingRuntimePatch.js';");
assert.ok(policyImport >= 0 && runtimeImport > policyImport, 'V500 policy must evaluate before V246 runtime');

assert.match(runtime, /STARTUP_90DAY_ANTI_LEAK/);
assert.match(runtime, /HOURLY_ANTI_LEAK_RECONCILE/);
assert.match(runtime, /if\(clock\.minuteOfDay<120\)return/);
assert.match(runtime, /fromDate:addDays\(clock\.date,-29\),toDate:clock\.date,days:30/);
assert.match(runtime, /CAMBODIA_0200_30DAY_AUTO/);
assert.match(runtime, /v246_daily_0200_success_date/);

assert.match(directPurge, /key LIKE 'v246_daily_0200_%'/, 'direct full purge must reset V246 02:00 success/failure state');
assert.match(worker, /key LIKE 'v246_daily_0200_%'/, 'isolated clean purge must reset V246 02:00 success/failure state');
assert.match(worker, /meta\.run\(FRESH_START_READY_KEY,'1',now\)/, 'isolated full purge must arm fresh-start tracking for the next managed restart');
assert.match(purgePatch, /CE_QC_PurgeDeleteWorker\.mjs/);
assert.match(purgePatch, /runIsolatedExecute/);

const blockedProbe = execFileSync(process.execPath, ['--input-type=module', '-e', `
  process.env.CE_QC_DISABLE_V246_TRACKING='1';
  process.env.CE_QC_V499_FRESH_START_READY_OVERRIDE='0';
  const m=await import('./src/v499FreshStartTrackingPolicy.js?probe=blocked');
  process.stdout.write(JSON.stringify(m.inspectV499FreshStartTrackingPolicy()));
`], { cwd: process.cwd(), encoding: 'utf8' }).trim().split(/\r?\n/).at(-1);
const blocked = JSON.parse(blockedProbe);
assert.equal(blocked.inheritedDisable, true);
assert.equal(blocked.hardDisable, false);
assert.equal(blocked.freshStartReady, false);
assert.equal(blocked.waitingForFreshStart, true);
assert.equal(blocked.v246Enabled, false, 'managed legacy startup must not unleash V246 heavy reconciliation before clean purge');

const enabledProbe = execFileSync(process.execPath, ['--input-type=module', '-e', `
  process.env.CE_QC_DISABLE_V246_TRACKING='1';
  process.env.CE_QC_V499_FRESH_START_READY_OVERRIDE='1';
  const m=await import('./src/v499FreshStartTrackingPolicy.js?probe=enabled');
  process.stdout.write(JSON.stringify(m.inspectV499FreshStartTrackingPolicy()));
`], { cwd: process.cwd(), encoding: 'utf8' }).trim().split(/\r?\n/).at(-1);
const enabled = JSON.parse(enabledProbe);
assert.equal(enabled.inheritedDisable, true);
assert.equal(enabled.hardDisable, false);
assert.equal(enabled.freshStartReady, true);
assert.equal(enabled.waitingForFreshStart, false);
assert.equal(enabled.v246Enabled, true, 'after verified fresh purge, managed restart must enable V246 freshness tracking');

const disabledProbe = execFileSync(process.execPath, ['--input-type=module', '-e', `
  process.env.CE_QC_DISABLE_V246_TRACKING='1';
  process.env.CE_QC_HARD_DISABLE_V246_TRACKING='1';
  process.env.CE_QC_V499_FRESH_START_READY_OVERRIDE='1';
  const m=await import('./src/v499FreshStartTrackingPolicy.js?probe=hard-disabled');
  process.stdout.write(JSON.stringify(m.inspectV499FreshStartTrackingPolicy()));
`], { cwd: process.cwd(), encoding: 'utf8' }).trim().split(/\r?\n/).at(-1);
const disabled = JSON.parse(disabledProbe);
assert.equal(disabled.hardDisable, true);
assert.equal(disabled.v246Enabled, false, 'explicit emergency hard-disable must remain available');

console.log('[V500] managed fresh-start gate passed · legacy managed startup keeps V246 heavy audit disabled · isolated purge arms tracking · next managed restart enables hourly/02:00 tracking · explicit hard stop preserved');