import { getDb } from './db.js';
import { getLatestUnifiedImport, listUnifiedImportHistory } from './unifiedImportStore.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';

const TYPES = Object.freeze(['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN']);
const TIMING_TYPES = Object.freeze(['TBKH','WHPP','SHOPEECN','SHOPEEVN']);
const RETURN_TYPES = new Set(['WHPP','SHOPEECN','SHOPEEVN']);
const FAILURE_RE = /\bpending\b|派送失败|投递失败|无法联系|联系不上|无人接听|地址错误|地址异常|改派|拒收|delivery\s*failed|failed\s*delivery|delivery\s*problem|recipient\s*unavailable/i;
const NEGATIVE_POD_RE = /未签收|未妥投|签收失败|妥投失败|未\s*POD|NOT[\s_-]*DELIVERED|UNDELIVERED|DELIVERY[\s_-]*FAILED/i;
const DELIVERY_START_RE = /Parcel\s+start\s+to\s+deliver|派送中|正在为您派送/i;
const ASSIGN_START_RE = /Assigning\s+courier|派件分配|即将为您派送/i;
const POSITIVE_POD_RE = /\bPOD\b|signed[-\s]*off|Successfully\s+delivered|\bdelivered\b|已签收|签收成功|包裹已经被签收|已妥投|妥投成功|签收|妥投/i;

