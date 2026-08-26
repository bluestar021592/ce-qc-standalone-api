import express from 'express';
import { getDb } from './db.js';
import { ensureV246TrackingSchema } from './v246TrackingLedgerCore.js';

export const V308_DELIVERY_DAILY_FAST_ID='2026-08-26-v308-type-scoped-delivery-daily-v1';
const TYPES=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const CACHE_MS=30_000;
const memory=new Map();
const previousGet=express.application.get;
let registered=false;
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):null;
const dateKey=value=>{const m=String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};

function finish(raw={}){
  const total=n(raw.total),proven=n(raw.proven),podKnown=n(raw.podKnown),ocKnown=n(raw.ocKnown);
  const attempt1Known=n(raw.attempt1Known),attempt2Known=n(raw.attempt2Known),attempt3Known=n(raw.attempt3Known);
  const attemptEvidenceCount=attempt1Known+attempt2Known+attempt3Known;
  const attemptUnknown=Math.max(0,podKnown-attemptEvidenceCount);
  const signingDaysCount=n(raw.signingDaysCount),signingDaysSum=n(raw.signingDaysSum);
  const ready=total===0||proven>=total;
  const attemptEvidenceComplete=ready&&(podKnown===0||attemptUnknown===0);
  const signingEvidenceComplete=ready&&(podKnown===0||signingDaysCount>=podKnown);
  const pod=ready?podKnown:null,ocCurrent=ready?ocKnown:null;
  return {
    reportDate:String(raw.reportDate||''),businessType:String(raw.businessType||''),
    total,matched:proven,proven,ready,ledgerReady:ready,statusCoverageRate:total?pct(proven,total):100,
    podKnown,pod,ocKnown,ocCurrent,oc:ocCurrent,
    podRate:ready?pct(podKnown,total):null,ocRate:ready?pct(ocKnown,total):null,
    attempt1Known,attempt2Known,attempt3Known,attemptEvidenceCount,attemptUnknown,
    attempt1:attemptEvidenceComplete?attempt1Known:null,
    attempt2:attemptEvidenceComplete?attempt2Known:null,
    attempt3:attemptEvidenceComplete?attempt3Known:null,
    attemptCoverageRate:podKnown?pct(attemptEvidenceCount,podKnown):null,
    attempt1Rate:attemptEvidenceComplete&&podKnown?pct(attempt1Known,podKnown):null,
    attempt2Rate:attemptEvidenceComplete&&podKnown?pct(attempt2Known,podKnown):null,
    attempt3Rate:attemptEvidenceComplete&&podKnown?pct(attempt3Known,podKnown):null,
    signingDaysCount,signingDaysSum,
    signingCoverageRate:podKnown?pct(Math.min(signingDaysCount,podKnown),podKnown):null,
    avgSigningDays:signingEvidenceComplete&&podKnown&&signingDaysCount?Number((signingDaysSum/signingDaysCount).toFixed(2)):null,
    avgPodDays:signingEvidenceComplete&&podKnown&&signingDaysCount?Number((signingDaysSum/signingDaysCount).toFixed(2)):null,
    attemptEvidenceComplete,signingEvidenceComplete,
    evidenceIncomplete:!ready||!attemptEvidenceComplete||!signingEvidenceComplete
  };
}

