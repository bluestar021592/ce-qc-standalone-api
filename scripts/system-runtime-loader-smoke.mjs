import fs from 'node:fs';
import assert from 'node:assert/strict';

const loader=fs.readFileSync(new URL('../public/runtime-loader.js',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../src/v44WhppUiPatch.js',import.meta.url),'utf8');

assert.match(loader,/system-runtime-loader-v2/,'runtime loader v2 marker missing');
for(const group of ['dashboardCore','dashboardIdle','whppCore','whppIdle','exportCore','exportIdle']){
  assert.match(loader,new RegExp(`${group}\\s*:`),`phased group missing: ${group}`);
}
assert.match(loader,/const legacyGroups\s*=\s*\{/,'legacy group compatibility missing');
assert.match(loader,/groups:legacyGroups/,'legacy .groups API compatibility missing');
assert.match(loader,/activationEpoch/,'route epoch guard missing');
assert.match(loader,/if\(epoch!==activationEpoch\)return;/,'stale idle cancellation missing');
assert.match(loader,/requestIdleCallback\(run,\{timeout:1200\}\)/,'idle phase must use requestIdleCallback');
assert.match(loader,/for\(const group of plan\.critical\)await loadGroup\(group,'critical'\)/,'critical phase must execute directly');
assert.doesNotMatch(loader,/function activate\(\)[\s\S]{0,500}requestIdleCallback/,'critical activation must not be gated by requestIdleCallback');
assert.match(loader,/CORE_RUNTIME_LOADER_TIMING/,'loader timing diagnostics missing');
assert.match(loader,/inspect\(\)\{return \{version:VERSION/,'runtime inspect diagnostics missing');

assert.match(shell,/CORE_UI_LOADER_ID='system-route-aware-ui-loader-v1'/,'compat loader id changed');
assert.match(shell,/CORE_UI_LOADER_REVISION='system-route-aware-ui-loader-v2'/,'loader revision marker missing');
assert.match(shell,/runtime-loader\.js\?v=system-runtime-loader-v2/,'UI shell must inject loader v2');
assert.match(shell,/X-CE-QC-Core-UI-Loader-Revision/,'loader revision response header missing');

console.log('[SYSTEM] runtime loader smoke passed · critical-first · idle enhancement · stale-idle cancellation · legacy API preserved');
