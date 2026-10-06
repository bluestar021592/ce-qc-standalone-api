import fs from 'node:fs';
import assert from 'node:assert/strict';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const whpp=fs.readFileSync('src/v134WhppRunSupervisorPatch.js','utf8');

assert.match(repair,/buildWhppDashboard\(state\)/,'WHPP timing denominator must reuse exact formal dashboard POD rows');
assert.match(repair,/buildShopeeDashboard\(state\)/,'Shopee timing denominator must reuse exact formal dashboard POD rows');
assert.match(repair,/detailTabs\?\.byRecipientGroup\?\.\[wantedGroup\]\?\.pod\?\.rows/,'Shopee CN/VN timing denominator must reuse recipient-group POD rows');
assert.match(whpp,/FROM business_export_snapshots/,'WHPP completion lock must inspect immutable export snapshots');
assert.match(whpp,/completionSource:summaryFinalized\?'DAILY_SUMMARY':'IMMUTABLE_EXPORT_SNAPSHOT'/,'completion source must be explicit');
console.log('[V660+] immutable WHPP completion retained; timing POD membership follows formal dashboards');
