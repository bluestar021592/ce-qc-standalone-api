import { getDb } from './db.js';
import { collectV205ExportRows, V205_EXPORT_TRUTH_VERSION } from './v205ExportTruth.js';
import { listV203ManualEvidence } from './v203ManualEvidenceStore.js';

export const V206_SHOPEE_PRECISION_VERSION='2026-08-18-v206-shopee-3001-pod-precision-v1';
const SHOPEE_TYPES=new Set(['SHOPEECN','SHOPEEVN']);
const POD_TEXT_RE=/\bPOD\b|DELIVERED|签收|妥投|已妥投|DELIVERY\s*SUCCESSFULLY|4004/i;
const START_3001_RE=/(?:^|[^0-9A-Z])3001(?:$|[^0-9A-Z])|TRANSPORT\s+TO\s+CENTRAL\s+WAREHOUSE\s+IN\s+PHNOM\s+PENH/i;

function safeJson(value,fallback={}){if(value&&typeof value==='object')return value;try{return JSON.parse(String(value||''))||fallback;}catch{return fallback;}}
function billOf(value=''){return String(value||'').trim().toUpperCase();}
function dateKey(value=''){const m=String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';}
function timeValue(value=''){const text=String(value||'').trim();if(!text)return NaN;const normalized=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text)?`${text.replace(' ','T').replace(/Z|[+-]\d{2}:?\d{2}$/,'')}+07:00`:text;return Date.parse(normalized);}
function chunks(values=[],size=240){const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;}
function flattenText(value,depth=0){if(depth>5||value===null||value===undefined)return'';if(Array.isArray(value))return value.slice(0,500).map(v=>flattenText(v,depth+1)).join(' ');if(typeof value==='object')return Object.entries(value).slice(0,500).map(([k,v])=>`${k} ${flattenText(v,depth+1)}`).join(' ');return String(value||'');}
function rowCode(row={}){const raw=safeJson(row.rawJson,{});return String(row.eventCode||row.trackingEventCode||row.statusCode||row.shipmentStatus||raw.eventCode||raw.trackingEventCode||raw.statusCode||raw.shipmentStatus||raw.status||'').trim().toUpperCase();}
function rowTime(row={}){const raw=safeJson(row.rawJson,{});return String(row.eventTime||row.latestEventTime||row.lastEventTime||row.POD时间||row.podTime||raw.eventTime||raw.creationDate||raw.lastUpdateDate||raw.updatedAt||row.updatedAt||row.createdAt||'').trim();}
function rowText(row={}){const raw=safeJson(row.rawJson,{});return [row.eventCode,row.trackingEventCode,row.statusCode,row.shipmentStatus,row.statusText,row.latestEventDesc,row.lastEventDesc,row.最后节点,row.currentState,row.scanNormalizedState,row.primaryCategory,raw.eventCode,raw.trackingEventCode,raw.statusCode,raw.shipmentStatus,raw.status,raw.statusText,raw.trackingEventDescZh,raw.trackingEventDesc,raw.trackingEventDescKm,raw.remark,raw.place,raw.locationCode,raw.eventShop].map(v=>String(v||'').trim()).filter(Boolean).join(' ');}
function is3001(row={}){const code=rowCode(row);return code==='3001'||START_3001_RE.test(`${code} ${rowText(row)}`);}
function isPod(row={}){const code=rowCode(row),text=rowText(row),current=String(row.currentState||row.scanNormalizedState||'').toUpperCase();return code==='4004'||code==='80'||current==='POD'||String(row.orderStatus||'')==='85'||POD_TEXT_RE.test(`${code} ${text}`);}
function addEvidence(map,bill,row,source){if(!map.has(bill)||!bill)return;const time=rowTime(row);if(!dateKey(time))return;map.get(bill).push({...row,__v206Source:source,__v206Time:time});}
function addEmbedded(map,bill,value,source,depth=0,seen={count:0}){if(!map.has(bill)||value===null||value===undefined||depth>5||seen.count>1000)return;seen.count++;if(Array.isArray(value)){for(const item of value)addEmbedded(map,bill,item,source,depth+1,seen);return;}if(typeof value!=='object')return;const code=rowCode(value),time=rowTime(value),text=rowText(value);if(dateKey(time)&&(code||text))addEvidence(map,bill,value,source);for(const child of Object.values(value))if(child&&typeof child==='object')addEmbedded(map,bill,child,source,depth+1,seen);}
function uniqueEvidence(list=[]){const seen=new Set(),out=[];for(const row of list){const key=`${row.__v206Time||rowTime(row)}|${rowCode(row)}|${row.__v206Source||''}|${rowText(row).slice(0,180)}`;if(seen.has(key))continue;seen.add(key);out.push(row);}return out;}
function earliest(rows=[]){return [...rows].sort((a,b)=>{const ta=timeValue(a.time),tb=timeValue(b.time);if(Number.isFinite(ta)&&Number.isFinite(tb)&&ta!==tb)return ta-tb;return String(a.time).localeCompare(String(b.time));})[0]||null;}

