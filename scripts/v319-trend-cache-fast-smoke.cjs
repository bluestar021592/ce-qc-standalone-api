const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');

for(const file of ['src/v319TrendCacheFastPatch.js','src/v320HistoricalDailyTruth.js','src/v320DispatchMetricOverlay.js','src/v320EvidenceAutoBackfill.js','public/v319-trend-cache-first.js','public/v320-history-trend-owner.js','src/v147TrackTimeoutConfig.js','src/v295FirstAttemptUiInjectionPatch.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const backend=fs.readFileSync('src/v319TrendCacheFastPatch.js','utf8');
const history=fs.readFileSync('src/v320HistoricalDailyTruth.js','utf8');
const overlay=fs.readFileSync('src/v320DispatchMetricOverlay.js','utf8');
const backfill=fs.readFileSync('src/v320EvidenceAutoBackfill.js','utf8');
const client=fs.readFileSync('public/v319-trend-cache-first.js','utf8');
const owner=fs.readFileSync('public/v320-history-trend-owner.js','utf8');
const activation=fs.readFileSync('src/v147TrackTimeoutConfig.js','utf8');
const injection=fs.readFileSync('src/v295FirstAttemptUiInjectionPatch.js','utf8');

assert.match(backend,/2026-08-26-v321-exact-range-availability-first-v2/);
assert.match(backend,/\/api\/v319\/trends/,'V319 compatibility endpoint must remain registered');
assert.match(backend,/readV320HistoricalDailyWithDispatch/,'trend endpoint must still use persisted history + dispatch overlay');
assert.match(backend,/expandSingle:false/,'one selected day must stay one day and never trigger implicit full-history scans');
assert.doesNotMatch(backend,/import '\.\/v320EvidenceAutoBackfill\.js'/,'web route must not auto-load terminal-POD network backfill during startup');
assert.match(history,/shipment_daily_snapshots/,'persisted historical authority must remain available for explicit ranges');
assert.match(history,/business_daily_parse_rows/,'legacy Shopee daily rows must remain available for explicit ranges');
assert.match(overlay,/json_extract\(l\.evidenceJson,'\$\.starts\[0\]\.time'\)/,'saved strict START evidence must feed dispatch averages without a network read');
assert.match(overlay,/signingCount>0/,'a real signing sample must publish even when coverage is partial');
assert.match(backfill,/const CHUNK=50,CONCURRENCY=4/,'manual/background repair implementation must remain bounded');
assert.match(backfill,/runV320EvidenceBackfillNow/,'evidence repair capability remains available outside page-entry ownership');
assert.doesNotMatch(history,/trackQuery|confirmQuery|exceptionQuery|axios|fetch\(/,'visible persisted reads must not execute CE network calls');

assert.match(client,/2026-08-26-v319-cache-only-exact-trend-client-v1/);
assert.match(client,/TARGET='\/api\/v253\/trends'/);
assert.match(client,/REPLACEMENT='\/api\/v319\/trends'/);
assert.match(client,/if\(response\.status!==404\)return response/,'a real exact-range response must never fall into heavyweight V253');

assert.match(owner,/2026-08-26-v321-exact-range-trend-owner-v1/);
assert.match(owner,/\/api\/v319\/trends/);
assert.match(owner,/平均派件→签收天数趋势/);
assert.match(owner,/已显示.*个所选日报日期/,'visible status must reflect explicit selected dates');
assert.doesNotMatch(owner,/\[1800,3500\]/,'retired forced follow-up scans must not return');
assert.doesNotMatch(owner,/setInterval\(\(\)=>apply\(false\),2500\)/,'2.5s polling must remain retired');
assert.doesNotMatch(owner,/\/api\/v273\/trends|\/api\/v263\/delivery-trends|trackQuery|confirmQuery/);

assert.match(activation,/import '\.\/v319TrendCacheFastPatch\.js';[\s\S]*import '\.\/v295FirstAttemptUiInjectionPatch\.js';/,'exact-range route must activate before UI injection');
assert.match(injection,/V319_TREND_CACHE_MARKER[\s\S]*V320_HISTORY_TREND_MARKER/);
assert.match(injection,/v320-history-trend-owner\.js\?v=20260826-v321-1/,'availability-first owner must be cache-busted');
assert.match(injection,/X-CE-QC-V321-UI/,'V321 must be observable in response headers');

console.log('[V321] trend availability smoke passed · exact selected range only · no startup auto-backfill · no forced history rescan/polling · saved dispatch truth retained');
