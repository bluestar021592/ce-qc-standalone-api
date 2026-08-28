const fs=require('fs');const assert=require('assert/strict');const {execFileSync}=require('child_process');
for(const file of ['src/v328ThreeBusinessHistoryFast.js','src/v329ThreeBusinessDailyCache.js','src/v328EvidenceRepairCoordinator.js','scripts/v329-three-business-cache-worker.mjs','scripts/v328-three-business-evidence-worker-v2.mjs','src/v308DeliveryDailyFastPath.js','public/v308-dashboard-read-bridge.js','src/shopeeAttemptCycleV246.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const legacy=fs.readFileSync('src/v328ThreeBusinessHistoryFast.js','utf8'),cache=fs.readFileSync('src/v329ThreeBusinessDailyCache.js','utf8'),coordinator=fs.readFileSync('src/v328EvidenceRepairCoordinator.js','utf8'),worker=fs.readFileSync('scripts/v329-three-business-cache-worker.mjs','utf8'),backend=fs.readFileSync('src/v308DeliveryDailyFastPath.js','utf8'),ui=fs.readFileSync('public/v308-dashboard-read-bridge.js','utf8'),attempt=fs.readFileSync('src/shopeeAttemptCycleV246.js','utf8');
assert.match(legacy,/NULLIF\(ledgerPodDate,''\)/,'legacy isolated builder still requires real POD evidence');
assert.doesNotMatch(legacy,/CASE WHEN finalPod=1 THEN NULLIF\(latestEventTime,''\) ELSE '' END/,'ordinary latestEventTime cannot impersonate POD');
assert.match(cache,/实际POD日期-首次日报锁定日期\+1|actual POD|首次日报锁定日期/);
assert.match(cache,/signingComplete/);
assert.match(worker,/l\.signingDays/);
assert.match(worker,/firstReportDate/);
assert.match(worker,/inclusive\(start,p\)/);
assert.match(coordinator,/v329-three-business-cache-worker\.mjs/);
assert.doesNotMatch(backend,/readV328ThreeBusinessHistory/,'main web route must not run the heavy legacy builder');
assert.match(ui,/平均签收天数=实际POD日期−首次日报锁定日期\+1/);

// Guard the actual dispatch-attempt behavior instead of a fixed Chinese UI sentence.
// Attempt 1 starts on the first real START; only failure/Pending evidence may allow a later START to advance the attempt number.
assert.match(attempt,/function isDeliveryStart\(event = \{\}\) \{ return eventCode\(event\) === '70'; \}/);
assert.match(attempt,/function isAssignStart\(event = \{\}\) \{ return eventCode\(event\) === '60'; \}/);
assert.match(attempt,/function isFailure\(event = \{\}\) \{ return eventCode\(event\) === '150' \|\| FAILURE_RE\.test\(eventText\(event\)\); \}/);
assert.match(attempt,/const hasDelivery70 = sorted\.some\(isDeliveryStart\)/);
assert.match(attempt,/const isStart = hasDelivery70 \? isDeliveryStart : isAssignStart/);
assert.match(attempt,/let failedSinceStart = false/);
assert.match(attempt,/else if \(failedSinceStart\)/,'a repeated START must not increment unless failure evidence occurred after the prior START');
assert.match(attempt,/if \(attemptNo > 0 && isFailure\(event\)\) \{[\s\S]*failedSinceStart = true/,'Pending or delivery-failure evidence must arm the next START as the next attempt');
assert.match(attempt,/attemptNo = Math\.min\(3, attemptNo \+ 1\)/,'attempt number must remain capped at 3 where 3 means 3+');

console.log('[V329] metric guard passed · visible average=first report lock→actual POD inclusive · strict START/failure attempt behavior locked in source · heavy history builder isolated from web process');
