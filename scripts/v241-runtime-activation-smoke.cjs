const fs = require('fs');
const assert = require('assert/strict');

const bootstrap = fs.readFileSync('bootstrap.js', 'utf8');
const bridge = fs.readFileSync('src/v161UnifiedImportRuntimeTruthPatch.js', 'utf8');
const runtime = fs.readFileSync('src/v206InteractiveFirstRuntimePatch.js', 'utf8');
const route = fs.readFileSync('src/v236DashboardCurrentRoutePatch.js', 'utf8');

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
assert.match(runtime, /dashboard cache prime child exit code=/, 'V239 child completion must remain observable');
assert.match(route, /path==='\/api\/v234\/trends'/, 'V236 must own the V234 trend endpoint');

console.log('[V241] dashboard runtime activation order passed: V161 -> V206/V239/V240 -> server -> V234 trends');