export function v206NaturalDays(start,end){const a=dateKey(start),b=dateKey(end);if(!a||!b||b<a)return 0;const av=Date.parse(`${a}T00:00:00Z`),bv=Date.parse(`${b}T00:00:00Z`);return Math.floor((bv-av)/86400000)+1;}

export function resolveV206ShopeeTimingEvidence(evidence=[],row={}){
  if(!row?.pod)return{status:'NOT_POD',days:0,startAt:'',podAt:'',startSource:'',podSource:'',evidenceCount:evidence.length};
  const starts=[],pods=[];
  for(const item of uniqueEvidence(evidence)){
    const time=item.__v206Time||rowTime(item);if(!dateKey(time))continue;
    if(is3001(item))starts.push({time,source:item.__v206Source||'TRAJECTORY_3001'});
    if(isPod(item))pods.push({time,source:item.__v206Source||'TRAJECTORY_POD'});
  }
  if(dateKey(row.podTime||row.podDate))pods.push({time:String(row.podTime||row.podDate),source:row.podSource||'CANONICAL_POD'});
  const start=earliest(starts);
  if(!start){const pod=earliest(pods);return{status:'MISSING_3001',days:0,startAt:'',podAt:pod?.time||'',startSource:'',podSource:pod?.source||'',evidenceCount:evidence.length};}
  const startStamp=timeValue(start.time);
  const validPods=pods.filter(item=>{const t=timeValue(item.time);return Number.isFinite(t)&&Number.isFinite(startStamp)?t>=startStamp:dateKey(item.time)>=dateKey(start.time);});
  const pod=earliest(validPods);
  if(!pod){const anyPod=earliest(pods);return{status:anyPod?'INVALID_SEQUENCE':'MISSING_POD_TIME',days:0,startAt:start.time,podAt:anyPod?.time||'',startSource:start.source,podSource:anyPod?.source||'',evidenceCount:evidence.length};}
  const days=v206NaturalDays(start.time,pod.time);
  return{status:days>0?'OK':'INVALID_SEQUENCE',days,startAt:start.time,podAt:pod.time,startSource:start.source,podSource:pod.source,evidenceCount:evidence.length};
}

function loadDbEvidence(db,type,bills=[]){const map=new Map(bills.map(b=>[b,[]]));
  for(const part of chunks(bills)){
    const marks=part.map(()=>'?').join(',');if(!marks)continue;let rows=[];
    try{rows=db.prepare(`SELECT businessType,shipmentCode,eventTime,eventCode,rawJson,createdAt FROM business_track_events WHERE businessType IN ('SHOPEE',?) AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,createdAt,id`).all(type,...part);}catch{}
    for(const row of rows)addEvidence(map,billOf(row.shipmentCode),row,'BUSINESS_TRACK_EVENTS');
    rows=[];try{rows=db.prepare(`SELECT businessType,shipmentCode,shipmentStatus,statusText,rawJson,createdAt,updatedAt FROM business_shipment_tracks WHERE businessType IN ('SHOPEE',?) AND shipmentCode IN (${marks}) ORDER BY shipmentCode,createdAt,updatedAt`).all(type,...part);}catch{}
    for(const row of rows){const bill=billOf(row.shipmentCode);addEvidence(map,bill,row,'BUSINESS_SHIPMENT_TRACKS');addEmbedded(map,bill,safeJson(row.rawJson,{}),'BUSINESS_SHIPMENT_TRACKS_RAW');}
    rows=[];try{rows=db.prepare(`SELECT businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,latestEventTime,latestEventDesc,latestNode,rawJson,updatedAt FROM business_final_rows WHERE businessType IN ('SHOPEE',?) AND shipmentCode IN (${marks}) ORDER BY shipmentCode,reportDate`).all(type,...part);}catch{}
    for(const row of rows){const bill=billOf(row.shipmentCode);addEvidence(map,bill,row,'BUSINESS_FINAL_ROWS');addEmbedded(map,bill,safeJson(row.rawJson,{}),'BUSINESS_FINAL_ROWS_RAW');}
    rows=[];try{rows=db.prepare(`SELECT shipmentCode,businessType,reportDate,state,apiStatus,lastEventTime,stateJson,updatedAt FROM shipment_current_state WHERE shipmentCode IN (${marks})`).all(...part);}catch{}
    for(const row of rows){const bt=String(row.businessType||'').toUpperCase();if(bt&&![type,'SHOPEE'].includes(bt))continue;const bill=billOf(row.shipmentCode);addEvidence(map,bill,{...safeJson(row.stateJson,{}),currentState:row.state,latestEventTime:row.lastEventTime,updatedAt:row.updatedAt},'SHIPMENT_CURRENT_STATE');addEmbedded(map,bill,safeJson(row.stateJson,{}),'SHIPMENT_CURRENT_STATE_RAW');}
  }
  return map;
}
function mergeManualEvidence(map,records=[]){for(const record of records){const bill=billOf(record.shipmentCode);if(!map.has(bill))continue;for(const row of record.trackEvents||[])addEvidence(map,bill,row,'MANUAL_TRACK_EVIDENCE');if(record.shipment)addEmbedded(map,bill,record.shipment,'MANUAL_SHIPMENT_EVIDENCE');if(record.analysis)addEmbedded(map,bill,record.analysis,'MANUAL_ANALYSIS_EVIDENCE');}}
function appendRemark(existing='',addition=''){const a=String(existing||'').trim(),b=String(addition||'').trim();if(!b)return a;if(a.includes(b))return a;return[a,b].filter(Boolean).join('；').slice(0,1400);}
function average(values=[]){const valid=values.map(Number).filter(v=>Number.isFinite(v)&&v>0);return valid.length?Number((valid.reduce((a,b)=>a+b,0)/valid.length).toFixed(2)):0;}
function timingGroup(rows=[]){const pod=rows.filter(r=>r.pod);const valid=pod.filter(r=>r.timingEvidenceStatus==='OK'&&Number(r.deliveryDays||0)>0);const missing3001=pod.filter(r=>r.timingEvidenceStatus==='MISSING_3001').length;const missingPod=pod.filter(r=>r.timingEvidenceStatus==='MISSING_POD_TIME').length;const invalidSequence=pod.filter(r=>r.timingEvidenceStatus==='INVALID_SEQUENCE').length;return{pod:pod.length,samples:valid.length,averageDays:average(valid.map(r=>r.deliveryDays)),coverageRate:pod.length?Number((valid.length/pod.length*100).toFixed(2)):0,missing3001,missingPod,invalidSequence,missingTotal:Math.max(0,pod.length-valid.length)};}
export function summarizeV206ShopeeTiming(rows=[]){const official=rows.filter(r=>r.metricEligible!==false);return{all:timingGroup(official),pp:timingGroup(official.filter(r=>r.area==='金边')),pv:timingGroup(official.filter(r=>r.area==='外省')),unknown:timingGroup(official.filter(r=>r.area!=='金边'&&r.area!=='外省'))};}

