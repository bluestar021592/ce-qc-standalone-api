import assert from 'node:assert/strict';
import fs from 'node:fs';

const home=fs.readFileSync('src/homeQualitySummary.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const business=fs.readFileSync('src/businessStore.js','utf8');
const whpp=fs.readFileSync('src/whppStore.js','utf8');

assert.match(home,/timingEvidenceRepair:\{active:timingRepairActive,failed:timingRepairFailed,exhausted:timingRepairExhausted,types:timingRepairTypes,readOnly:true\}/,'fast home summary must publish durable timing exhaustion without triggering remote repair');
assert.match(home,/FROM business_pod_locks WHERE businessType=\?/,'timing must read permanent POD lock timestamps');
assert.match(home,/terminalProof:'PERSISTENT_POD_LOCK'/,'permanent POD lock must be an explicit timing evidence source');

assert.match(shell,/历史签收时间缺失/,'exhausted historical timing must not be labelled retryable');
assert.match(shell,/POD已确认，历史签收时间证据已耗尽/,'home timing header must explain exhausted evidence');
assert.match(shell,/timingRepairBtn\.hidden=noMoreRepair/,'repair action must disappear after all missing timing evidence is durably exhausted');
assert.match(shell,/if\(missingTypes\.length&&!repairable\)/,'manual timing repair must guard against repeated exhausted queries');
assert.match(shell,/POD已确认（orderStatus=85）/,'detail reason must distinguish POD truth from missing POD timestamp');

assert.match(business,/function persistPermanentBusinessPodTimes/,'future business POD timestamp persistence missing');
assert.match(business,/shipment_status_60_time/,'shipmentStatus=60 timestamp must be permanently retained');
assert.match(business,/business_pod_locks\.podTime ELSE excluded\.podTime/,'existing trusted POD lock time must remain immutable');
assert.match(whpp,/function persistPermanentWhppPodTimes/,'future WHPP POD timestamp persistence missing');
assert.match(whpp,/whpp_strict_track_event/,'WHPP strict POD event time must be permanently retained');

const businessHelper=business.match(/function explicitTrustedPodTime[\s\S]*?\n\}/)?.[0]||'';
const whppHelper=whpp.match(/function explicitWhppPodTime[\s\S]*?\n\}/)?.[0]||'';
assert.doesNotMatch(businessHelper,/bookingDate/,'bookingDate must never be fabricated as POD time');
assert.doesNotMatch(whppHelper,/bookingDate/,'WHPP bookingDate must never be fabricated as POD time');

assert.match(html,/V741_HISTORICAL_TIMING_CLOSED_LOOP/,'V741 shell marker missing');
assert.match(html,/v625-shell\.js\?v=20261007-v741-1/,'V741 cache bust missing');

console.log('[V741] historical POD-without-time closes as evidence exhausted; repeat repair is removed; future trusted POD timestamps persist permanently; bookingDate is never used as POD time');
