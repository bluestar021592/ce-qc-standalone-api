const fs = require('fs');
const assert = require('assert/strict');

const bootstrap = fs.readFileSync('bootstrap.js', 'utf8');
const bridge = fs.readFileSync('src/v161UnifiedImportRuntimeTruthPatch.js', 'utf8');
const runtime = fs.readFileSync('src/v206InteractiveFirstRuntimePatch.js', 'utf8');
const route = fs.readFileSync('src/v236DashboardCurrentRoutePatch.js', 'utf8');
const worker = fs.readFileSync('src/dashboardCacheWorker.js', 'utf8');

const v161Load = bootstrap.match(/^\s*await importPhase\('v161UnifiedImportRuntimeTruthPatch'[^\n]*$/m);
const serverStartCalls = [...bootstrap.matchAll(/^\s*await importServerInteractiveFirst\(\);\s*$/gm)];

assert.ok(v161Load, 'bootstrap must load V161 before server');
assert.equal(serverStartCalls.length, 1, 'bootstrap must invoke importServerInteractiveFirst exactly once');
assert.ok(
  v161Load.index < serverStartCalls[0].index,
  'V161 runtime bridge must load before the actual server startup call'
);
assert.match(bridge, /^import '\.\/v206InteractiveFirstRuntimePatch\.js';/m, 'V161 must activate the V206 dashboard runtime bridge');
assert.match(runtime, /import '\.\/v234DashboardLiveTruthPatch\.js';/, 'V206 must activate V234 live truth');
assert.match(runtime, /import '\.\/v236DashboardCurrentRoutePatch\.js';/, 'V206 must activate V236 route owner');
assert.match(runtime, /import '\.\/v231MetricTruthUiInjectionPatch\.js';/, 'V206 must activate V240 UI injection');
assert.match(runtime, /dashboard cache prime child exit code=/, 'cache-prime child completion must remain observable');
assert.match(runtime, /MAX_PRIME_ATTEMPTS = 4/, 'transient startup skips must retry with a bounded attempt count');
assert.match(runtime, /FOREGROUND_PROCESSING_ACTIVE\|CACHE_OR_PURGE_WORKER_ALREADY_ACTIVE/, 'runtime must recognize retryable cache-prime skips');
assert.match(worker, /recentCompletedDashboardDates\(7\)/, 'startup worker must target the recent seven ready report dates');
assert.match(worker, /refreshV235CurrentDashboardCacheDate\(date, \{ force: true \}\)/, 'V242 startup must force rebuild old V240 seven-day cache rows');
assert.match(worker, /readV237DashboardTrends/, 'V243 worker must audit the same cache-only trend reader used by the UI');
assert.match(worker, /v243-post-rebuild-flat-series-audit-v1/, 'V243 trend audit id must be present');
assert.match(worker, /SUSPICIOUS_FLAT_SERIES/, 'V243 must explicitly flag suspicious all-flat percentage series');
assert.match(worker, /v243_trend_audit_latest/, 'V243 audit must persist its result for later diagnosis');
assert.match(worker, /V243_FORCED_RECENT_7_REBUILD_WITH_AUDIT/, 'worker result must expose the forced rebuild plus audit mode');
assert.match(route, /path==='\/api\/v234\/trends'/, 'V236 must own the V234 trend endpoint');

console.log('[V243] dashboard runtime activation + forced recent seven-day rebuild + bounded retry + post-rebuild flat-series audit passed');
