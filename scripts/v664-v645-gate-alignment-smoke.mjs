import fs from 'node:fs';
import assert from 'node:assert/strict';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const v645=fs.readFileSync('scripts/v645-selected-date-timing-and-board-isolation-smoke.mjs','utf8');

assert.match(repair,/buildShopeeDashboard\(state\)/,'formal Shopee dashboard POD truth missing');
assert.match(repair,/wantedGroup\+'_pod'/,'CN/VN exact POD detail tabs missing');
assert.doesNotMatch(v645,/business_final_rows/,'legacy V645 gate must not require retired business_final_rows POD ownership');
console.log('[V664] V645 legacy gate aligned with V662 formal dashboard POD truth');