function n(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function safeJson(value) {
  try { return value && typeof value === 'object' ? value : JSON.parse(String(value || '{}')); }
  catch { return {}; }
}
function normalizeDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/(\d{4})[\/-]?(\d{1,2})[\/-]?(\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;
}
function naturalDays(fromValue, toValue) {
  const from = normalizeDate(fromValue);
  const to = normalizeDate(toValue);
  if (!from || !to) return 0;
  const startMs = Date.parse(`${from}T00:00:00+07:00`);
  const endMs = Date.parse(`${to}T00:00:00+07:00`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
  return Math.floor((endMs - startMs) / 86400000) + 1;
}
function eventCode(event = {}) {
  const raw = safeJson(event.rawJson);
  const values = [
    event.eventCode,event.trackingEventCode,event.statusCode,event.eventStatusCode,event.nodeCode,event.scanCode,event.trackCode,
    raw.eventCode,raw.trackingEventCode,raw.statusCode,raw.eventStatusCode,raw.nodeCode,raw.scanCode,raw.trackCode
  ];
  for (const value of values) {
    const text = String(value ?? '').trim().toUpperCase();
    if (!text) continue;
    const exact = text.match(/^0*(\d{2,4})$/);
    if (exact) return String(Number(exact[1]));
  }
  return '';
}
function eventTime(event = {}) {
  const raw = safeJson(event.rawJson);
  for (const value of [
    event.eventTime,event.creationDate,event.lastUpdateDate,event.createdAt,event.eventDate,event.occurTime,event.trackingTime,event.scanTime,
    raw.eventTime,raw.creationDate,raw.lastUpdateDate,raw.createdAt,raw.eventDate,raw.occurTime,raw.trackingTime,raw.scanTime
  ]) {
    if (String(value || '').trim()) return String(value).trim();
  }
  return '';
}
function eventText(event = {}) {
  const raw = safeJson(event.rawJson);
  return [
    event.trackingEventDescZh,event.trackingEventDesc,event.trackingEventDescKm,event.statusText,event.statusName,event.eventName,
    event.remark,event.memo,event.message,event.place,event.eventShop,event.locationCode,
    raw.trackingEventDescZh,raw.trackingEventDesc,raw.trackingEventDescKm,raw.statusText,raw.statusName,raw.eventName,
    raw.remark,raw.memo,raw.message,raw.place,raw.eventShop,raw.locationCode
  ].map(value=>String(value||'').trim()).filter(Boolean).join(' ');
}
function isDeliveryStart(event = {}) {
  if (eventCode(event) === '70') return true;
  const text = eventText(event);
  return DELIVERY_START_RE.test(text) && !FAILURE_RE.test(text) && !NEGATIVE_POD_RE.test(text);
}
function isAssignStart(event = {}) {
  if (eventCode(event) === '60') return true;
  const text = eventText(event);
  return ASSIGN_START_RE.test(text) && !FAILURE_RE.test(text) && !NEGATIVE_POD_RE.test(text);
}
function isPodEvent(event = {}) {
  if (eventCode(event) === '80') return true;
  const text = eventText(event);
  return Boolean(text && !NEGATIVE_POD_RE.test(text) && POSITIVE_POD_RE.test(text));
}
function sortEvents(events = []) {
  return [...events].map((event,index)=>({event,index,time:eventTime(event)}))
    .filter(row=>row.time)
    .sort((a,b)=>String(a.time).localeCompare(String(b.time))||a.index-b.index)
    .map(row=>row.event);
}
function timingEvidence(events = []) {
  const sorted = sortEvents(events);
  const podEvents = sorted.filter(isPodEvent);
  const podEvent = podEvents.at(-1) || null;
  const podTime = eventTime(podEvent);
  if (!podTime) return { ok:false, reason:'POD_TRACK_TIME_MISSING', startTime:'', podTime:'', days:0, attempt:0, startMode:'' };

  const untilPod = sorted.filter(event => !eventTime(event) || eventTime(event) <= podTime);
  const deliveryStarts = untilPod.filter(isDeliveryStart);
  const assignStarts = untilPod.filter(isAssignStart);
  const starts = deliveryStarts.length ? deliveryStarts : assignStarts;
  const startEvent = starts[0] || null;
  const startTime = eventTime(startEvent);
  if (!startTime) return { ok:false, reason:'DELIVERY_START_MISSING', startTime:'', podTime, days:0, attempt:0, startMode:'' };

  const days = naturalDays(startTime,podTime);
  if (!days) return { ok:false, reason:'INVALID_TRACK_TIME_RANGE', startTime, podTime, days:0, attempt:0, startMode:'' };

  const strict = analyzeV246ShopeeAttemptCycle(untilPod,{podDate:podTime});
  return {
    ok:true,
    reason:'',
    startTime,
    podTime,
    days,
    attempt:Math.max(1,Math.min(3,Number(strict.attemptNo||1))),
    startMode:strict.startMode || (deliveryStarts.length?'TRACK_70':'TRACK_60_FALLBACK'),
    attemptSource:strict.source || ''
  };
}
function average(list = []) {
  const valid = list.filter(row => row.evidence?.ok && n(row.evidence?.days,0) > 0);
  if (!valid.length) return { avgDays:null, podCount:0 };
  const value = valid.reduce((sum,row)=>sum+n(row.evidence.days,0),0)/valid.length;
  return { avgDays:Number(value.toFixed(2)), podCount:valid.length };
}
function summarizeTimingRows(rows = []) {
  const podRows = rows.filter(row=>row.isPod);
  const usable = podRows.filter(row=>row.evidence?.ok);
  const missing = podRows.filter(row=>!row.evidence?.ok);
  return {
    overall:{...average(usable),totalPodCount:podRows.length,missingEvidenceCount:missing.length},
    pp:{...average(usable.filter(row=>row.region==='PP')),totalPodCount:podRows.filter(row=>row.region==='PP').length},
    pv:{...average(usable.filter(row=>row.region==='PV')),totalPodCount:podRows.filter(row=>row.region==='PV').length},
    attempt1:average(usable.filter(row=>row.evidence.attempt===1)),
    attempt2:average(usable.filter(row=>row.evidence.attempt===2)),
    attempt3:average(usable.filter(row=>row.evidence.attempt>=3)),
    evidence:{
      valid:usable.length,
      missing:missing.length,
      missingBills:missing.slice(0,200).map(row=>({shipmentCode:row.shipmentCode,reason:row.evidence?.reason||'TRACK_EVIDENCE_MISSING'}))
    }
  };
}
function businessStorageType(type) {
  return /^SHOPEE/.test(type) ? 'SHOPEE' : type;
}
function membershipFinalRows(snapshotId, reportDate, businessType) {
  const db=getDb();
  if (!snapshotId || !reportDate) return [];
  if (businessType==='TBKH') {
    return db.prepare(`
      SELECT u.shipmentCode,u.regionCode,u.reportDate,
             COALESCE(f.isPod,0) AS isPod,
             COALESCE(f.primaryCategory,'') AS primaryCategory,
             COALESCE(f.rawJson,'{}') AS rawJson
      FROM unified_import_rows u
      LEFT JOIN final_rows f ON f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      WHERE u.snapshotId=? AND u.reportDate=? AND UPPER(TRIM(u.businessType))='TBKH'
      ORDER BY u.rowNumber,u.shipmentCode
    `).all(snapshotId,reportDate);
  }
  const storageType=businessStorageType(businessType);
  return db.prepare(`
    SELECT u.businessType,u.shipmentCode,u.regionCode,u.reportDate,
           COALESCE(f.isPod,0) AS isPod,
           COALESCE(f.primaryCategory,'') AS primaryCategory,
           COALESCE(f.rawJson,'{}') AS rawJson
    FROM unified_import_rows u
    LEFT JOIN business_final_rows f
      ON f.businessType=? AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
    WHERE u.snapshotId=? AND u.reportDate=? AND UPPER(TRIM(u.businessType))=?
    ORDER BY u.rowNumber,u.shipmentCode
  `).all(storageType,snapshotId,reportDate,businessType);
}
function eventsForBills(reportDate,businessType,bills=[]) {
  if (!bills.length) return new Map();
  const db=getDb();
  const set=new Set(bills.map(value=>String(value||'').trim().toUpperCase()).filter(Boolean));
  const result=new Map([...set].map(code=>[code,[]]));
  const chunks=[];const values=[...set];
  for(let i=0;i<values.length;i+=400)chunks.push(values.slice(i,i+400));
  for(const chunk of chunks){
    const marks=chunk.map(()=>'?').join(',');
    const rows=businessType==='TBKH'
      ? db.prepare(`SELECT shipmentCode,eventCode,trackingEventCode,trackingEventDesc,trackingEventDescZh,trackingEventDescKm,eventTime,place,rawJson
          FROM track_events WHERE reportDate=? AND shipmentCode IN (${marks}) ORDER BY eventTime,id`).all(reportDate,...chunk)
      : db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson
          FROM business_track_events WHERE businessType=? AND reportDate=? AND shipmentCode IN (${marks}) ORDER BY eventTime,id`).all(businessStorageType(businessType),reportDate,...chunk);
    for(const row of rows){
      const bill=String(row.shipmentCode||'').trim().toUpperCase();
      if(!result.has(bill))result.set(bill,[]);
      result.get(bill).push(row);
    }
  }
  return result;
}
function isReturned(row={}) {
  const raw=safeJson(row.rawJson);
  const values=[row.primaryCategory,raw.primaryCategory,raw.主分类,raw.异常分类,raw.退回状态,raw.currentState,raw.scanNormalizedState]
    .map(value=>String(value||'').toUpperCase());
  return values.some(value=>value==='已退回'||value.includes('退回')||value==='RETURNED'||value==='RETURN_COMPLETED');
}
function timingRows(snapshotId,reportDate,businessType) {
  if(!snapshotId||!reportDate||!TIMING_TYPES.includes(businessType))return[];
  const rows=membershipFinalRows(snapshotId,reportDate,businessType);
  const events=eventsForBills(reportDate,businessType,rows.map(row=>row.shipmentCode));
  return rows.map(row=>({
    shipmentCode:String(row.shipmentCode||'').trim().toUpperCase(),
    region:String(row.regionCode||'').toUpperCase(),
    isPod:Number(row.isPod||0)===1,
    isReturned:isReturned(row),
    evidence:timingEvidence(events.get(String(row.shipmentCode||'').trim().toUpperCase())||[])
  }));
}
function timingForBatch(batch,businessType) {
  if(!batch?.snapshotId||!batch?.reportDate){
    return {
      businessType,reportDate:batch?.reportDate||'',
      overall:{avgDays:null,podCount:0,totalPodCount:0,missingEvidenceCount:0},
      pp:{avgDays:null,podCount:0,totalPodCount:0},pv:{avgDays:null,podCount:0,totalPodCount:0},
      attempt1:{avgDays:null,podCount:0},attempt2:{avgDays:null,podCount:0},attempt3:{avgDays:null,podCount:0},
      evidence:{valid:0,missing:0,missingBills:[]}
    };
  }
  return {businessType,reportDate:batch.reportDate,...summarizeTimingRows(timingRows(batch.snapshotId,batch.reportDate,businessType))};
}
function returnSummaryForBatch(batch,businessType) {
  const total=n(batch?.classificationCounts?.[businessType],0);
  if(!RETURN_TYPES.has(businessType)||!batch?.snapshotId||!batch?.reportDate)return{count:0,rate:0,total};
  const rows=membershipFinalRows(batch.snapshotId,batch.reportDate,businessType);
  const count=rows.filter(isReturned).length;
  return{count,rate:total?Number((count*100/total).toFixed(2)):0,total};
}
function classificationForBatch(batch) {
  if (!batch) {
    return {
      reportDate:'',snapshotId:'',total:0,classified:0,autoRecognized:0,unrecognized:0,conflicts:0,
      accuracyRate:0,coverageRate:0,balanced:false,counts:Object.fromEntries(TYPES.map(type=>[type,0])),
      businesses:TYPES.map(type=>({businessType:type,count:0,share:0,status:'暂无日报'}))
    };
  }
  const counts=Object.assign(Object.fromEntries(TYPES.map(type=>[type,0])),batch.classificationCounts||{});
  const total=n(batch.summary?.validUniqueWaybills,0);
  const classified=TYPES.reduce((sum,type)=>sum+n(counts[type],0),0);
  const conflicts=Math.max(0,n(batch.summary?.classificationConflicts,0));
  const unrecognized=Math.max(0,total-classified);
  const autoRecognized=Math.max(0,classified-conflicts);
  const balanced=Boolean(batch.sourceReconciliation?.balanced)&&classified===total;
  const accuracyRate=total?Number((autoRecognized*100/total).toFixed(2)):0;
  const coverageRate=total?Number((classified*100/total).toFixed(2)):0;
  return {
    reportDate:batch.reportDate||'',snapshotId:batch.snapshotId||'',
    total,classified,autoRecognized,unrecognized,conflicts,accuracyRate,coverageRate,balanced,counts,
    businesses:TYPES.map(type=>({
      businessType:type,count:n(counts[type],0),share:total?Number((n(counts[type],0)*100/total).toFixed(2)):0,status:balanced?'已分类':'待核验'
    }))
  };
}

function selectUnifiedBatch({ reportDate='', snapshotId='' }={}) {
  const latest=getLatestUnifiedImport();
  const wantedDate=String(reportDate||'').trim();
  const wantedSnapshot=String(snapshotId||'').trim();
  if (!wantedDate && !wantedSnapshot) return latest;
  if (latest && (!wantedSnapshot || latest.snapshotId===wantedSnapshot) && (!wantedDate || latest.reportDate===wantedDate)) return latest;
  const history=listUnifiedImportHistory(1000);
  return history.find(batch =>
    (!wantedSnapshot || String(batch?.snapshotId||'')===wantedSnapshot) &&
    (!wantedDate || String(batch?.reportDate||'')===wantedDate)
  ) || null;
}

export function buildHomeQualitySummary(options={}) {
  const latest=selectUnifiedBatch(options);
  const history=listUnifiedImportHistory(30);
  const classification=classificationForBatch(latest);
  const timing=Object.fromEntries(TIMING_TYPES.map(type=>[type,timingForBatch(latest,type)]));
  const returns=Object.fromEntries(TYPES.map(type=>[type,returnSummaryForBatch(latest,type)]));
  const timingTrend=Object.fromEntries(TIMING_TYPES.map(type=>[
    type,
    history.slice().reverse().map(batch=>{
      const current=timingForBatch(batch,type);
      return{reportDate:batch.reportDate||'',avgDays:current.overall.avgDays,podCount:current.overall.podCount,totalPodCount:current.overall.totalPodCount};
    })
  ]));
  return {
    ok:true,
    generatedAt:new Date().toISOString(),
    reportDate:latest?.reportDate||'',
    snapshotId:latest?.snapshotId||'',
    reportDateSource:latest?.reportDateSource||latest?.summary?.reportDateSource||'',
    reportDateAutoDetected:Boolean(latest?.reportDateAutoDetected??latest?.summary?.reportDateAutoDetected??true),
    requestedReportDate:String(options?.reportDate||''),
    requestedSnapshotId:String(options?.snapshotId||''),
    selectionMatched:Boolean(latest),
    classification,
    timing,
    timingTrend,
    returns,
    timingRule:{
      start:'TRACK_70_DELIVERY_START',
      fallback:'TRACK_60_ASSIGN_START_ONLY_WHEN_NO_70',
      terminal:'TRACK_80_POD',
      missingEvidence:'EXCLUDED_FROM_AVERAGE',
      dayMode:'CAMBODIA_NATURAL_DAY_INCLUSIVE'
    }
  };
}
