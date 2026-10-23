import assert from 'node:assert/strict';
import {inspectV788WhppPodTracks as review} from '../src/v788WhppTrackTimingReadonly.js';

const members=[],events=new Map();
for(let i=0;i<290;i++){
  const date=i<166?'2026-07-01':'2026-07-02',code='CE'+String(i+1).padStart(9,'0');
  members.push({reportDate:date,shipmentCode:code});
  events.set(code,{shipmentCode:code,events:[
    {eventCode:'70',eventTime:date+' 08:00:00'},
    {eventCode:'80',eventTime:date+' 16:30:00'}
  ]});
}
const baseQuery=async codes=>codes.map(c=>events.get(c));
const ok=await review({members,query:baseQuery});
assert.equal(ok.outcome,'TRACK_START_POD_CANDIDATES_COMPLETE');
assert.equal(ok.dates['2026-07-01'].podMembers,166);
assert.equal(ok.dates['2026-07-02'].podMembers,124);
assert.equal(ok.dates['2026-07-01'].withOrderedStartToPod,166);
assert.equal(ok.dates['2026-07-02'].withPodEventTime,124);
assert.equal(ok.dates['2026-07-02'].meanStartToPodCalendarDays,1);
assert.equal(ok.querySummary.queriedMembers,290);
assert.equal(ok.querySummary.completedBatches,12);
assert.equal(ok.readOnly,true);
assert.equal(ok.readyToClear,false);
assert.equal(ok.readyToPublish,false);
assert.equal(ok.signingTimeTrusted,false);
assert.equal(ok.podTimingPublicationAuthorized,false);
assert.doesNotMatch(JSON.stringify(ok),/CE000000001/);

async function scenario(mutator={}){
 let queried=0;
 const m=JSON.parse(JSON.stringify(members));
 if(mutator.members)mutator.members(m);
 const map=new Map([...events].map(([k,v])=>[k,JSON.parse(JSON.stringify(v))]));
 if(mutator.events)mutator.events(map,m);
 const res=await review({members:m,query:async codes=>{
   queried++;
   if(mutator.query)return mutator.query(codes,map);
   return codes.map(c=>map.get(c));
 }});
 return {res,queried};
}
const absent=await scenario({events:m=>m.get(members[0].shipmentCode).events.splice(1,1)});
assert.equal(absent.res.outcome,'TRACK_TIMING_EVIDENCE_INCOMPLETE');
assert.equal(absent.res.dates['2026-07-01'].missingPodEvent,1);
const noTime=await scenario({events:m=>{m.get(members[0].shipmentCode).events[1].eventTime='';}});
assert.equal(noTime.res.dates['2026-07-01'].missingPodEventTime,1);
const laterUpdateOnly=await scenario({events:m=>{
 const r=m.get(members[0].shipmentCode).events[1];delete r.eventTime;r.lastUpdateDate='2026-07-08 11:11:11';
}});
assert.equal(laterUpdateOnly.res.dates['2026-07-01'].missingPodEventTime,1,'cannot take lastUpdateDate');
const wrongCode=await scenario({events:m=>{
 const r=m.get(members[0].shipmentCode).events[1];delete r.eventCode;r.shipmentStatus='80';r.eventTime='2026-07-02 08:00:00';
}});
assert.equal(wrongCode.res.dates['2026-07-01'].missingPodEvent,1,'shipmentStatus 80 is NOT eventCode 80');
const invalidChronology=await scenario({events:m=>{
 m.get(members[0].shipmentCode).events[0].eventTime='2026-07-02 19:00:00';
}});
assert.equal(invalidChronology.res.dates['2026-07-01'].invalidEventOrder,1);
const ambiguousTime=await scenario({events:m=>{
 m.get(members[0].shipmentCode).events.push({eventCode:'80',eventTime:'2026-07-01 17:00:00'});
}});
assert.equal(ambiguousTime.res.dates['2026-07-01'].ambiguousPodTimes,1);
const wrongDay=await scenario({events:m=>{
 m.get(members[0].shipmentCode).events[1].eventTime='2026-06-30 19:00:00';
}});
assert.equal(wrongDay.res.dates['2026-07-01'].eventBeforeSource,1);
const cross=await scenario({members:m=>m[166].shipmentCode=m[0].shipmentCode});
assert.equal(cross.res.outcome,'DUPLICATE_OR_CROSS_DATE_POD_MEMBER');
assert.equal(cross.queried,0);
const short=await scenario({members:m=>m.pop()});
assert.equal(short.res.outcome,'POD_MEMBERSHIP_MISMATCH');
assert.equal(short.queried,0);
const unauthorized=await scenario({query:()=>{throw Object.assign(new Error('secret/unauthorized'),{status:401});}});
assert.equal(unauthorized.res.outcome,'TMS_AUTH_REQUIRED');
assert.doesNotMatch(JSON.stringify(unauthorized.res),/secret\/unauthorized/);
const missed=await scenario({query:(codes,map)=>codes.slice(1).map(c=>map.get(c))});
assert.equal(missed.res.outcome,'TRACK_TIMING_EVIDENCE_INCOMPLETE');
assert.ok(missed.res.dates['2026-07-01'].missingPodEvent>0);
console.log('[V788 290 POD TRACK READONLY] exact 166+124; 12 batches; nested START70->POD event80; invalid time, status80 mixup, wrong date, cross-source, missing and 401 cases fail closed. PASS');