export async function collectV206ShopeeRows(type,range,onProgress=()=>{}){
  const businessType=String(type||'').trim().toUpperCase();
  const rows=await collectV205ExportRows(businessType,range,onProgress);
  if(!SHOPEE_TYPES.has(businessType)){for(const row of rows)row.precisionTruthVersion=V206_SHOPEE_PRECISION_VERSION;return rows;}
  const bills=[...new Set(rows.map(r=>billOf(r.shipmentCode)).filter(Boolean))];const db=getDb();const evidence=loadDbEvidence(db,businessType,bills);const manualRecords=listV203ManualEvidence({businessType,fromDate:range.from,toDate:range.to});mergeManualEvidence(evidence,manualRecords);
  let ok=0,missing3001=0,missingPod=0,invalid=0;
  for(const row of rows){row.legacyOrderToPodDays=Number(row.deliveryDays||0);const timing=resolveV206ShopeeTimingEvidence(evidence.get(billOf(row.shipmentCode))||[],row);row.timingEvidenceStatus=timing.status;row.timingStartAt=timing.startAt;row.timingPodAt=timing.podAt;row.timingStartSource=timing.startSource;row.timingPodSource=timing.podSource;row.timingEvidenceCount=timing.evidenceCount;row.deliveryDays=timing.status==='OK'?timing.days:0;row.signNaturalDays=row.deliveryDays;row.signDaySource=timing.status==='OK'?'SHOPEE末端时效：3001入库当天=第1天 → 真实4004/轨迹80 POD，首尾自然日计1天':'SHOPEE末端时效证据未闭合，不用下单时间或区间均值补算';row.precisionTruthVersion=V206_SHOPEE_PRECISION_VERSION;row.deliveryTruthVersion=V206_SHOPEE_PRECISION_VERSION;
    if(timing.status==='OK'){ok++;row.podTime=timing.podAt||row.podTime;row.podDate=dateKey(row.podTime)||row.podDate;row.remark=appendRemark(row.remark,`末端时效：3001 ${timing.startAt} → POD ${timing.podAt} = ${timing.days}天`);}else if(row.pod){if(timing.status==='MISSING_3001')missing3001++;else if(timing.status==='MISSING_POD_TIME')missingPod++;else if(timing.status==='INVALID_SEQUENCE')invalid++;row.remark=appendRemark(row.remark,`末端时效证据：${timing.status}`);}
  }
  const timingSummary=summarizeV206ShopeeTiming(rows);onProgress({phase:'v206ShopeePrecision',completed:rows.length,total:rows.length,businessType,validTiming:ok,missing3001,missingPod,invalidSequence:invalid,timingSummary,baseVersion:V205_EXPORT_TRUTH_VERSION,version:V206_SHOPEE_PRECISION_VERSION});
  return rows;
}
