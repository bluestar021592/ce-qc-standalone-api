import fs from 'node:fs';
import assert from 'node:assert/strict';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const whpp=fs.readFileSync('src/v134WhppRunSupervisorPatch.js','utf8');

assert.match(repair,/listWhppHistory\(500\)/,'WHPP timing membership must begin from immutable completed snapshot history');
assert.match(repair,/loadWhppSnapshot\(hit\.snapshotId\)/,'WHPP timing membership must read the completed WHPP snapshot payload');
assert.match(repair,/snapshot\?\.dashboard\?\.detailTabs\?\.pod\?\.rows/,'WHPP timing denominator must reuse exact snapshot POD detail rows');
assert.match(repair,/getBusinessSnapshot\('SHOPEE',date\)/,'Shopee timing membership must read immutable completed snapshot');
assert.match(repair,/byRecipientGroup\?\.\[wantedGroup\]\?\.pod\?\.rows/,'Shopee CN\/VN timing denominator must reuse recipient-group snapshot POD rows');
assert.match(whpp,/FROM business_export_snapshots/,'WHPP completion lock must inspect immutable export snapshots');
assert.match(whpp,/completionSource:summaryFinalized\?'DAILY_SUMMARY':'IMMUTABLE_EXPORT_SNAPSHOT'/,'completion source must be explicit');
console.log('[V660] immutable completion snapshot owns WHPP completion and WHPP/Shopee POD timing membership');
