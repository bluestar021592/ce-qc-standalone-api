import fs from 'node:fs';
import assert from 'node:assert/strict';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');

assert.match(repair,/loadWhppState/,'WHPP timing repair must read the same persisted state as the WHPP dashboard');
assert.match(repair,/buildWhppDashboard\(state\)/,'WHPP POD members must come from the formal WHPP dashboard truth first');
assert.match(repair,/detailTabs\?\.pod\?\.rows/,'timing repair must consume exact POD detail members, not a count-only proxy');
assert.match(repair,/loadBusinessState\('SHOPEE'\)/,'Shopee timing repair must read the same persisted state as the Shopee dashboard');
assert.match(repair,/buildShopeeDashboard\(state\)/,'Shopee POD members must come from formal Shopee dashboard truth first');
assert.match(repair,/recipientGroupOf\(row\)===wantedGroup/,'Shopee CN and VN timing membership must stay recipient-group exact');
assert.match(repair,/if\(bills\.length\)return unique\(bills\)/,'formal dashboard membership must win before SQL fallback');
console.log('[V658] signing repair reuses exact WHPP/Shopee dashboard POD detail membership before SQL fallback');
