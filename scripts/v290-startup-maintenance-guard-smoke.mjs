import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const runtime=fs.readFileSync('src/v206InteractiveFirstRuntimePatch.js','utf8');
const guard=fs.readFileSync('src/v290StartupMaintenanceGuard.js','utf8');
const grace=fs.readFileSync('src/v290InteractiveStartupGrace.js','utf8');
const launcher=fs.readFileSync('src/v290MaintenanceChildLauncher.js','utf8');
const worker=fs.readFileSync('src/v290MaintenanceWorker.js','utf8');
const v254=fs.readFileSync('src/v254StorageHealthPatch.js','utf8');
const v266=fs.readFileSync('src/v266EvergreenEvidenceArchive.js','utf8');
const v281=fs.readFileSync('src/v281ArchivedHistoricalReparse.js','utf8');
const v283=fs.readFileSync('src/v283LegacyDecoratedHashReplay.js','utf8');
const v283Retry=fs.readFileSync('src/v283LegacyDecoratedHashReplayRetry.js','utf8');
const v284Audit=fs.readFileSync('src/v284DailyMembershipAudit.js','utf8');
const v284Priority=fs.readFileSync('src/v284PriorityUnprovenRefresh.js','utf8');
const v252=fs.readFileSync('src/v252LifecycleCoordinator.js','utf8');
const v246=fs.readFileSync('src/v246QcTrackingRuntimePatch.js','utf8');
const v262=fs.readFileSync('src/v262ShopeeStrictEvidenceBackfill.js','utf8');
const v264=fs.readFileSync('src/v264TbkhOpenAttemptLifecycle.js','utf8');

for(const file of [
  'src/v290InteractiveStartupGrace.js',
  'src/v290MaintenanceChildLauncher.js',
  'src/v290MaintenanceWorker.js',
  'src/v290StartupMaintenanceGuard.js',
  'src/v206InteractiveFirstRuntimePatch.js'
]) execFileSync(process.execPath,['--check',file],{stdio:'inherit'});

const guardImport="import './v290StartupMaintenanceGuard.js';";
const firstRuntimeDependency=runtime.split('\n').find(line=>/^import '\.\//.test(line.trim()));
assert.equal(firstRuntimeDependency?.trim(),guardImport,'V290 guard must be the first CE-QC runtime dependency before any maintenance module can register timers');
assert.match(grace,/MIN_GRACE_MS=5\*60_000/,'interactive startup grace must never be shorter than five minutes');
assert.match(grace,/Math\.max\(MIN_GRACE_MS/,'environment overrides must not shorten the five-minute safety floor');

for(const [name,marker] of [
  ['V266 seed','seedExistingImportTemps'],
  ['V281','replayV281ArchivedReportDate'],
  ['V283','replayV283LegacyDecoratedHash'],
  ['V284 audit','auditV284PriorityRange'],
  ['V284 priority','refreshV284PriorityUnproven'],
  ['V254 storage','const report=buildReport()']
]) assert.ok(guard.includes(marker),`${name} automatic startup work must be recognized by V290`);
for(const task of ['v281-replay','v283-replay','v284-audit','v284-priority','v254-storage'])assert.ok(guard.includes(`child:'${task}'`),`${task} must be relocated to the maintenance child`);
assert.match(guard,/V283_LEGACY_REPLAY_PRIMARY[\s\S]*whenDelay:d=>Number\(d\)<30_000/,'V283 primary and post-seed retry must not collapse onto one child launch');
assert.match(guard,/V283_LEGACY_REPLAY_POST_SEED[\s\S]*whenDelay:d=>Number\(d\)>=30_000/,'V283 post-seed retry must remain later than the primary replay');
assert.match(launcher,/spawn\(process\.execPath/,'V290 must launch isolated Node child processes rather than execute heavy automatic work on the 5177 event loop');
assert.match(launcher,/SQLITE_CACHE_KIB:'8192'/,'maintenance child must use a bounded SQLite cache');
for(const task of ['v281-replay','v283-replay','v284-audit','v284-priority','v254-storage'])assert.ok(worker.includes(`case '${task}'`),`${task} worker case must exist`);

assert.match(guard,/V252_STARTUP_90DAY_ADMISSION_AUDIT/,'V252 startup 90-day admission audit must be delayed');
assert.match(guard,/V262_STARTUP_OR_REQUESTED_EVIDENCE/,'V262 startup/dashboard-requested evidence backfill must be delayed');
assert.match(guard,/V264_TBKH_STARTUP_AUTO/,'V264 TBKH automatic startup work must be delayed');
assert.match(guard,/V246_STARTUP_90DAY/,'V246 startup 90-day anti-leak must be delayed');
assert.match(guard,/V252_LIFECYCLE_POLL[\s\S]*notBefore:720_000/,'V252 60s interval must start after its startup audit instead of beating it');
assert.match(guard,/V264_TBKH_CONTINUOUS_POLL[\s\S]*notBefore:900_000/,'V264 60s interval must start after its startup task');
assert.match(guard,/V246_SCHEDULER_POLL[\s\S]*notBefore:960_000/,'V246 60s scheduler must not trigger the 188k-row anti-leak audit during first paint or alongside its startup audit');

// Protect against future source changes silently escaping the guard.
assert.match(v266,/setTimeout\(\(\)=>void seedExistingImportTemps\(\),30_000\)/,'V266 source still has the protected 30s seed callback');
assert.match(v254,/setTimeout\(\(\)=>\{[\s\S]*const report=buildReport\(\)/,'V254 source still has the protected synchronous storage scan callback');
assert.match(v281,/setTimeout[\s\S]*replayV281ArchivedReportDate/);
assert.match(v283,/setTimeout[\s\S]*replayV283LegacyDecoratedHash/);
assert.match(v283Retry,/setTimeout[\s\S]*replayV283LegacyDecoratedHash/);
assert.match(v284Audit,/setTimeout\(\(\)=>auditV284PriorityRange/);
assert.match(v284Priority,/setTimeout\(\(\)=>refreshV284PriorityUnproven/);
assert.match(v252,/setTimeout\(\(\)=>\{try\{const result=lightweightLedgerAudit\(90,'V252_STARTUP_90DAY_ADMISSION_AUDIT'/);
assert.match(v246,/setInterval\(\(\)=>scheduledTick\(\)/);
assert.match(v262,/setTimeout\(async\(\)=>\{const r=await runV262ShopeeStrictEvidenceBackfill/);
assert.match(v264,/setInterval\(\(\)=>runV264TbkhOpenAttemptLifecycle\(\{reason:'CONTINUOUS_POLL'\}\)/);

assert.match(runtime,/primeDashboardCacheInChild\(delayMs = 5 \* 60_000\)/,'dashboard cache child must also respect first-paint grace');
assert.match(runtime,/v289-known-good-first-paint-runtime-v1/,'V290 must preserve the V289 known-good first-paint structure marker');
assert.match(runtime,/V284\/V286 daily-membership truth/,'first-paint protection must not be a data-truth rollback');

console.log('[V290] first-paint maintenance guard smoke passed · V254/V281/V283/V284 child isolation + V266/V246/V252/V262/V264 startup staggering + five-minute minimum grace');
