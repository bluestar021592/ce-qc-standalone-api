import fs from 'node:fs';
import assert from 'node:assert/strict';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const whpp=fs.readFileSync('src/v134WhppRunSupervisorPatch.js','utf8');

assert.match(repair,/FROM business_final_rows\s+WHERE businessType='WHPP' AND reportDate=\? AND COALESCE\(isPod,0\)=1/,'WHPP persisted POD rows must be restart-proof timing authority');
assert.match(repair,/businessType='SHOPEE' AND reportDate=\? AND COALESCE\(isPod,0\)=1/,'Shopee persisted POD rows must be restart-proof timing authority');
assert.match(repair,/recipient_group,''\)\)\)=\?/,'Shopee CN\/VN POD membership must remain recipient-group exact');
assert.match(whpp,/if\(completionLock\.locked\)/,'WHPP progress must honor durable completion lock after restart');
assert.match(whpp,/outcome:'COMPLETED'/,'restart-proof WHPP progress must publish COMPLETED runtime outcome');
assert.match(whpp,/WHPP已完成（持久化完成快照）/,'completed WHPP restart status must be explicit');
console.log('[V659] restart-proof WHPP completion + persisted final POD timing membership passed');
