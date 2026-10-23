// V788: exact-member WHPP POD time discovery from CE tracking-event endpoint.
// A TMS shipmentStatus 60 is already proven separately; this does not change that
// result or grant release, erase old data, update ledgers, or manufacture signed days.
import {normalizeV485TrackRows} from './v485StrictTrackEvidence.js';
export const V788_WHPP_TRACK_SIGNING_ID='V788_WHPP_290_POD_EVENT80_READONLY_V1';
const EXPECTED=Object.freeze({'2026-07-01':166,'2026-07-02':124});
const bill=v=>String(v??'').trim().toUpperCase();
const eventCode=row=>String(row?.eventCode??row?.trackingEventCode??'').trim();
const result=(outcome,dates,querySummary={})=>({
  id:V788_WHPP_TRACK_SIGNING_ID,outcome,readOnly:true,productionModified:false,
  podTimingPublicationAuthorized:false,signingTimeTrusted:false,
  ledgerWriteAuthorized:false,readyToClear:false,readyToPublish:false,
  releaseDecision:'BLOCKED',dates,querySummary
});
const blank=()=>({podMembers:0,queried:0,withPodEventTime:0,
  withOrderedStartToPod:0,missingPodEvent:0,missingPodEventTime:0,
  missingStartEvent:0,invalidPodEventTime:0,invalidStartEventTime:0,
  invalidEventOrder:0,eventBeforeSource:0,ambiguousPodTimes:0,
  otherBillEvents:0,totalEventRows:0,meanStartToPodCalendarDays:null});
function parseEventTime(v){
 const raw=String(v??'').trim();
 // The CE API uses local Cambodian timestamps; reject strings without seconds
 // and do not silently interpret host-machine local time.
 if(/^20\d{2}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw))
   return Date.parse(raw.replace(' ','T')+'+07:00');
 if(/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw))
   return Date.parse(raw);
 return NaN;
}
function localDay(t){
 return new Date(t+7*3600000).toISOString().slice(0,10);
}
function dateDiffInclusive(start,end){
 return Math.floor((Date.parse(localDay(end)+'T00:00:00Z')
  -Date.parse(localDay(start)+'T00:00:00Z'))/86400000)+1;
}
export async function inspectV788WhppPodTracks({members=[],query,batchSize=25}={}){
 const dates=Object.fromEntries(Object.keys(EXPECTED).map(k=>[k,blank()]));
 if(!Array.isArray(members)||typeof query!=='function')return result('INVALID_INPUT',dates);
 const unique=new Set(),byCode=new Map(),all=[];
 for(const item of members){
   const date=String(item?.reportDate??''),code=bill(item?.shipmentCode);
   if(!Object.hasOwn(EXPECTED,date)||!/^[A-Z0-9_-]{5,64}$/.test(code))
     return result('INVALID_POD_MEMBER',dates);
   if(unique.has(code))return result('DUPLICATE_OR_CROSS_DATE_POD_MEMBER',dates);
   unique.add(code);byCode.set(code,{date,code});all.push(code);dates[date].podMembers++;
 }
 if(all.length!==290||Object.entries(EXPECTED).some(([k,n])=>dates[k].podMembers!==n))
   return result('POD_MEMBERSHIP_MISMATCH',dates);
 const size=Math.max(1,Math.min(25,Number.isInteger(batchSize)?batchSize:25));
 const totals={queriedMembers:0,completedBatches:0,failedBatches:0,outOfScopeEvents:0};
 const days=Object.fromEntries(Object.keys(EXPECTED).map(k=>[k,[]]));
 for(let i=0;i<all.length;i+=size){
   const codes=all.slice(i,i+size),wanted=new Set(codes);
   let response;
   try{response=await query(codes)}catch(error){
     return result([401,403].includes(Number(error?.status||error?.ceStatus))?'TMS_AUTH_REQUIRED':'TRACK_QUERY_FAILED',dates,totals);
   }
   if(!Array.isArray(response))return result('TRACK_RESPONSE_INVALID',dates,totals);
   totals.queriedMembers+=codes.length;totals.completedBatches++;
   const normalized=normalizeV485TrackRows(response,{fallbackBills:codes});
   const grouped=new Map(codes.map(code=>[code,[]]));
   for(const row of normalized){
     const code=bill(row?.shipmentCode);
     if(!wanted.has(code)){totals.outOfScopeEvents++;continue;}
     grouped.get(code).push(row);
     dates[byCode.get(code).date].totalEventRows++;
   }
   for(const code of codes){
     const date=byCode.get(code).date,stat=dates[date],rows=grouped.get(code)||[];
     stat.queried++;
     const pod=rows.filter(e=>eventCode(e)==='80');
     const starts=rows.filter(e=>['60','70'].includes(eventCode(e)));
     if(!pod.length){stat.missingPodEvent++;continue;}
     const validPod=pod.map(e=>parseEventTime(e?.eventTime)).filter(Number.isFinite).sort((a,b)=>a-b);
     if(!validPod.length){stat.missingPodEventTime++;continue;}
     const boundary=Date.parse(date+'T00:00:00+07:00');
     const plausible=validPod.filter(t=>t>=boundary&&t<=Date.now()+60000);
     if(!plausible.length){stat.eventBeforeSource++;continue;}
     // Multiple distinct POD completion instants require review; do not choose an arbitrary one.
     const uniquePod=[...new Set(plausible)];
     if(uniquePod.length>1){stat.ambiguousPodTimes++;continue;}
     const completed=uniquePod[0];
     stat.withPodEventTime++;
     if(!starts.length){stat.missingStartEvent++;continue;}
     const validStart=starts.map(e=>parseEventTime(e?.eventTime)).filter(Number.isFinite).sort((a,b)=>a-b);
     if(!validStart.length){stat.invalidStartEventTime++;continue;}
     const earlier=validStart.filter(t=>t<=completed);
     if(!earlier.length){stat.invalidEventOrder++;continue;}
     const start=earlier[0];
     const elapsed=dateDiffInclusive(start,completed);
     if(!Number.isSafeInteger(elapsed)||elapsed<1||elapsed>366){stat.invalidEventOrder++;continue;}
     stat.withOrderedStartToPod++;
     days[date].push(elapsed);
   }
 }
 for(const [date,stats] of Object.entries(dates)){
   if(days[date].length)stats.meanStartToPodCalendarDays=
     Number((days[date].reduce((a,b)=>a+b,0)/days[date].length).toFixed(3));
 }
 const complete=Object.values(dates).every(s=>s.podMembers===s.withOrderedStartToPod
   &&s.withOrderedStartToPod===s.withPodEventTime
   &&s.missingPodEvent===0&&s.missingPodEventTime===0
   &&s.ambiguousPodTimes===0&&s.invalidEventOrder===0);
 return result(complete?'TRACK_START_POD_CANDIDATES_COMPLETE':'TRACK_TIMING_EVIDENCE_INCOMPLETE',
   dates,totals);
}
