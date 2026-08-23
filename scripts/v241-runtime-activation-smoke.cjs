const fs = require('fs');
const assert = require('assert/strict');

const bootstrap = fs.readFileSync('bootstrap.js', 'utf8');
const bridge = fs.readFileSync('src/v161UnifiedImportRuntimeTruthPatch.js', 'utf8');
const runtime = fs.readFileSync('src/v206InteractiveFirstRuntimePatch.js', 'utf8');
const route = fs.readFileSync('src/v236DashboardCurrentRoutePatch.js', 'utf8');

assert.match(bootstrap, /importPhase\('v161UnifiedImportRuntimeTruthPatch'/, 'bootstrap must load V161 before server');
assert.ok(
  bootstrap.indexOf("importPhase('v161UnifiedImportRuntimeTruthPatch'") < bootstrap.indexOf('importServerInteractiveFirst()'),
  'V161 runtime bridge must load before server registration'
);
assert.match(bridge, /^import '\.\/v206InteractiveFirstRuntimePatch\.js';/m, 'V161 must activate the V206 dashboard runtime bridge');
assert.match(runtime, /import '\.\/v234DashboardLiveTruthPatch\.js';/, 'V206 must activate V234 live truth');
assert.match(runtime, /import '\.\/v236DashboardCurrentRoutePatch\.js';/, 'V206 must activate V236 route owner');
assert.match(runtime, /import '\.\/v231MetricTruthUiInjectionPatch\.js';/, 'V206 must activate V240 UI injection');
assert.match(runtime, /dashboard cache prime child exit code=/, 'V239 child completion must remain observable');
assert.match(route, /path==='\/api\/v234\/trends'/, 'V236 must own the V234 trend endpoint');

console.log('[V241] dashboard runtime activation order passed: V161 -> V206/V239/V240 -> server -> V234 trends');
