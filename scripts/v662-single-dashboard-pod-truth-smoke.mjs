import fs from 'node:fs';
import assert from 'node:assert/strict';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const summary=fs.readFileSync('src/homeQualitySummary.js','utf8');

assert.match(repair,/const dashboard=buildWhppDashboard\(state\)/,'WHPP POD membership must come from the same dashboard object as the WHPP board');
assert.match(repair,/dashboard\?\.detailTabs\?\.pod\?\.rows/,'WHPP timing must consume exact POD detail rows');
assert.match(repair,/const dashboard=buildShopeeDashboard\(state\)/,'Shopee POD membership must come from the same dashboard object as the Shopee board');
assert.match(repair,/wantedGroup\+'_pod'/,'Shopee CN/VN timing must consume exact group POD detail tabs');
assert.match(repair,/export function selectedDatePodBills/,'one POD member function must own repair membership');
assert.match(summary,/selectedDatePodBills\(businessType,reportDate,snapshotId\)/,'home timing must consume the same POD member owner');
console.log('[V662] home timing and repair share exact formal dashboard POD membership');
