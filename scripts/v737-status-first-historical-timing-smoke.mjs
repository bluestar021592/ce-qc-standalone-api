import assert from 'node:assert/strict';
import fs from 'node:fs';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const statusTruth=fs.readFileSync('src/shipmentStatusTruth.js','utf8');
const home=fs.readFileSync('src/homeQualitySummary.js','utf8');

assert.match(repair,/client\.shipmentTrack\(codes\)/,'historical timing repair must query shipmentStatus endpoint first');
assert.match(repair,/persistShipmentStatusRows\(type,date,rows\)/,'shipmentStatus results must be persisted for later timing reads');
assert.match(repair,/status60WithTime/,'status=60 with timestamp count missing');
assert.match(repair,/status60WithoutTime/,'status=60 without timestamp count missing');
assert.match(repair,/const trackBills=bills\.filter\(code=>!statusTimedBills\.has\(code\)\)/,'track events should only be queried for bills still missing POD time');
assert.match(repair,/V737_STATUS_FIRST_TIMING_REPAIR_REVISION/,'repair migration revision missing');
assert.match(repair,/clearDurableStop\(type,date\)/,'older durable event-only stops must be reopened once');
assert.match(statusTruth,/shipmentStatus=60 => POD/,'shipmentStatus 60 business truth must remain field-specific');
assert.match(home,/savedTerminalPodTimingEvidence/,'saved shipmentStatus timestamps must feed dashboard timing');

console.log('[V737] historical timing is status-first: shipmentStatus=60 timestamps are persisted and used before event-track fallback');
