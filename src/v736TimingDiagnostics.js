import { getDb } from './db.js';
import { selectedDatePodBills, inspectSelectedDateTimingRepair } from './selectedDateTimingEvidenceRepair.js';
import { extractV498SavedShopeePodEvidence } from './v498SavedShopeePodEvidence.js';

export const V736_TIMING_DIAG_ID='2026-10-07-v736-selected-date-timing-evidence-diag-v1';

const text=v=>String(v??'').trim();
const bill=v=>text(v).toUpperCase();
const safeJson=v=>{try{return v&&typeof v==='object'?v:JSON.parse(String(v||'{}'));}catch{return{};}};
const CODE_KEYS=['eventCode','trackingEventCode','statusCode','eventStatusCode','nodeCode','scanCode','trackCode','trackingCode','shipmentEventCode','operationCode','operateCode','eventTypeCode','statusTypeCode'];
const TIME_KEYS=['eventTime','creationDate','lastUpdateDate','createdAt','eventDate','occurTime','occurrenceTime','trackingTime','scanTime','operateTime','operationTime'];
const TEXT_KEYS=['trackingEventDesc','trackingEventDescZh','trackingEventDescKm','statusText','statusName','eventName','remark','memo','message','place','eventShop','locationCode','description'];
const FAILURE_RE=/\bpending\b|派送失败|投递失败|无法联系|联系不上|无人接听|地址错误|地址异常|改派|拒收|delivery\s*failed|failed\s*delivery|delivery\s*problem|recipient\s*unavailable/i;
const NEGATIVE_POD_RE=/未签收|未妥投|签收失败|妥投失败|未\s*POD|NOT[\s_-]*DELIVERED|UNDELIVERED|DELIVERY[\s_-]*FAILED/i;
const DELIVERY_START_RE=/Parcel\s+start\s+to\s+deliver|派送中|正在为您派送/i;
const ASSIGN_START_RE=/Assigning\s+courier|派件分配|即将为您派送/i;
const POSITIVE_POD_RE=/\bPOD\b|signed[-\s]*off|Successfully\s+delivered|\bdelivered\b|已签收|签收成功|包裹已经被签收|已妥投|妥投成功|签收|妥投/i;

function direct(obj,keys){for(const key of keys){const v=obj?.[key];if(v!==undefined&&v!==null&&typeof v!=='object'&&text(v))return v;}return'';}
function eventCode(row={}){const raw=safeJson(row.rawJson);return text(direct(row,CODE_KEYS)||direct(raw,CODE_KEYS));}
function eventText(row={}){const raw=safeJson(row.rawJson);return [...TEXT_KEYS.map(k=>row?.[k]),...TEXT_KEYS.map(k=>raw?.[k])].map(text).filter(Boolean).join(' ');}
function eventTime(row={}){const raw=safeJson(row.rawJson);return text(direct(row,TIME_KEYS)||direct(raw,TIME_KEYS));}
function isStart(row={}){const code=eventCode(row);if(code==='70'||code==='60')return true;const t=eventText(row);return (DELIVERY_START_RE.test(t)||ASSIGN_START_RE.test(t))&&!FAILURE_RE.test(t)&&!NEGATIVE_POD_RE.test(t);}
function isPod(row={}){if(eventCode(row)==='80')return true;const t=eventText(row);return Boolean(t&&!NEGATIVE_POD_RE.test(t)&&POSITIVE_POD_RE.test(t));}
function chunks(values,size=220){const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;}

function rowsForBills(db,sqlPrefix,params,bills){
  const out=[];
  for(const part of chunks(bills)){
    if(!part.length)continue;
    const marks=part.map(()=>'?').join(',');
    try{out.push(...db.prepare(sqlPrefix.replace('__MARKS__',marks)).all(...params,...part));}catch{}
  }
  return out;
}

export function diagnoseV736Timing(reportDate='',snapshotId=''){
  const date=text(reportDate).slice(0,10),db=getDb(),types=['TBKH','WHPP','SHOPEECN','SHOPEEVN'];
  const result={id:V736_TIMING_DIAG_ID,reportDate:date,snapshotId:text(snapshotId),types:{}};
  for(const type of types){
    try{
      const canonical=selectedDatePodBills(type,date,snapshotId);
      const owner=type.startsWith('SHOPEE')?'SHOPEE':type;
      const statusRows=rowsForBills(db,
        'SELECT shipmentCode,shipmentStatus,statusText,apiStatus,rawJson FROM business_shipment_tracks WHERE businessType=? AND reportDate=? AND UPPER(TRIM(shipmentCode)) IN (__MARKS__)',
        [owner,date],canonical);
      const statusByBill=new Map();
      for(const row of statusRows){const code=bill(row.shipmentCode);if(code)statusByBill.set(code,row);}
      let status60=0,status60WithTime=0,status60NoTime=0;
      for(const code of canonical){
        const row=statusByBill.get(code);if(!row)continue;
        const raw=safeJson(row.rawJson),shipmentStatus=text(row.shipmentStatus||raw.shipmentStatus);
        if(shipmentStatus!=='60')continue;
        status60++;
        const evidence=extractV498SavedShopeePodEvidence(row,'business_shipment_tracks');
        if(evidence?.podDate)status60WithTime++;else status60NoTime++;
      }

      const eventRows=rowsForBills(db,
        'SELECT shipmentCode,eventTime,eventCode,rawJson FROM business_track_events WHERE businessType=? AND reportDate=? AND UPPER(TRIM(shipmentCode)) IN (__MARKS__)',
        [owner,date],canonical);
      const coreRows=rowsForBills(db,
        'SELECT shipmentCode,eventTime,eventCode,trackingEventCode,trackingEventDesc,trackingEventDescZh,trackingEventDescKm,place,rawJson FROM track_events WHERE reportDate=? AND UPPER(TRIM(shipmentCode)) IN (__MARKS__)',
        [date],canonical);
      const eventsByBill=new Map(canonical.map(code=>[code,[]]));
      for(const row of [...eventRows,...coreRows]){const code=bill(row.shipmentCode);if(eventsByBill.has(code))eventsByBill.get(code).push(row);}
      let anyEvents=0,startEvents=0,podEvents=0,completeTrack=0,podOnly=0,startOnly=0,noEvents=0;
      for(const code of canonical){
        const rows=eventsByBill.get(code)||[];
        if(!rows.length){noEvents++;continue;}
        anyEvents++;
        const start=rows.some(isStart),pod=rows.some(isPod);
        if(start)startEvents++;if(pod)podEvents++;
        if(start&&pod)completeTrack++;
        else if(pod)podOnly++;
        else if(start)startOnly++;
      }
      const repair=inspectSelectedDateTimingRepair(type,date,snapshotId);
      result.types[type]={
        podCount:canonical.length,statusRows:statusRows.length,
        shipmentStatus60:status60,shipmentStatus60WithTime:status60WithTime,shipmentStatus60NoTime:status60NoTime,
        anyEventBills:anyEvents,startEventBills:startEvents,podEventBills:podEvents,completeTrackBills:completeTrack,podOnlyBills:podOnly,startOnlyBills:startOnly,noEventBills:noEvents,
        repair:{status:text(repair?.status),queried:Number(repair?.queried||0),persistedEvents:Number(repair?.persistedEvents||0),completed:Number(repair?.completed||0),failed:Number(repair?.failed||0),message:text(repair?.message)}
      };
    }catch(error){result.types[type]={error:text(error?.message||error)};}
  }
  return result;
}
