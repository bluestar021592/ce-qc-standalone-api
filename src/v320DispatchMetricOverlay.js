import { getDb } from './db.js';
import { readV320HistoricalDaily, V320_HISTORICAL_DAILY_TRUTH_ID } from './v320HistoricalDailyTruth.js';

export const V320_DISPATCH_METRIC_OVERLAY_ID='2026-08-26-v320-ledger-dispatch-overlay-v2';
const TYPES=new Set(['SHOPEECN','SHOPEEVN']);
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(a,b)=>b?Number((n(a)*100/n(b)).toFixed(2)):null;
const dateKey=v=>{const m=String(v||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};

function overlayRows(type,dates,db){
  const out=new Map();
  if(!dates.length)return out;
  const group=type==='SHOPEECN'?'CN':'VN';
  const marks=dates.map(()=>'?').join(',');
  try{
    const rows=db.prepare(`WITH facts AS (
      SELECT f.reportDate,f.shipmentCode,COALESCE(f.isPod,0) isPod,
        COALESCE(NULLIF(f.podAttemptNo,0),NULLIF(CAST(json_extract(f.rawJson,'$.podAttemptNo') AS INTEGER),0),NULLIF(json_array_length(f.attemptHistoryJson),0),NULLIF(l.attemptNo,0),0) attemptNo,
        COALESCE(NULLIF(f.firstAttemptAt,''),NULLIF(json_extract(f.rawJson,'$.firstAttemptAt'),''),NULLIF(json_extract(f.rawJson,'$."首次派件时间"'),''),NULLIF(json_extract(f.rawJson,'$."首次派送时间"'),''),NULLIF(json_extract(f.attemptHistoryJson,'$[0]'),''),NULLIF(json_extract(l.evidenceJson,'$.starts[0].time'),''),NULLIF(json_extract(l.currentStateJson,'$.firstAttemptAt'),''),'') dispatchAt,
        COALESCE(NULLIF(json_extract(f.rawJson,'$."POD时间"'),''),NULLIF(json_extract(f.rawJson,'$.podTime'),''),NULLIF(json_extract(f.rawJson,'$."签收时间"'),''),NULLIF(l.podDate,''),CASE WHEN COALESCE(f.isPod,0)=1 THEN f.latestEventTime ELSE '' END,'') podAt
      FROM business_final_rows f
      LEFT JOIN qc_tracking_ledger l ON l.shipmentCode=f.shipmentCode AND l.businessType=?
      WHERE f.reportDate IN (${marks})
        AND (UPPER(TRIM(f.businessType))='SHOPEE' OR UPPER(TRIM(f.businessType))=?)
        AND UPPER(TRIM(COALESCE(f.recipient_group,'')))=?
    ), normalized AS (
      SELECT *,REPLACE(SUBSTR(dispatchAt,1,10),'/','-') dispatchDate,REPLACE(SUBSTR(podAt,1,10),'/','-') podDate FROM facts
    )
    SELECT reportDate,
      SUM(CASE WHEN isPod=1 AND attemptNo=1 THEN 1 ELSE 0 END) attempt1,
      SUM(CASE WHEN isPod=1 AND attemptNo=2 THEN 1 ELSE 0 END) attempt2,
      SUM(CASE WHEN isPod=1 AND attemptNo>=3 THEN 1 ELSE 0 END) attempt3,
      SUM(CASE WHEN isPod=1 AND dispatchDate<>'' AND podDate<>'' AND julianday(podDate)>=julianday(dispatchDate) THEN CAST(julianday(podDate)-julianday(dispatchDate)+1 AS INTEGER) ELSE 0 END) dispatchSigningDaysSum,
      SUM(CASE WHEN isPod=1 AND dispatchDate<>'' AND podDate<>'' AND julianday(podDate)>=julianday(dispatchDate) THEN 1 ELSE 0 END) dispatchSigningDaysCount
    FROM normalized GROUP BY reportDate`).all(type,...dates,type,group);
    for(const row of rows)out.set(dateKey(row.reportDate),row);
  }catch(error){
    console.warn('[CE-QC][V320_DISPATCH_OVERLAY_READ_FAILED]',error?.message||error);
  }
  return out;
}

export function readV320HistoricalDailyWithDispatch(businessType='ALL',fromDate='',toDate='',options={}){
  const db=options.db||getDb();
  const base=readV320HistoricalDaily(businessType,fromDate,toDate,{...options,db});
  const type=String(base.businessType||businessType||'ALL').toUpperCase();
  if(!TYPES.has(type))return {...base,dispatchMetricOverlayId:V320_DISPATCH_METRIC_OVERLAY_ID};
  const overlay=overlayRows(type,base.dates||[],db);
  const daily=(base.daily||[]).map(row=>{
    const extra=overlay.get(dateKey(row.reportDate));
    if(!extra)return row;
    const pod=n(row.pod),attempt1=n(extra.attempt1),attempt2=n(extra.attempt2),attempt3=n(extra.attempt3);
    const attemptEvidenceCount=attempt1+attempt2+attempt3;
    const attemptUnknown=Math.max(0,pod-attemptEvidenceCount);
    const signingCount=n(extra.dispatchSigningDaysCount),signingSum=n(extra.dispatchSigningDaysSum);
    const avg=signingCount>0?Number((signingSum/signingCount).toFixed(2)):null;
    return {...row,attempt1,attempt2,attempt3,attemptEvidenceCount,attemptUnknown,attemptCoverageRate:pct(attemptEvidenceCount,pod),attemptEvidenceComplete:pod===0||attemptUnknown===0,
      dispatchSigningDaysCount:signingCount,dispatchSigningDaysSum:signingSum,signingDaysCount:signingCount,signingDaysSum:signingSum,signingCoverageRate:pct(signingCount,pod),signingEvidenceComplete:pod===0||signingCount>=pod,
      avgDispatchSigningDays:avg,avgSigningDays:avg,dispatchMetricOverlayId:V320_DISPATCH_METRIC_OVERLAY_ID};
  });
  return {...base,id:V320_HISTORICAL_DAILY_TRUTH_ID,daily,dates:daily.map(r=>r.reportDate),dispatchMetricOverlayId:V320_DISPATCH_METRIC_OVERLAY_ID};
}

console.info('[CE-QC][V320_DISPATCH_METRIC_OVERLAY]',V320_DISPATCH_METRIC_OVERLAY_ID,'historical Shopee daily metrics reuse persisted attemptHistory + strict ledger starts/attempts before any background network repair; valid dispatch→POD samples publish immediately.');
