import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const runtime=fs.readFileSync('src/v206InteractiveFirstRuntimePatch.js','utf8');
const guard=fs.readFileSync('src/v290StartupMaintenanceGuard.js','utf8');
const grace=fs.readFileSync('src/v290InteractiveStartupGrace.js','utf8');
const launcher=fs.readFileSync('src/v290MaintenanceChildLauncher.js','utf8');
const worker=fs.readFileSync('src/v290MaintenanceWorker.js','utf8');
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
  ['V281','replayV281ArchivedReportDate'],
  ['V283','replayV283LegacyDecoratedHash'],
  ['V284 audit','auditV284PriorityRange'],
  ['V284 priority','refreshV284PriorityUnproven']
]) assert.ok(guard.includes(marker),`${name} automatic startup work must be recognized by V290`);
for(const task of ['v281-replay','v283-replay','v284-audit','v284-priority'])assert.ok(guard.includes(`child:'${task}'`),`${task} must be relocated to the maintenance child`);
assert.match(launcher,/spawn\(process\.execPath/,'V290 must launch isolated Node child processes rather than execute V281/V283/V284 SQL on the 5177 event loop');
assert.match(launcher,/SQLITE_CACHE_KIB:'8192'/,'maintenance child must use a bounded SQLite cache');
assert.match(worker,/case 'v281-replay'/);assert.match(worker,/case 'v283-replay'/);assert.match(worker,/case 'v284-audit'/);assert.match(worker,/case 'v284-priority'/);

assert.match(guard,/V252_STARTUP_90DAY_ADMISSION_AUDIT/,'V252 startup 90-day admission audit must be delayed');
assert.match(guard,/V262_STARTUP_OR_REQUESTED_EVIDENCE/,'V262 startup/dashboard-requested evidence backfill must be delayed');
assert.match(guard,/V264_TBKH_STARTUP_AUTO/,'V264 TBKH automatic startup work must be delayed');
assert.match(guard,/V246_STARTUP_90DAY/,'V246 startup 90-day anti-leak must be delayed');
assert.match(guard,/V252_LIFECYCLE_POLL/,'V252 60s interval must not beat the startup delay');
assert.match(guard,/V264_TBKH_CONTINUOUS_POLL/,'V264 60s interval must not beat the startup delay');
assert.match(guard,/V246_SCHEDULER_POLL/,'V246 60s scheduler must not trigger the 188k-row anti-leak audit during first paint');

// Protect against future source changes silently escaping the guard.
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
assert.match(runtime,/V284\/V286 seven-business data truth remains preserved|V284\/V286 daily-membership truth/,'first-paint protection must not be a data-truth rollback');

console.log('[V290] first-paint maintenance guard smoke passed · V281/V283/V284 child isolation + V246/V252/V262/V264 startup staggering + five-minute minimum grace');
