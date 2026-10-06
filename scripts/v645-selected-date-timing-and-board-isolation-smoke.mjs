import fs from 'node:fs';
import assert from 'node:assert/strict';

const server=fs.readFileSync('server.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const summary=fs.readFileSync('src/homeQualitySummary.js','utf8');
const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');

assert.match(server,/if\(page\.business!=='WHPP'\)/,'non-WHPP routes must branch before response');
assert.match(server,/v641WhppScanPending/,'server route must remove WHPP-only control');
assert.match(repair,/requestSelectedDateTimingRepair/,'selected-date timing repair export missing');
assert.match(repair,/unified_import_rows/,'repair must start from imported date membership');
assert.match(repair,/buildShopeeDashboard\(state\)/,'Shopee POD truth must use the formal Shopee dashboard owner');
assert.match(repair,/wantedGroup\+'_pod'/,'Shopee CN/VN POD truth must use exact recipient-group POD detail tabs');
assert.match(repair,/final_rows/,'TBKH POD truth must include persisted final rows');
assert.match(repair,/loadWhppCanonicalTruth/,'WHPP POD truth must use canonical truth');
assert.match(repair,/queryTrackBatchWithFallback/,'repair must use bounded CE track query');
assert.match(repair,/splitTrackBatches/,'repair must batch track requests');
assert.match(repair,/business_track_events/,'repaired track evidence must persist locally');
assert.match(summary,/requestSelectedDateTimingRepair\(type,batch\.reportDate,batch\.snapshotId\)/,'home selected date must queue exact-date timing repair');
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d{3,}-1/,'V645+ JS revision missing');
assert.match(html,/v625-shell\.css\?v=\d{8}-v\d{3,}-1/,'V645+ CSS revision missing');

console.log('[V645] server-side WHPP isolation + selected-date POD timing repair smoke passed');
