// WHPP POD time provenance: shipmentStatus 60 alone proves terminal state,
// NEVER a signing timestamp. This module never reads/writes DB or credentials.
export const V788_WHPP_POD_TIME_PROVENANCE_ID='V788_WHPP_EXPLICIT_POD_TIME_REVIEW_V1';
const explicitFields=['podTime','signedAt','signedTime','deliveryCompletedAt'];
const legacyFields=['updateTime','lastUpdateDate','updatedAt','creationDate','scanTime','statusTime','eventTime','deliveryTime'];
const localDate=v=>String(v??'').trim().slice(0,10);
function parseZoneTime(text){
  const raw=String(text??'').trim();
  // No implicit timezone conversion. An unzoned value is a review candidate only.
  if(!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(raw))
    return null;
  const parsed=Date.parse(raw);
  return Number.isFinite(parsed)?parsed:null;
}
export function reviewV788WhppPodTimestamp(row,reportDate,{nowMs=Date.now()}={}){
  if(String(row?.shipmentStatus??'').trim()!=='60')
    return {category:'NOT_POD',candidate:false,requiresTrajectory:false,field:'',proof:'NONE'};
  const present=explicitFields.filter(k=>String(row?.[k]??'').trim());
  const stale=legacyFields.filter(k=>String(row?.[k]??'').trim());
  const result=(category,field='')=>({category,field,candidate:category==='TMS_EXPLICIT_TIME_CANDIDATE',
    requiresTrajectory:category!=='TMS_EXPLICIT_TIME_CANDIDATE',
    proof:'CANDIDATE_ONLY_NOT_SIGNING_VERIFIED',
    ignoredLegacyFieldCount:stale.length});
  if(!present.length)return result('POD_TIME_MISSING');
  const parsed=present.map(k=>({key:k,timestamp:parseZoneTime(row[k])}));
  if(parsed.some(x=>x.timestamp===null))return result('POD_TIME_INVALID_OR_UNZONED');
  const day=localDate(reportDate);
  const midnight=Date.parse(day+'T00:00:00+07:00');
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(midnight)||
    parsed.some(x=>x.timestamp<midnight||x.timestamp>nowMs+60_000))
    return result('POD_TIME_OUTSIDE_SOURCE_WINDOW');
  if(parsed.some(x=>Math.abs(x.timestamp-parsed[0].timestamp)>60_000))
    return result('POD_TIME_CONFLICT');
  return result('TMS_EXPLICIT_TIME_CANDIDATE',parsed[0].key);
}
