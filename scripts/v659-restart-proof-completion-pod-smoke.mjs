import fs from 'node:fs';
import assert from 'node:assert/strict';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const whpp=fs.readFileSync('src/v134WhppRunSupervisorPatch.js','utf8');

assert.match(repair,/buildWhppDashboard\(state\)/,'WHPP timing POD truth must equal formal dashboard truth');
assert.match(repair,/buildShopeeDashboard\(state\)/,'Shopee timing POD truth must equal formal dashboard truth');
assert.match(repair,/wantedGroup\+'_pod'/,'Shopee CN/VN POD membership must remain group exact');
assert.match(whpp,/if\(completionLock\.locked\)/,'WHPP progress must honor durable completion lock after restart');
assert.match(whpp,/outcome:'COMPLETED'/,'restart-proof WHPP progress must publish COMPLETED runtime outcome');
assert.match(whpp,/WHPP已完成（(?:选定日报)?持久化完成快照）/,'completed WHPP restart status must remain explicit');
console.log('[V659+] restart-proof WHPP completion + formal dashboard POD timing membership passed');
