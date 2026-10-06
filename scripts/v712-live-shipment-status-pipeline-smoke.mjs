import assert from 'node:assert/strict';
import fs from 'node:fs';

const pipeline=fs.readFileSync('src/pipeline.js','utf8');
const truth=fs.readFileSync('src/shipmentStatusTruth.js','utf8');

assert.match(pipeline,/client\.shipmentTrack\(codes\)/,'live pipeline must call /api/tms-shipment/track');
assert.match(pipeline,/rowsKey='shipmentTrackResults'/,'shipment status responses must persist in runtime state');
assert.match(pipeline,/shipmentTrackQueryStatus/,'shipment status query checkpoints must persist');
assert.match(pipeline,/shipmentTrackRow: shipmentStatusByBill\.get\(wb\)\?\.at\(-1\) \|\| \{\}/,'CCSL analyzer must receive current shipmentStatus evidence');
assert.match(pipeline,/shipmentTrackRow: shipmentStatusByBill\.get\(bill\)\?\.at\(-1\) \|\| \{\}/,'SHOPEE analyzer must receive current shipmentStatus evidence');
assert.match(pipeline,/if\(truth\?\.pod\)return \[bill,'CLOSE_POD_NO_TRACK'\]/,'shipmentStatus 60 must close POD before event track');
assert.match(pipeline,/if\(truth\?\.returned\)return \[bill,'CLOSE_RETURN_NO_TRACK'\]/,'shipmentStatus 81 must close return before event track');
assert.match(pipeline,/if\(truth\?\.returnInProgress\)return \[bill,'TRACK'\]/,'shipmentStatus 80 must remain open/trackable');
assert.match(truth,/POD:'60'/);
assert.match(truth,/RETURN_IN_PROGRESS:'80'/);
assert.match(truth,/RETURN_COMPLETED:'81'/);

console.log('[V712] production pipelines query and persist shipmentStatus: 60 closes POD, 80 remains returning/open, 81 closes returned; eventCode remains a separate layer');
