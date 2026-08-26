import { getDb } from './db.js';
import { readV320HistoricalDaily, V320_HISTORICAL_DAILY_TRUTH_ID } from './v320HistoricalDailyTruth.js';

export const V320_DISPATCH_METRIC_OVERLAY_ID='2026-08-26-v320-cache-reconciled-dispatch-overlay-v4';
const TYPES=new Set(['SHOPEECN','SHOPEEVN']);
const ALL_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(a,b)=>b?Number((n(a)*100/n(b)).toFixed(2)):null;
const dateKey=v=>{const m=String(v||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const safeJson=v=>{try{return v&&typeof v==='object'?v:(JSON.parse(String(v||'{}'))||{});}catch{return{};}};
function scopeTypes(scope){const type=String(scope||'ALL').toUpperCase();if(ALL_TYPES.includes(type))return[type];if(type==='CCSL')return['CE','CEAF','TBKH','ALI1688'];if(type==='SHOPEE')return['SHOPEECN','SHOPEEVN'];return ALL_TYPES;}
function addMetric(out,m={}){for(const key of ['total','pod','returned','cancelled','sameDayPod','ocCurrent','pendingNonContinuous','pending3','oc1','oc2','cycle2','shopRetention2','workOrder','inboundNoScan','provinceOpen','attempt1','attempt2','attempt3'])out[key]=n(out[key])+n(m[key]);}
function completedCacheRows(scope,dates,db){
  const result=new Map();if(!dates.length)return result;const types=scopeTypes(scope),dm=dates.map(()=>'?').join(','),tm=types.map(()=>'?').join(',');
  let rows=[];try{rows=db.prepare(`SELECT reportDate,businessType,metricsJson,snapshotStatus,refreshedAt FROM dashboard_daily_cache WHERE reportDate IN (${dm}) AND UPPER(TRIM(businessType)) IN (${tm}) AND snapshotStatus='COMPLETED' ORDER BY reportDate,businessType,regionCode`).all(...dates,...types);}catch{return result;}
  for(const row of rows){const d=dateKey(row.reportDate);if(!d)continue;const fact=result.get(d)||{reportDate:d,total:0,pod:0,returned:0,cancelled:0,sameDayPod:0,ocCurrent:0,pendingNonContinuous:0,pending3:0,oc1:0,oc2:0,cycle2:0,shopRetention2:0,workOrder:0,inboundNoScan:0,provinceOpen:0,attempt1:0,attempt2:0,attempt3:0,rows:0,refreshedAt:''};addMetric(fact,safeJson(row.metricsJson));fact.rows+=1;fact.refreshedAt=String(row.refreshedAt||fact.refreshedAt);result.set(d,fact);}
  return result;
}
function applyCompletedCacheOverlay(scope,daily,db){const map=completedCacheRows(scope,daily.map(r=>dateKey(r.reportDate)).filter(Boolean),db);return daily.map(row=>{const cached=map.get(dateKey(row.reportDate));if(!cached||n(cached.total)!==n(row.total))return{...row,currentCacheOverlayApplied:false};const total=n(row.total),pod=n(cached.pod);return{...row,...cached,total,pod,matched:total,ready:true,ledgerReady:true,podRate:pct(pod,total)??0,sameDayPodRate:pct(cached.sameDayPod,total)??0,ocRate:pct(cached.ocCurrent,total)??0,currentCacheOverlayApplied:true,currentCacheOverlaySource:'RECONCILED_COMPLETED_DASHBOARD_CACHE_MATCHED_DENOMINATOR'};});}

function overlayRows(type,dates,db){
  const out=new Map();if(!dates.length)return out;const group=type==='SHOPEECN'?'CN':'VN',marks=dates.map(()=>'?').join(',');
  try{
    const rows=db.prepare(`WITH facts AS (
      SELECT f.reportDate,f.shipmentCode,COALESCE(f.isPod,0) isPod,
        COALESCE(NULLIF(f.podAttemptNo,0),NULLIF(CAST(CASE WHEN json_valid(f.rawJson) THEN json_extract(f.rawJson,'$.podAttemptNo') END AS INTEGER),0),NULLIF(CASE WHEN json_valid(f.attemptHistoryJson) THEN json_array_length(f.attemptHistoryJson) END,0),NULLIF(l.attemptNo,0),0) attemptNo,
        COALESCE(NULLIF(f.firstAttemptAt,''),NULLIF(CASE WHEN json_valid(f.rawJson) THEN json_extract(f.rawJson,'$.firstAttemptAt') END,''),NULLIF(CASE WHEN json_valid(f.rawJson) THEN json_extract(f.rawJson,'$."首次派件时间"') END,''),NULLIF(CASE WHEN json_valid(f.rawJson) THEN json_extract(f.rawJson,'$."首次派送时间"') END,''),NULLIF(CASE WHEN json_valid(f.attemptHistoryJson) THEN json_extract(f.attemptHistoryJson,'$[0]') END,''),NULLIF(CASE WHEN json_valid(l.evidenceJson) THEN json_extract(l.evidenceJson,'$.starts[0].time') END,''),NULLIF(CASE WHEN json_valid(l.currentStateJson) THEN json_extract(l.currentStateJson,'$.firstAttemptAt') END,''),'') dispatchAt,
        COALESCE(NULLIF(CASE WHEN json_valid(f.rawJson) THEN json_extract(f.rawJson,'$."POD时间"') END,''),NULLIF(CASE WHEN json_valid(f.rawJson) THEN json_extract(f.rawJson,'$.podTime') END,''),NULLIF(CASE WHEN json_valid(f.rawJson) THEN json_extract(f.rawJson,'$."签收时间"') END,''),NULLIF(l.podDate,''),CASE WHEN COALESCE(f.isPod,0)=1 THEN f.latestEventTime ELSE '' END,'') podAt
      FROM business_final_rows f LEFT JOIN qc_tracking_ledger l ON l.shipmentCode=f.shipmentCode AND l.businessType=?
      WHERE f.reportDate IN (${marks}) AND (UPPER(TRIM(f.businessType))='SHOPEE' OR UPPER(TRIM(f.businessType))=?) AND UPPER(TRIM(COALESCE(f.recipient_group,'')))=?
    ), normalized AS (SELECT *,REPLACE(SUBSTR(dispatchAt,1,10),'/','-') dispatchDate,REPLACE(SUBSTR(podAt,1,10),'/','-') podDate FROM facts)
    SELECT reportDate,SUM(CASE WHEN isPod=1 AND attemptNo=1 THEN 1 ELSE 0 END) attempt1,SUM(CASE WHEN isPod=1 AND attemptNo=2 THEN 1 ELSE 0 END) attempt2,SUM(CASE WHEN isPod=1 AND attemptNo>=3 THEN 1 ELSE 0 END) attempt3,
      SUM(CASE WHEN isPod=1 AND dispatchDate<>'' AND podDate<>'' AND julianday(podDate)>=julianday(dispatchDate) THEN CAST(julianday(podDate)-julianday(dispatchDate)+1 AS INTEGER) ELSE 0 END) dispatchSigningDaysSum,
      SUM(CASE WHEN isPod=1 AND dispatchDate<>'' AND podDate<>'' AND julianday(podDate)>=julianday(dispatchDate) THEN 1 ELSE 0 END) dispatchSigningDaysCount
    FROM normalized GROUP BY reportDate`).all(type,...dates,type,group);
    for(const row of rows)out.set(dateKey(row.reportDate),row);
  }catch(error){console.warn('[CE-QC][V320_DISPATCH_OVERLAY_READ_FAILED]',error?.message||error);}return out;
}

export function readV320HistoricalDailyWithDispatch(businessType='ALL',fromDate='',toDate='',options={}){
  const db=options.db||getDb(),base=readV320HistoricalDaily(businessType,fromDate,toDate,{...options,db}),type=String(base.businessType||businessType||'ALL').toUpperCase();
  let daily=applyCompletedCacheOverlay(type,base.daily||[],db);
  if(TYPES.has(type)){
    const overlay=overlayRows(type,base.dates||[],db);
    daily=daily.map(row=>{const extra=overlay.get(dateKey(row.reportDate));if(!extra)return row;const pod=n(row.pod),attempt1=n(extra.attempt1),attempt2=n(extra.attempt2),attempt3=n(extra.attempt3),attemptEvidenceCount=attempt1+attempt2+attempt3,attemptUnknown=Math.max(0,pod-attemptEvidenceCount),signingCount=n(extra.dispatchSigningDaysCount),signingSum=n(extra.dispatchSigningDaysSum),avg=signingCount>0?Number((signingSum/signingCount).toFixed(2)):null;return{...row,attempt1,attempt2,attempt3,attemptEvidenceCount,attemptUnknown,attemptCoverageRate:pct(attemptEvidenceCount,pod),attemptEvidenceComplete:pod===0||attemptUnknown===0,dispatchSigningDaysCount:signingCount,dispatchSigningDaysSum:signingSum,signingDaysCount:signingCount,signingDaysSum:signingSum,signingCoverageRate:pct(signingCount,pod),signingEvidenceComplete:pod===0||signingCount>=pod,avgDispatchSigningDays:avg,avgSigningDays:avg,dispatchMetricOverlayId:V320_DISPATCH_METRIC_OVERLAY_ID};});
  }
  return{...base,id:V320_HISTORICAL_DAILY_TRUTH_ID,daily,dates:daily.map(r=>r.reportDate),currentCacheOverlayApplied:daily.some(r=>r.currentCacheOverlayApplied),dispatchMetricOverlayId:V320_DISPATCH_METRIC_OVERLAY_ID};
}

console.info('[CE-QC][V320_DISPATCH_METRIC_OVERLAY]',V320_DISPATCH_METRIC_OVERLAY_ID,'completed dashboard cache wins only when its denominator exactly matches persisted daily membership; unproven ledger admission can no longer collapse current POD truth; Shopee dispatch averages overlay saved strict START evidence.');
