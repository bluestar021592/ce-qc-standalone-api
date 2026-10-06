import { getDb } from './db.js';
import { getLatestUnifiedImport, listUnifiedImportHistory } from './unifiedImportStore.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';
import { loadWhppState } from './whppStore.js';
import { buildWhppDashboard } from './whppReporting.js';
import { loadWhppCanonicalTruth } from './whppCanonicalTruth.js';
import { recoverHistoricalMemberEvidence } from './historicalMemberEvidence.js';
import { ensureHistoricalEvidenceJob } from './historicalEvidenceWorkerManager.js';
import { requestV328EvidenceRepair, inspectV328EvidenceRepair } from './v328EvidenceRepairCoordinator.js';
import { requestWhppSigningEvidenceRepair, inspectWhppSigningEvidenceRepair } from './whppSigningEvidenceRepair.js';
import { readV329ThreeBusinessDailyCache } from './v329ThreeBusinessDailyCache.js';
import { requestSelectedDateTimingRepair, inspectSelectedDateTimingRepair, selectedDatePodBills } from './selectedDateTimingEvidenceRepair.js';

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
      missingBills:missing.slice(0,500).map(row=>({shipmentCode:row.shipmentCode,reason:row.evidence?.reason||'TRACK_EVIDENCE_MISSING'})),
      sourceCounts:usable.reduce((acc,row)=>{const key=row.evidence?.evidenceSource||'unknown';acc[key]=(acc[key]||0)+1;return acc},{})
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
             CASE
               WHEN COALESCE(f.isPod,0)=1 THEN 1
               WHEN UPPER(COALESCE(c.state,'')) IN ('POD','DELIVERED','SIGNED') THEN 1
               WHEN COALESCE(s.isPod,0)=1 OR TRIM(COALESCE(s.orderStatus,''))='85' THEN 1
               ELSE 0
             END AS isPod,
             COALESCE(NULLIF(f.primaryCategory,''),CASE WHEN UPPER(COALESCE(c.state,''))='POD' THEN 'POD' ELSE '' END,'') AS primaryCategory,
             COALESCE(NULLIF(f.rawJson,''),NULLIF(c.stateJson,''),NULLIF(s.rawJson,''),'{}') AS rawJson
      FROM unified_import_rows u
      LEFT JOIN final_rows f ON f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      LEFT JOIN shipment_current_state c ON c.shipmentCode=u.shipmentCode AND c.reportDate=u.reportDate AND UPPER(TRIM(c.businessType))='TBKH'
      LEFT JOIN scan_results s ON s.shipmentCode=u.shipmentCode AND s.reportDate=u.reportDate
      WHERE u.snapshotId=? AND u.reportDate=? AND UPPER(TRIM(u.businessType))='TBKH'
      ORDER BY u.rowNumber,u.shipmentCode
    `).all(snapshotId,reportDate);
  }
  const storageType=businessStorageType(businessType);
  return db.prepare(`
    SELECT u.businessType,u.shipmentCode,u.regionCode,u.reportDate,
           CASE
             WHEN COALESCE(f.isPod,0)=1 THEN 1
             WHEN UPPER(COALESCE(c.state,'')) IN ('POD','DELIVERED','SIGNED') THEN 1
             WHEN COALESCE(s.isPod,0)=1 OR TRIM(COALESCE(s.orderStatus,''))='85' THEN 1
             WHEN p.shipmentCode IS NOT NULL THEN 1
             ELSE 0
           END AS isPod,
           COALESCE(NULLIF(f.primaryCategory,''),CASE WHEN UPPER(COALESCE(c.state,'')) IN ('POD','DELIVERED','SIGNED') OR p.shipmentCode IS NOT NULL THEN 'POD' ELSE '' END,'') AS primaryCategory,
           COALESCE(NULLIF(f.rawJson,''),NULLIF(c.stateJson,''),NULLIF(s.rawJson,''),'{}') AS rawJson
    FROM unified_import_rows u
    LEFT JOIN business_final_rows f
      ON f.businessType=? AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
    LEFT JOIN shipment_current_state c
      ON c.shipmentCode=u.shipmentCode AND c.reportDate=u.reportDate AND UPPER(TRIM(c.businessType))=UPPER(TRIM(u.businessType))
    LEFT JOIN business_scan_results s
      ON s.businessType=? AND s.shipmentCode=u.shipmentCode AND s.reportDate=u.reportDate
    LEFT JOIN business_pod_locks p
      ON p.businessType=? AND p.shipmentCode=u.shipmentCode
    WHERE u.snapshotId=? AND u.reportDate=? AND UPPER(TRIM(u.businessType))=?
    ORDER BY u.rowNumber,u.shipmentCode
  `).all(storageType,storageType,storageType,snapshotId,reportDate,businessType);
}
function pushEvidenceRows(result, rows=[], source='') {
  for(const row of rows||[]){
    const bill=String(row.shipmentCode||'').trim().toUpperCase();
    if(!bill||!result.has(bill))continue;
    result.get(bill).push({...row,evidenceSource:source});
  }
}
function eventsForBills(reportDate,businessType,bills=[]) {
  if (!bills.length) return new Map();
  const db=getDb();
  const set=new Set(bills.map(value=>String(value||'').trim().toUpperCase()).filter(Boolean));
  const result=new Map([...set].map(code=>[code,[]]));
  const chunks=[];const values=[...set];
  for(let i=0;i<values.length;i+=350)chunks.push(values.slice(i,i+350));
  for(const chunk of chunks){
    const marks=chunk.map(()=>'?').join(',');
    try{
      const core=db.prepare(`SELECT shipmentCode,eventCode,trackingEventCode,trackingEventDesc,trackingEventDescZh,trackingEventDescKm,eventTime,place,rawJson,reportDate
        FROM track_events WHERE shipmentCode IN (${marks}) ORDER BY eventTime,id`).all(...chunk);
      pushEvidenceRows(result,core,'track_events');
    }catch{}
    try{
      const business=db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,reportDate
        FROM business_track_events WHERE businessType=? AND shipmentCode IN (${marks}) ORDER BY eventTime,id`).all(businessStorageType(businessType),...chunk);
      pushEvidenceRows(result,business,'business_track_events');
    }catch{}
  }
  for(const [bill,rows] of result){
    const seen=new Set();
    result.set(bill,rows.filter(row=>{
      const key=[eventTime(row),eventCode(row),eventText(row)].join('|');
      if(seen.has(key))return false;seen.add(key);return true;
    }));
  }
  return result;
}
function ledgerEvidenceForBills(bills=[]){
  const db=getDb();const result=new Map();if(!bills.length)return result;
  const values=[...new Set(bills.map(value=>String(value||'').trim().toUpperCase()).filter(Boolean))];
  for(let i=0;i<values.length;i+=350){
    const chunk=values.slice(i,i+350),marks=chunk.map(()=>'?').join(',');
    try{
      for(const row of db.prepare(`SELECT shipmentCode,businessType,terminalReason,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastEventTime,lastCheckedAt
        FROM qc_tracking_ledger WHERE shipmentCode IN (${marks})`).all(...chunk)){
        result.set(String(row.shipmentCode||'').trim().toUpperCase(),row);
      }
    }catch{}
  }
  return result;
}
function strictLedgerTiming(row={}){
  const source=String(row.attemptSource||'');
  const days=Number(row.signingDays||0),attempt=Number(row.attemptNo||0);
  if(row.terminalReason!=='POD'||!/^V246_STRICT_TRACK/i.test(source)||!Number.isFinite(days)||days<=0||attempt<=0)return null;
  const evidence=safeJson(row.evidenceJson);
  return {
    ok:true,reason:'',startTime:evidence.strictStartDate||evidence.starts?.[0]?.time||'',
    podTime:row.podDate||'',days,attempt:Math.max(1,Math.min(3,attempt)),
    startMode:evidence.startMode||'V246_STRICT_TRACK',attemptSource:source,evidenceSource:'qc_tracking_ledger'
  };
}
function isReturned(row={}) {
  const raw=safeJson(row.rawJson);
  const rawValues=[row.primaryCategory,raw.primaryCategory,raw.主分类,raw.异常分类,raw.退回状态,raw.currentState,raw.scanNormalizedState]
    .map(value=>String(value||'').trim().toUpperCase()).filter(Boolean);
  const negative=/^(未退回|非退回|待退回|NOT_RETURNED|NO_RETURN|PENDING_RETURN)$/;
  const positive=/^(已退回|退回|退回完成|RETURN|RETURNED|RETURN_COMPLETED)$/;
  return rawValues.some(value=>!negative.test(value)&&positive.test(value));
}
function positivePodMembership(row={},ledgerRow={}){
  if(Number(row.isPod||0)===1)return true;
  if(String(ledgerRow.terminalReason||'').toUpperCase()==='POD'&&String(ledgerRow.podDate||ledgerRow.terminalAt||'').trim())return true;
  const raw=safeJson(row.rawJson);
  const status=String(raw.orderStatus||raw.shipmentStatus||raw.scanNormalizedState||raw.currentState||'').toUpperCase();
  const text=[row.primaryCategory,raw.primaryCategory,raw.主分类,raw.最新状态,raw.currentState,raw.scanNormalizedState,raw.statusText].map(v=>String(v||'')).join(' ');
  if(status==='85'||status==='POD'||status==='DELIVERED'||status==='SIGNED')return true;
  return Boolean(text&&!NEGATIVE_POD_RE.test(text)&&POSITIVE_POD_RE.test(text));
}
function dedicatedWhppTimingRows(reportDate=''){
  try{
    const truth=loadWhppCanonicalTruth(reportDate);
    return (truth.rows||[]).map(row=>({
      ...row,
      shipmentCode:String(row.shipmentCode||row.运单号||'').trim().toUpperCase(),
      regionCode:String(row.regionCode||row.区域||'').toUpperCase(),
      isPod:row.truthEvidence?.pod?1:(row.是否POD==='是'||row.POD状态==='POD'||String(row.currentState||'').toUpperCase()==='POD'?1:0),
      primaryCategory:row.primaryCategory||row.主分类||row.异常分类||'',
      rawJson:JSON.stringify(row)
    }));
  }catch{return[]}
}
function timingRows(snapshotId,reportDate,businessType) {
  if(!reportDate||!TIMING_TYPES.includes(businessType))return[];
  const whppTruth=businessType==='WHPP'?loadWhppCanonicalTruth(reportDate,snapshotId||''):null;
  const sourceRows=whppTruth
    ? (whppTruth.rows||[]).map(row=>({
        ...row,
        shipmentCode:String(row.shipmentCode||row.运单号||'').trim().toUpperCase(),
        regionCode:String(row.regionCode||row.区域||'').toUpperCase(),
        isPod:row.truthEvidence?.pod?1:(row.是否POD==='是'||row.POD状态==='POD'||String(row.currentState||'').toUpperCase()==='POD'?1:0),
        primaryCategory:row.primaryCategory||row.主分类||row.异常分类||'',
        rawJson:JSON.stringify(row)
      }))
    : membershipFinalRows(snapshotId,reportDate,businessType);

  const canonicalPodSet=new Set(selectedDatePodBills(businessType,reportDate,snapshotId));
  const rowMap=new Map();
  for(const row of sourceRows||[]){
    const bill=String(row.shipmentCode||'').trim().toUpperCase();
    if(bill&&!rowMap.has(bill))rowMap.set(bill,{...row,shipmentCode:bill});
  }

  // V661: formal POD membership is itself authoritative timing membership.
  // If an immutable business snapshot says a bill is POD but an intermediate
  // membership view omitted that bill, add it back instead of silently
  // shrinking the timing denominator to zero.
  if(canonicalPodSet.size){
    const db=getDb();
    const missing=[...canonicalPodSet].filter(bill=>!rowMap.has(bill));
    for(let i=0;i<missing.length;i+=350){
      const chunk=missing.slice(i,i+350),marks=chunk.map(()=>'?').join(',');
      let meta=new Map();
      try{
        const rows=db.prepare(`SELECT UPPER(TRIM(shipmentCode)) shipmentCode,UPPER(TRIM(COALESCE(regionCode,''))) regionCode,businessType
          FROM unified_import_rows
          WHERE reportDate=? AND UPPER(TRIM(shipmentCode)) IN (${marks})`).all(reportDate,...chunk);
        meta=new Map(rows.map(row=>[String(row.shipmentCode||'').trim().toUpperCase(),row]));
      }catch{}
      for(const bill of chunk){
        const row=meta.get(bill)||{};
        rowMap.set(bill,{
          shipmentCode:bill,
          regionCode:String(row.regionCode||'').toUpperCase(),
          reportDate,
          businessType:row.businessType||businessType,
          isPod:1,
          primaryCategory:'POD',
          rawJson:JSON.stringify({shipmentCode:bill,reportDate,businessType,regionCode:row.regionCode||'',membershipSource:'canonical_pod_snapshot'})
        });
      }
    }
  }

  const rows=[...rowMap.values()];
  const bills=rows.map(row=>row.shipmentCode);
  const events=eventsForBills(reportDate,businessType,bills);
  if(whppTruth?.recoveredTrackEvents?.length)pushEvidenceRows(events,whppTruth.recoveredTrackEvents,'whpp_recovered_snapshot');
  const ledger=ledgerEvidenceForBills(bills);
  return rows.map(row=>{
    const shipmentCode=String(row.shipmentCode||'').trim().toUpperCase();
    const direct=timingEvidence(events.get(shipmentCode)||[]);
    const strictLedger=!direct.ok?strictLedgerTiming(ledger.get(shipmentCode)||{}):null;
    const ledgerRow=ledger.get(shipmentCode)||{};
    return {
      shipmentCode,region:String(row.regionCode||'').toUpperCase(),
      isPod:Boolean(canonicalPodSet.has(shipmentCode)||positivePodMembership(row,ledgerRow)),isReturned:isReturned(row),
      evidence:direct.ok?{...direct,evidenceSource:(events.get(shipmentCode)||[]).some(x=>x.evidenceSource==='track_events')?'track_events':'business_track_events'}:(strictLedger||direct),
      membershipSource:canonicalPodSet.has(shipmentCode)?'canonical_pod_snapshot':(Number(row.isPod||0)===1?'final_rows':(String(ledgerRow.terminalReason||'').toUpperCase()==='POD'?'qc_tracking_ledger':'raw_terminal_proof'))
    };
  });
}
async function timingForBatchWithArchive(batch,businessType,recoveredOverride=null){
  if(!batch?.snapshotId||!batch?.reportDate){
    return timingForBatch(batch,businessType);
  }
  const baseRows=timingRows(batch.snapshotId,batch.reportDate,businessType);
  const bills=baseRows.map(row=>row.shipmentCode).filter(Boolean);
  if(!bills.length)return {businessType,reportDate:batch.reportDate,...summarizeTimingRows(baseRows)};
  const recovered=recoveredOverride||await recoverHistoricalMemberEvidence({
    reportDate:batch.reportDate,businessType,targetBills:bills
  });
  const events=eventsForBills(batch.reportDate,businessType,bills);
  for(const [code,rows] of recovered.eventsByBill||[]){
    pushEvidenceRows(events,rows,'historical_archive');
  }
  const ledger=ledgerEvidenceForBills(bills);
  const rows=baseRows.map(row=>{
    const shipmentCode=String(row.shipmentCode||'').trim().toUpperCase();
    const archivePod=Boolean(recovered.podBills?.has?.(shipmentCode));
    const direct=timingEvidence(events.get(shipmentCode)||[]);
    const ledgerRow=ledger.get(shipmentCode)||{};
    const strictLedger=!direct.ok?strictLedgerTiming(ledgerRow):null;
    return{
      ...row,
      isPod:Boolean(row.isPod||archivePod||positivePodMembership(row,ledgerRow)),
      evidence:direct.ok?{...direct,evidenceSource:(events.get(shipmentCode)||[]).some(x=>x.evidenceSource==='historical_archive')?'historical_archive':(events.get(shipmentCode)||[]).some(x=>x.evidenceSource==='track_events')?'track_events':'business_track_events'}:(strictLedger||direct),
      membershipSource:archivePod?(recovered.podEvidenceByBill?.get?.(shipmentCode)?.source||'historical_archive'):(row.membershipSource||'current_truth')
    };
  });
  return{
    businessType,reportDate:batch.reportDate,
    ...summarizeTimingRows(rows),
    archiveRecovery:{readOnly:true,...(recovered.stats||{})}
  };
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
  if(businessType==='WHPP'&&batch?.reportDate){
    try{
      const truth=loadWhppCanonicalTruth(batch.reportDate,batch.snapshotId||'');
      const total=n(truth.total,0),count=(truth.rows||[]).filter(row=>row.truthEvidence?.returned||isReturned({...row,rawJson:JSON.stringify(row)})).length;
      return{count,rate:total?Number((count*100/total).toFixed(2)):0,total};
    }catch{}
  }
  const total=n(batch?.classificationCounts?.[businessType],0);
  if(!RETURN_TYPES.has(businessType)||!batch?.snapshotId||!batch?.reportDate)return{count:0,rate:0,total};
  const rows=membershipFinalRows(batch.snapshotId,batch.reportDate,businessType);
  const count=rows.filter(isReturned).length;
  return{count,rate:total?Number((count*100/total).toFixed(2)):0,total};
}
function dedicatedWhppCount(reportDate='') {
  try{return n(loadWhppCanonicalTruth(reportDate)?.total,0)}
  catch{return 0}
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
  const whppDedicated=dedicatedWhppCount(batch.reportDate||'');
  if(whppDedicated>0)counts.WHPP=whppDedicated;
  const sourceTotal=n(batch.summary?.validUniqueWaybills,0);
  const classified=TYPES.reduce((sum,type)=>sum+n(counts[type],0),0);
  const total=classified>0?classified:sourceTotal;
  const conflicts=Math.max(0,n(batch.summary?.classificationConflicts,0));
  const unrecognized=Math.max(0,total-classified);
  const autoRecognized=Math.max(0,classified-conflicts);
  const balanced=classified===total;
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

function hasBusinessData(batch) {
  if (!batch) return false;
  const classified=TYPES.reduce((sum,type)=>sum+n(batch?.classificationCounts?.[type],0),0);
  return classified>0;
}
function selectUnifiedBatch({ reportDate='', snapshotId='' }={}) {
  const latest=getLatestUnifiedImport();
  const wantedDate=String(reportDate||'').trim();
  const wantedSnapshot=String(snapshotId||'').trim();
  const history=listUnifiedImportHistory(1000);
  if (!wantedDate && !wantedSnapshot) return hasBusinessData(latest) ? latest : (history.find(hasBusinessData) || latest);
  if (latest && (!wantedSnapshot || latest.snapshotId===wantedSnapshot) && (!wantedDate || latest.reportDate===wantedDate)) return latest;
  return history.find(batch =>
    (!wantedSnapshot || String(batch?.snapshotId||'')===wantedSnapshot) &&
    (!wantedDate || String(batch?.reportDate||'')===wantedDate)
  ) || null;
}

function timingWithSavedCacheFallback(batch,type,current){
  if(!batch?.reportDate||!['TBKH','SHOPEECN','SHOPEEVN'].includes(type))return current;
  if(current?.overall?.avgDays!==null&&current?.overall?.avgDays!==undefined)return current;
  try{
    const cache=readV329ThreeBusinessDailyCache(type,batch.reportDate,getDb(),batch.reportDate);
    const row=(cache.daily||[]).find(item=>String(item.reportDate||'')===String(batch.reportDate||''))||null;
    if(!row||row.avgSigningDays===null||row.avgSigningDays===undefined)return current;
    const podCount=n(row.signingSampleCount||row.signingDaysCount,0);
    const totalPod=n(row.pod,0);
    return{
      ...current,
      overall:{...(current?.overall||{}),avgDays:row.avgSigningDays,podCount,totalPodCount:totalPod,missingEvidenceCount:Math.max(0,totalPod-podCount)},
      pp:{...(current?.pp||{}),avgDays:row.ppAvgSigningDays,podCount:n(row.ppSigningSampleCount||row.ppSigningDaysCount,0),totalPodCount:n(current?.pp?.totalPodCount,0)},
      pv:{...(current?.pv||{}),avgDays:row.pvAvgSigningDays,podCount:n(row.pvSigningSampleCount||row.pvSigningDaysCount,0),totalPodCount:n(current?.pv?.totalPodCount,0)},
      evidence:{...(current?.evidence||{}),valid:podCount,missing:Math.max(0,totalPod-podCount),cacheSource:row.source||cache.source||'V329_DAILY_CACHE'},
      cacheFallback:{source:row.source||cache.source||'V329_DAILY_CACHE',updatedAt:row.updatedAt||'',truthfulSavedEvidence:true}
    };
  }catch{return current}
}

function safeTimingForBatch(batch,type){
  try{return timingWithSavedCacheFallback(batch,type,timingForBatch(batch,type))}
  catch(error){
    console.warn('[CE-QC][HOME_SUMMARY_TIMING_FALLBACK]',type,error?.message||String(error));
    return {
      businessType:type,reportDate:batch?.reportDate||'',
      overall:{avgDays:null,podCount:0,totalPodCount:0,missingEvidenceCount:0},
      pp:{avgDays:null,podCount:0,totalPodCount:0},pv:{avgDays:null,podCount:0,totalPodCount:0},
      attempt1:{avgDays:null,podCount:0},attempt2:{avgDays:null,podCount:0},attempt3:{avgDays:null,podCount:0},
      evidence:{valid:0,missing:0,missingBills:[]},degraded:true,error:String(error?.message||error)
    };
  }
}
function safeReturnSummaryForBatch(batch,type){
  try{return returnSummaryForBatch(batch,type)}
  catch(error){
    console.warn('[CE-QC][HOME_SUMMARY_RETURN_FALLBACK]',type,error?.message||String(error));
    return {count:0,rate:0,total:n(batch?.classificationCounts?.[type],0),degraded:true,error:String(error?.message||error)};
  }
}


export function diagnoseSelectedDateTiming(reportDate='',snapshotId=''){
  const date=String(reportDate||'').slice(0,10);
  const result={reportDate:date,snapshotId:String(snapshotId||''),types:{}};
  for(const type of TIMING_TYPES){
    try{
      const canonical=selectedDatePodBills(type,date,snapshotId);
      const rows=timingRows(snapshotId,date,type);
      const summary=summarizeTimingRows(rows);
      result.types[type]={
        canonicalPodCount:canonical.length,
        timingRowCount:rows.length,
        timingPodCount:summary.overall.totalPodCount,
        validEvidenceCount:summary.overall.podCount,
        missingEvidenceCount:summary.overall.missingEvidenceCount,
        sampleCanonicalBills:canonical.slice(0,5),
        sampleTimingPodBills:rows.filter(row=>row.isPod).slice(0,5).map(row=>row.shipmentCode)
      };
    }catch(error){
      result.types[type]={error:String(error?.message||error)};
    }
  }
  return result;
}
export async function buildHomeQualitySummaryWithArchive(options={}){
  const base=buildHomeQualitySummary(options);
  const batch=selectUnifiedBatch(options);
  if(!batch)return base;

  const repairStates={};
  for(const type of TIMING_TYPES){
    const current=base.timing?.[type]||{};
    const count=n(base.classification?.counts?.[type],0);
    const needs=count>0&&(current.overall?.avgDays==null||n(current.evidence?.missing,0)>0||n(current.overall?.podCount,0)===0);
    repairStates[type]=needs
      ? requestSelectedDateTimingRepair(type,batch.reportDate,batch.snapshotId)
      : inspectSelectedDateTimingRepair(type,batch.reportDate,batch.snapshotId);
  }


  const rowGroups=Object.fromEntries(TIMING_TYPES.map(type=>{
    const rows=timingRows(batch.snapshotId,batch.reportDate,type);
    return[type,rows.map(row=>row.shipmentCode).filter(Boolean)];
  }));
  const job=ensureHistoricalEvidenceJob({reportDate:batch.reportDate,groups:rowGroups});
  const repairActive=Object.values(repairStates).some(item=>['QUEUED','STARTING','RUNNING'].includes(String(item?.status||'').toUpperCase()));
  const repairFailed=Object.values(repairStates).some(item=>String(item?.status||'').toUpperCase()==='FAILED');
  const repairSummary={active:repairActive,failed:repairFailed,types:repairStates};

  if(job.state!=='COMPLETED'||!job.result){
    const localTiming=Object.fromEntries(TIMING_TYPES.map(type=>[
      type,
      timingWithSavedCacheFallback(batch,type,safeTimingForBatch(batch,type))
    ]));
    return{...base,timing:localTiming,historicalEvidenceRecovery:{state:job.state,error:job.error||'',readOnly:true,blocking:false},timingEvidenceRepair:repairSummary};
  }
  const timingEntries=await Promise.all(TIMING_TYPES.map(async type=>[
    type,
    timingWithSavedCacheFallback(batch,type,await timingForBatchWithArchive(batch,type,job.result[type]||null))
  ]));
  return{...base,timing:Object.fromEntries(timingEntries),historicalEvidenceRecovery:{state:'COMPLETED',readOnly:true},timingEvidenceRepair:repairSummary};
}
export function buildHomeQualitySummary(options={}) {
  const latest=selectUnifiedBatch(options);
  const history=listUnifiedImportHistory(30);
  const classification=classificationForBatch(latest);
  const timing=Object.fromEntries(TIMING_TYPES.map(type=>[type,safeTimingForBatch(latest,type)]));
  const returns=Object.fromEntries(TYPES.map(type=>[type,safeReturnSummaryForBatch(latest,type)]));
  const timingTrend=Object.fromEntries(TIMING_TYPES.map(type=>[
    type,
    history.slice().reverse().map(batch=>{
      const current=safeTimingForBatch(batch,type);
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
