import { getDb } from './db.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';
import { v246InclusiveDays } from './v246TrackingLedgerCore.js';

export const V320_DISPATCH_SIGNING_TRUTH_ID='2026-08-26-v320-real-dispatch-start-to-pod-v1';
const STRICT=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const text=v=>String(v??'').trim();
const billOf=v=>text(v).toUpperCase();
const dateKey=v=>{const m=text(v).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const chunks=(values,size=220)=>{const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;};
function push(map,rows=[]){for(const row of rows){const bill=billOf(row.shipmentCode);if(!bill)continue;if(!map.has(bill))map.set(bill,[]);map.get(bill).push(row);}}
function eventsByBill(type,bills,db){
  const map=new Map(bills.map(b=>[b,[]]));
  for(const part of chunks(bills)){
    const m=part.map(()=>'?').join(',');if(!m)continue;
    if(type==='TBKH'){
      try{push(map,db.prepare(`SELECT shipmentCode,eventTime,eventCode,trackingEventCode,trackingEventDesc,trackingEventDescZh,trackingEventDescKm,rawJson,id FROM track_events WHERE shipmentCode IN (${m}) ORDER BY shipmentCode,eventTime,id`).all(...part));}catch{}
      try{push(map,db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,id FROM business_track_events WHERE businessType='TBKH' AND shipmentCode IN (${m}) ORDER BY shipmentCode,eventTime,id`).all(...part));}catch{}
    }else{
      try{push(map,db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,id FROM business_track_events WHERE businessType='SHOPEE' AND shipmentCode IN (${m}) ORDER BY shipmentCode,eventTime,id`).all(...part));}catch{}
    }
  }
  return map;
}
function fallbackDispatchAt(row={}){return text(row.firstAttemptAt||row.dispatchStartAt||row.deliveryStartAt||row.首次派件时间||row.首次派送时间||'');}
export function resolveV320DispatchSigningDays({events=[],podDate='',firstAttemptAt=''}={}){
  const pod=dateKey(podDate);if(!pod)return{days:0,dispatchDate:'',source:'POD日期缺失'};
  const strict=analyzeV246ShopeeAttemptCycle(events,{podDate:pod});
  const firstStart=text(strict.starts?.[0]?.time||firstAttemptAt||'');
  const dispatch=dateKey(firstStart);if(!dispatch)return{days:0,dispatchDate:'',source:'真实派件START缺失',strict};
  const days=v246InclusiveDays(dispatch,pod)||0;
  return{days,dispatchDate:dispatch,dispatchAt:firstStart,podDate:pod,source:strict.starts?.length?(strict.startMode==='TRACK_70'?'轨迹70首次真实派件START→POD':'整票无70时轨迹60首次分配START→POD'):'已保存firstAttemptAt→POD',strict};
}
export function applyV320DispatchSigningTruth(businessType,rows=[],{db=getDb()}={}){
  const type=text(businessType).toUpperCase();if(!STRICT.has(type)||!rows.length)return rows;
  const bills=[...new Set(rows.map(r=>billOf(r?.shipmentCode||r?.运单号)).filter(Boolean))],events=eventsByBill(type,bills,db);
  for(const row of rows){if(!row?.pod)continue;const bill=billOf(row.shipmentCode||row.运单号),podDate=dateKey(row.podDate||row.podTime||row.POD时间);const truth=resolveV320DispatchSigningDays({events:events.get(bill)||[],podDate,firstAttemptAt:fallbackDispatchAt(row)});row.dispatchStartDate=truth.dispatchDate;row.dispatchStartAt=truth.dispatchAt||'';row.signingDays=truth.days;row.deliveryDays=truth.days;row.signingDaysSource=truth.days>0?truth.source:'';row.deliveryDaysSource=row.signingDaysSource;row.dispatchSigningEvidenceComplete=truth.days>0;row.v320DispatchSigningTruthId=V320_DISPATCH_SIGNING_TRUTH_ID;}
  return rows;
}
console.info('[CE-QC][V320_DISPATCH_SIGNING_TRUTH]',V320_DISPATCH_SIGNING_TRUTH_ID,'average day source corrected from report-date→POD to real first dispatch START→POD; missing dispatch evidence is excluded from the average instead of blanking the whole day.');
