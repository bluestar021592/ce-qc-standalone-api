import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v44WhppUiPatch.js','public/runtime-loader.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const shell=fs.readFileSync('src/v44WhppUiPatch.js','utf8');
const loader=fs.readFileSync('public/runtime-loader.js','utf8');

assert.match(shell,/CORE_UI_LOADER_ID='system-route-aware-ui-loader-v1'/);
assert.match(shell,/runtime-loader\.js\?v=system-runtime-loader-v1/,'HTML shell must inject one route-aware runtime loader');
assert.doesNotMatch(shell,/v49-dashboard-correctness\.js[^\n]*<script/,'legacy dashboard scripts must not be synchronously injected by the HTML owner');
assert.doesNotMatch(shell,/v132-whpp-seven-business-fast\.js[^\n]*<script/,'WHPP runtime must not be synchronously injected on every page');
assert.doesNotMatch(shell,/v190-export-direct-route-client\.js[^\n]*<script/,'export runtime must not be synchronously injected on every page');

assert.match(loader,/const ordered=\{/,'loader must own one ordered manifest');
for(const group of ['core','dashboard','processing','whpp','export'])assert.match(loader,new RegExp(`${group}:\\[`),`missing ${group} route group`);
assert.match(loader,/if\(loaded\.has\(id\)\|\|scriptAlreadyPresent\(src\)\)/,'each public feature script must execute at most once');
assert.match(loader,/requestIdleCallback/,'noncritical route activation should yield first paint when the browser supports idle callbacks');
assert.match(loader,/ce-qc:route-changed/,'SPA navigation must activate newly required route features');
assert.match(loader,/p==='\/whpp'[\s\S]*groups\.push\('whpp','dashboard','processing'\)/,'WHPP features must stay route scoped');
assert.match(loader,/\['\/reports','\/logs'\][\s\S]*groups\.push\('export','dashboard'\)/,'export/history features must stay report/log scoped');

const manifestPaths=[...loader.matchAll(/['"](\/[^'"]+\.js\?[^'"]+)['"]/g)].map(match=>match[1]);
assert.equal(new Set(manifestPaths.map(path=>path.split('?')[0])).size,manifestPaths.length,'runtime manifest must not contain duplicate script owners');
assert.ok(manifestPaths.length>=30,'consolidation loader must account for the retained compatibility feature set before deletion');

console.log('[SYSTEM UI LOADER] passed · HTML synchronous legacy chain removed · route groups single-load · WHPP/export/processing deferred until relevant routes');