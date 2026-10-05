import crypto from 'node:crypto';
import { recoverV485ArchivedTrackEvents } from './v485StrictTrackEvidence.js';
import { recoverV497ArchivedConfirmPodDates } from './v497ArchivedConfirmPodEvidence.js';
import { recoverV498SavedShopeePodDates } from './v498SavedShopeePodEvidence.js';

const cache=new Map();
const TTL_MS=6*60*60_000;
const text=value=>String(value??'').trim();
const bill=value=>text(value).toUpperCase();
const uniq=values=>[...new Set((values||[]).map(bill).filter(Boolean))].sort();

function addDays(date,days){
  const d=new Date(`${date}T12:00:00Z`);
  if(Number.isNaN(d.getTime()))return date;
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}
function fingerprint(reportDate,bills,businessType){
  return crypto.createHash('sha256').update([businessType,reportDate,...bills].join('\n')).digest('hex');
}
function archiveEventPod(row={}){
  const raw=row?.rawJson&&typeof row.rawJson==='object'?row.rawJson:{};
  const values=[row.eventCode,row.trackingEventCode,row.statusCode,row.nodeCode,raw.eventCode,raw.trackingEventCode,raw.statusCode,raw.nodeCode]
    .map(v=>text(v).toUpperCase()).filter(Boolean);
  if(values.some(v=>/^0*80$/.test(v)))return true;
  const t=[row.trackingEventDesc,row.trackingEventDescZh,row.statusText,row.statusName,row.eventName,row.message,raw.trackingEventDesc,raw.trackingEventDescZh,raw.statusText,raw.statusName,raw.eventName,raw.message]
    .map(v=>text(v)).join(' ');
  return !/未签收|未妥投|签收失败|NOT[\s_-]*DELIVERED|UNDELIVERED/i.test(t)&&/\bPOD\b|Successfully\s+delivered|\bdelivered\b|已签收|签收成功|已妥投|妥投成功/i.test(t);
}

export async function recoverHistoricalMemberEvidence({reportDate='',businessType='',targetBills=[]}={}){
  const date=text(reportDate).slice(0,10),type=text(businessType).toUpperCase(),bills=uniq(targetBills);
  if(!date||!bills.length)return empty(date,type,bills.length);
  const key=fingerprint(date,bills,type),cached=cache.get(key);
  if(cached&&Date.now()-cached.at<TTL_MS)return cached.value;

  const range={from:date,to:addDays(date,30)};
  const [track,confirm]=await Promise.all([
    recoverV485ArchivedTrackEvents({range,targetBills:bills,mode:'history'}),
    recoverV497ArchivedConfirmPodDates({range,targetBills:bills,mode:'history'})
  ]);
  let saved={evidenceByBill:new Map(),targetBills:bills.length,matchedBills:0,scanRows:0,trackRows:0,finalRows:0};
  if(/^SHOPEE/.test(type)){
    try{saved=recoverV498SavedShopeePodDates({targetBills:bills});}catch{}
  }

  const podBills=new Set();
  const podEvidenceByBill=new Map();
  for(const [code,evidence] of confirm.evidenceByBill||[]){
    podBills.add(code);podEvidenceByBill.set(code,{source:'v497_confirm_archive',...evidence});
  }
  for(const [code,evidence] of saved.evidenceByBill||[]){
    podBills.add(code);
    if(!podEvidenceByBill.has(code))podEvidenceByBill.set(code,{source:'v498_saved_sqlite',...evidence});
  }
  for(const [code,events] of track.eventsByBill||[]){
    if((events||[]).some(archiveEventPod)){
      podBills.add(code);
      if(!podEvidenceByBill.has(code))podEvidenceByBill.set(code,{source:'v485_track_archive',shipmentCode:code});
    }
  }

  const value={
    ok:true,readOnly:true,reportDate:date,businessType:type,targetCount:bills.length,
    podBills,podEvidenceByBill,eventsByBill:track.eventsByBill||new Map(),
    stats:{
      trackFiles:Number(track.filesConsidered||0),trackMatchedFiles:Number(track.matchedFiles||0),
      trackEventBills:Number(track.eventBills||0),trackReadErrors:Number(track.readErrors||0),trackTruncated:Boolean(track.truncated),
      confirmFiles:Number(confirm.filesConsidered||0),confirmMatchedFiles:Number(confirm.matchedFiles||0),
      confirmPodBills:Number(confirm.podDateBills||0),confirmReadErrors:Number(confirm.readErrors||0),confirmTruncated:Boolean(confirm.truncated),
      savedPodBills:Number(saved.matchedBills||0),podBills:podBills.size
    }
  };
  cache.set(key,{at:Date.now(),value});
  return value;
}
export function clearHistoricalMemberEvidenceCache(){cache.clear();}
function empty(reportDate,businessType,targetCount=0){
  return{ok:true,readOnly:true,reportDate,businessType,targetCount,podBills:new Set(),podEvidenceByBill:new Map(),eventsByBill:new Map(),stats:{trackFiles:0,trackMatchedFiles:0,trackEventBills:0,trackReadErrors:0,trackTruncated:false,confirmFiles:0,confirmMatchedFiles:0,confirmPodBills:0,confirmReadErrors:0,confirmTruncated:false,savedPodBills:0,podBills:0}};
}
