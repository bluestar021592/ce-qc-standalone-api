const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');

for(const file of ['src/v319TrendCacheFastPatch.js','public/v319-trend-cache-first.js','src/v147TrackTimeoutConfig.js','src/v295FirstAttemptUiInjectionPatch.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const backend=fs.readFileSync('src/v319TrendCacheFastPatch.js','utf8');
const client=fs.readFileSync('public/v319-trend-cache-first.js','utf8');
const activation=fs.readFileSync('src/v147TrackTimeoutConfig.js','utf8');
const injection=fs.readFileSync('src/v295FirstAttemptUiInjectionPatch.js','utf8');

assert.match(backend,/2026-08-26-v319-cache-only-exact-trend-v1/);
assert.match(backend,/\/api\/v319\/trends/,'V319 fast trend endpoint must be registered');
assert.match(backend,/readV236CurrentSummary\(date,\{cacheOnly:true\}\)/,'first-paint trends must read only persisted dashboard cache truth');
assert.match(backend,/if\(explicitFrom\)/,'explicit selected range must not silently expand to recent seven days');
assert.match(backend,/reportDate BETWEEN \? AND \?/,'explicit date range must remain exact');
assert.match(backend,/ticket:daily\.map\(row=>n\(row\.total\)\)/,'ticket trend remains visible even while stricter evidence readiness is incomplete');
assert.match(backend,/missingDates:daily\.filter\(row=>!row\.ready\)/,'incomplete evidence must remain explicit rather than fabricated');
assert.doesNotMatch(backend,/readV253DashboardTrends|readV284ProvenDashboardTrends|client\.|trackQuery|confirmQuery/,'V319 page read must not execute heavyweight reconciliation or CE network calls');

assert.match(client,/2026-08-26-v319-cache-only-exact-trend-client-v1/);
assert.match(client,/TARGET='\/api\/v253\/trends'/,'only the legacy V299/V307 trend endpoint is intercepted');
assert.match(client,/REPLACEMENT='\/api\/v319\/trends'/,'legacy trend reads must be transparently redirected to V319');
assert.match(client,/if\(!isTarget\(input\)\)return originalFetch\(input,init\)/,'all unrelated requests must remain untouched');
assert.match(client,/if\(response\.status!==404\)return response/,'a real V319 response must never fall through to the heavyweight legacy query');
assert.match(client,/return originalFetch\(input,init\)/,'404 compatibility fallback must retain V253 as last resort');
assert.doesNotMatch(client,/preventDefault|stopPropagation|stopImmediatePropagation/,'trend routing must not interfere with UI navigation');

assert.match(activation,/import '\.\/v319TrendCacheFastPatch\.js';[\s\S]*import '\.\/v295FirstAttemptUiInjectionPatch\.js';/,'backend V319 route must activate before UI injection wiring');
assert.match(injection,/V318_SINGLE_SIDEBAR_MARKER[\s\S]*V319_TREND_CACHE_MARKER/,'V319 browser shim must load after V318 sidebar owner');
assert.match(injection,/v319-trend-cache-first\.js\?v=20260826-v319-1/,'V319 UI must be cache-busted');
assert.match(injection,/X-CE-QC-V319-UI/,'V319 must remain observable in response headers');

console.log('[V319] trend cache-fast smoke passed · exact selected range · cache-only first paint · V253 fallback only on 404 · no CE/evidence work on page navigation');