export function readV308DeliveryDaily(businessType='',fromDate='',toDate='',db=getDb()){
  const type=String(businessType||'').toUpperCase();
  const to=dateKey(toDate),from=dateKey(fromDate)||to;
  if(!TYPES.has(type))throw new Error('V308仅支持TBKH、SHOPEECN、SHOPEEVN');
  if(!from||!to||from>to)throw new Error('日期范围无效');
  const cacheKey=`${type}|${from}|${to}`;
  const hit=memory.get(cacheKey);
  if(hit&&Date.now()-hit.at<CACHE_MS)return hit.value;
  ensureV246TrackingSchema(db);

  // UI reads are deliberately type-scoped and ledger-only. The historical V263/V284
  // proof path joins all seven businesses and several large final tables on every
  // navigation. That is correct for deep reconciliation/export, but it can block the
  // single Node/SQLite web process after many daily reports have accumulated.
  // V308 reads only the requested TBKH/CN/VN membership and the already-persisted
  // V246 lifecycle ledger. It never triggers network backfill from a page read.
  const rows=db.prepare(`
    WITH ranked AS (
      SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,
             ROW_NUMBER() OVER(PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) rn
      FROM unified_import_batches b
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
    ), latest AS (
      SELECT reportDate,snapshotId FROM ranked WHERE rn=1
    ), valid AS (
      SELECT l.reportDate,UPPER(TRIM(u.shipmentCode)) shipmentCode
      FROM latest l
      JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      WHERE UPPER(TRIM(u.businessType))=? AND TRIM(COALESCE(u.shipmentCode,''))<>''
      GROUP BY l.reportDate,UPPER(TRIM(u.shipmentCode))
    ), facts AS (
      SELECT v.reportDate,v.shipmentCode,
        CASE WHEN q.shipmentCode IS NOT NULL AND (
          q.trackingStatus='TERMINAL'
          OR TRIM(COALESCE(q.lastCheckedAt,''))<>''
          OR UPPER(TRIM(COALESCE(q.currentState,''))) NOT IN ('','OPEN')
          OR UPPER(TRIM(COALESCE(q.currentCategory,''))) NOT IN ('','OPEN')
        ) THEN 1 ELSE 0 END proven,
        CASE WHEN q.terminalReason='POD' THEN 1 ELSE 0 END isPod,
        CASE WHEN q.trackingStatus='OPEN' AND (
          UPPER(TRIM(COALESCE(q.currentState,'')))='OC'
          OR UPPER(TRIM(COALESCE(q.currentCategory,'')))='OC'
          OR UPPER(TRIM(COALESCE(q.currentCategory,''))) LIKE 'OC%'
          OR COALESCE(q.currentCategory,'') LIKE '%OC滞留%'
          OR UPPER(COALESCE(json_extract(q.currentStateJson,'$."当前状态"'),''))='OC'
          OR UPPER(COALESCE(json_extract(q.currentStateJson,'$."状态标识"'),''))='OC'
        ) THEN 1 ELSE 0 END isOc,
        CASE WHEN q.terminalReason='POD' THEN COALESCE(q.attemptNo,0) ELSE 0 END attemptNo,
        CASE WHEN q.terminalReason='POD' AND COALESCE(q.signingDays,0)>0 THEN q.signingDays ELSE NULL END signingDays
      FROM valid v
      LEFT JOIN qc_tracking_ledger q ON q.shipmentCode=v.shipmentCode AND q.businessType=?
    )
    SELECT reportDate,? businessType,COUNT(*) total,SUM(proven) proven,SUM(isPod) podKnown,SUM(isOc) ocKnown,
      SUM(CASE WHEN isPod=1 AND attemptNo=1 THEN 1 ELSE 0 END) attempt1Known,
      SUM(CASE WHEN isPod=1 AND attemptNo=2 THEN 1 ELSE 0 END) attempt2Known,
      SUM(CASE WHEN isPod=1 AND attemptNo>=3 THEN 1 ELSE 0 END) attempt3Known,
      SUM(CASE WHEN signingDays IS NOT NULL THEN signingDays ELSE 0 END) signingDaysSum,
      SUM(CASE WHEN signingDays IS NOT NULL THEN 1 ELSE 0 END) signingDaysCount
    FROM facts GROUP BY reportDate ORDER BY reportDate
  `).all(from,to,type,type,type).map(finish);

  const byDate=new Map(rows.map(row=>[row.reportDate,row]));
  const dates=db.prepare(`
    SELECT DISTINCT reportDate FROM unified_import_batches
    WHERE status='VALID' AND reportDate BETWEEN ? AND ? ORDER BY reportDate
  `).all(from,to).map(row=>String(row.reportDate||'')).filter(Boolean);
  const daily=dates.map(d=>byDate.get(d)||finish({reportDate:d,businessType:type,total:0,proven:0}));
  const value={
    ok:true,id:V308_DELIVERY_DAILY_FAST_ID,businessType:type,fromDate:from,toDate:to,dates,daily,
    ticket:daily.map(r=>r.total),pod:daily.map(r=>r.pod),podRate:daily.map(r=>r.podRate),
    oc:daily.map(r=>r.ocCurrent),ocRate:daily.map(r=>r.ocRate),avgSigningDays:daily.map(r=>r.avgSigningDays),
    attempt1:daily.map(r=>r.attempt1),attempt2:daily.map(r=>r.attempt2),attempt3:daily.map(r=>r.attempt3),
    attempt1Rate:daily.map(r=>r.attempt1Rate),attempt2Rate:daily.map(r=>r.attempt2Rate),attempt3Rate:daily.map(r=>r.attempt3Rate),
    attemptCoverageRate:daily.map(r=>r.attemptCoverageRate),signingCoverageRate:daily.map(r=>r.signingCoverageRate),
    evidenceIncomplete:daily.some(r=>r.evidenceIncomplete),
    source:'TYPE_SCOPED_LATEST_VALID_MEMBERSHIP + PERSISTED_V246_LEDGER_READ_ONLY',
    definitions:{
      membership:'只读取用户选择日期范围内、所选业务的最新VALID日报成员',
      attempts:'70 START严格派次已经由V246账本锁定；派次覆盖未达到100%时1/2/3派最终值保持—，未识别POD与覆盖率继续显示用于诊断',
      signingDays:'仅使用已锁定真实signingDays；签收天数覆盖未达到100%时平均值保持—',
      readPolicy:'页面读取不触发CE接口补抓，不扫描其他业务，不执行跨七业务证明查询'
    }
  };
  memory.set(cacheKey,{at:Date.now(),value});
  return value;
}

function handler(req,res){
  try{
    const data=readV308DeliveryDaily(req.query.businessType,req.query.from,req.query.to);
    res.setHeader('Cache-Control','private,max-age=10');
    res.setHeader('X-CE-QC-V308',V308_DELIVERY_DAILY_FAST_ID);
    return res.json(data);
  }catch(error){return res.status(400).json({ok:false,id:V308_DELIVERY_DAILY_FAST_ID,error:error?.message||String(error)});}
}
function register(app){
  if(registered)return;registered=true;
  previousGet.call(app,'/api/v308/delivery-daily',handler);
  console.info('[CE-QC][V308_DELIVERY_DAILY_FAST]',V308_DELIVERY_DAILY_FAST_ID,'TBKH/CN/VN dashboard reads are type-scoped, latest-VALID, ledger-only and read-only; page navigation never triggers evidence backfill.');
}
express.application.get=function v308DeliveryDailyRoute(pathValue,...handlers){
  if(!registered&&String(pathValue||'')==='/api/v234/trends')register(this);
  return previousGet.call(this,pathValue,...handlers);
};
