import fs from 'node:fs';
import assert from 'node:assert/strict';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');

assert.match(repair,/loadWhppState/,'WHPP timing repair must read formal WHPP state');
assert.match(repair,/buildWhppDashboard\(state\)/,'WHPP POD membership must come from the formal WHPP dashboard');
assert.match(repair,/detailTabs\?\.pod\?\.rows/,'WHPP exact POD detail members required');
assert.match(repair,/loadBusinessState\('SHOPEE'\)/,'Shopee timing repair must read formal Shopee state');
assert.match(repair,/buildShopeeDashboard\(state\)/,'Shopee POD membership must come from the formal Shopee dashboard');
assert.match(repair,/wantedGroup\+'_pod'/,'Shopee CN and VN timing membership must use exact recipient-group POD detail tabs');
console.log('[V658+] signing repair reuses exact WHPP/Shopee dashboard POD detail membership');
