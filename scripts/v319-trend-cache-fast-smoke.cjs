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

assert.match(backend,/2026-08-26-v320-history-dispatch-overlay-trend-v3/);
assert.match(backend,/\/api\/v319\/trends/,'V319 compatibility endpoint must remain registered');
assert.match(backend,/readV320HistoricalDailyWithDispatch/,'V319 endpoint must delegate to V320 persisted history plus dispatch overlay');
assert.match(backend,/v320EvidenceAutoBackfill\.js/,'real runtime must activate bounded terminal-POD evidence backfill');
assert.match(history,/shipment_daily_snapshots/,'historical trend authority must include preserved daily snapshots');
assert.match(history,/business_daily_parse_rows/,'historical trend authority must include legacy business daily rows');
assert.match(history,/business_history_summary/,'date census must retain old business history summaries');
assert.match(history,/history_summary/,'date census must retain old CCSL history summaries');
assert.match(history,/expandSingle/,'one selected current day may expand only the history panel, not current cards');
assert.match(overlay,/json_extract\(l\.evidenceJson,'\$\.starts\[0\]\.time'\)/,'saved strict START evidence must feed dispatch-day averages without a network read');
assert.match(overlay,/signingCount>0/,'a real signing sample must publish even when coverage is partial');
assert.match(backfill,/const CHUNK=50,CONCURRENCY=4/,'missing terminal POD evidence must backfill in bounded 50-ticket x4 concurrency');
assert.match(backfill,/client\.trackQuery\(bills\)/,'background repair must use the canonical track query');
assert.match(backfill,/applyV246StrictAttemptEvidence/,'background repair must persist audited strict attempt evidence');
assert.match(backfill,/firstAttemptAt=CASE/,'background repair must write the real first dispatch START back to persisted final rows');
assert.match(backfill,/REAL_RUNTIME/,'launcher smoke processes must not start live CE network backfill');
assert.doesNotMatch(history,/trackQuery|confirmQuery|exceptionQuery|axios|fetch\(/,'visible V320 history read must not execute CE network calls');

assert.match(client,/2026-08-26-v319-cache-only-exact-trend-client-v1/);
assert.match(client,/TARGET='\/api\/v253\/trends'/,'legacy V299/V307 request interception must remain narrow');
assert.match(client,/REPLACEMENT='\/api\/v319\/trends'/,'legacy trend reads must still redirect to the V319 compatibility endpoint');
assert.match(client,/if\(response\.status!==404\)return response/,'a real V319/V320 response must never fall into heavyweight V253');
assert.doesNotMatch(client,/preventDefault|stopPropagation|stopImmediatePropagation/,'trend routing must not interfere with navigation');

assert.match(owner,/2026-08-26-v320-full-history-trend-owner-v1/);
assert.match(owner,/\/api\/v319\/trends/,'final visible owner must read the persisted-history endpoint');
assert.match(owner,/平均派件→签收天数趋势/,'Shopee/TBKH trend must support real dispatch→POD average days');
assert.match(owner,/已显示.*个已保存日报日期/,'visible status must report how many historical report dates were drawn');
assert.doesNotMatch(owner,/\/api\/v273\/trends|\/api\/v263\/delivery-trends|trackQuery|confirmQuery/,'final V320 trend owner must not start strict/network work');

assert.match(activation,/import '\.\/v319TrendCacheFastPatch\.js';[\s\S]*import '\.\/v295FirstAttemptUiInjectionPatch\.js';/,'V319/V320 backend route must activate before UI injection');
assert.match(injection,/V319_TREND_CACHE_MARKER[\s\S]*V320_HISTORY_TREND_MARKER/,'V320 visible history owner must load after the V319 route shim');
assert.match(injection,/v320-history-trend-owner\.js\?v=20260826-v320-1/,'V320 visible owner must be cache-busted');
assert.match(injection,/X-CE-QC-V320-UI/,'V320 must be observable in response headers');

console.log('[V319/V320] trend routing smoke passed · full persisted history + saved strict dispatch overlay + bounded auto evidence backfill · no CE work on page navigation');
