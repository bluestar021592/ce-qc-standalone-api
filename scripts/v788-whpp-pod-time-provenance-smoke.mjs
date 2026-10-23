import assert from 'node:assert/strict';
import {reviewV788WhppPodTimestamp as read} from '../src/v788WhppPodTimingProvenance.js';
const nowMs=Date.parse('2026-10-23T12:00:00+07:00'),opts={nowMs};
const date='2026-07-01';
const check=(row)=>read({shipmentStatus:'60',...row},date,opts);
assert.equal(read({shipmentStatus:'81',podTime:'2026-07-02T09:00:00+07:00'},date,opts).category,'NOT_POD');
for(const key of ['lastUpdateDate','updateTime','updatedAt','creationDate','scanTime','statusTime','eventTime','deliveryTime']){
 const r=check({[key]:'2026-07-02T09:00:00+07:00'});
 assert.equal(r.category,'POD_TIME_MISSING',key+' must not fabricate signing');
 assert.equal(r.candidate,false);
 assert.equal(r.requiresTrajectory,true);
}
const accepted=check({podTime:'2026-07-02T09:00:00+07:00'});
assert.equal(accepted.category,'TMS_EXPLICIT_TIME_CANDIDATE');
assert.equal(accepted.candidate,true);
assert.equal(accepted.proof,'CANDIDATE_ONLY_NOT_SIGNING_VERIFIED');
const contaminated=check({podTime:'2026-07-02T09:00:00+07:00',updateTime:'2026-09-01T10:00:00+07:00'});
assert.equal(contaminated.category,'TMS_EXPLICIT_TIME_CANDIDATE');
assert.equal(contaminated.ignoredLegacyFieldCount,1);
for(const invalid of ['', '2026-07-02 09:00:00','2026-07-02T09:00:00', 'not-a-date']){
 assert.equal(check({podTime:invalid}).candidate,false,'invalid/unzoned '+invalid);
}
assert.equal(check({podTime:'2026-06-30T10:00:00+07:00'}).category,'POD_TIME_OUTSIDE_SOURCE_WINDOW');
assert.equal(check({podTime:'2026-10-24T10:00:00+07:00'}).category,'POD_TIME_OUTSIDE_SOURCE_WINDOW');
assert.equal(check({podTime:'2026-07-02T09:00:00+07:00',signedAt:'2026-07-03T09:00:00+07:00'}).category,'POD_TIME_CONFLICT');
assert.equal(check({podTime:'2026-07-02T09:00:00+07:00',signedAt:'2026-07-02T09:00:30+07:00'}).category,'TMS_EXPLICIT_TIME_CANDIDATE');
const nonPodTime=read({shipmentStatus:'80',signedAt:'2026-07-02T09:00:00+07:00'},date,opts);
assert.equal(nonPodTime.candidate,false);
console.log('[V788 WHPP POD TIME] TMS60 without podTime is missing; status/update/scan times rejected; only validated zoned explicit POD times produce candidates, not certified signatures PASS');
