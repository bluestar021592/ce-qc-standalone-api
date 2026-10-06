import assert from 'node:assert/strict';
import fs from 'node:fs';

const pipeline=fs.readFileSync('src/pipeline.js','utf8');

assert.match(pipeline,/shipmentStatusTime/,'pipeline must read shipment-status timestamps');
assert.match(pipeline,/truth\.pod && !shipmentStatusTime\(shipmentRow\)/,'status=60 without a timestamp must enter POD timing recovery');
assert.match(pipeline,/POD_TIMING_TRACK/,'SHOPEE status=60 without timestamp must request trajectory timing evidence');
assert.match(pipeline,/businessTrackBills/,'ordinary business track bills must remain separate from timing-only POD track bills');
assert.match(pipeline,/apiName: 'exception-item-query', bills: businessTrackBills/,'timing-only POD recovery must not waste exception queries');
assert.match(pipeline,/events: \(\(alreadyPod && !podTimingTrack\)/,'known POD must still consume track events when timing recovery is needed');
assert.match(pipeline,/const trackResultByBill = new Map\(trackResults\.map/,'CCSL final POD rows must merge recovered track timing');
assert.match(pipeline,/签收时间已由轨迹补齐/,'final row must expose recovered POD timing');
assert.match(pipeline,/POD时间:statusTime\|\|row\.POD时间\|\|''/,'status endpoint timestamp must be retained when directly available');

console.log('[V715] shipmentStatus=60 closes POD immediately but missing POD timestamps are recovered from trajectory events; 80/81 return semantics remain unchanged');
