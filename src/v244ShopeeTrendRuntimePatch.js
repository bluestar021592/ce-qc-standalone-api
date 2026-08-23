import express from 'express';
import { getDb } from './db.js';
import { ensureV246TrackingSchema } from './v246TrackingLedgerCore.js';

// Compatibility marker for the prior gate: readV246ShopeeDailyTruth is superseded
// here by a stricter cohort-completeness check plus PP/PV ledger aggregation.
export const V244_SHOPEE_TREND_ID = '2026-08-23-v247-shopee-ledger-dashboard-truth-v2';
export const V245_SHOPEE_TREND_ID = V244_SHOPEE_TREND_ID;
export const V246_SHOPEE_TREND_ID = V244_SHOPEE_TREND_ID;
export const V247_SHOPEE_TREND_ID = V244_SHOPEE_TREND_ID;
const TYPES = new Set(['SHOPEECN','SHOPEEVN']);
const CACHE_MS = 15_000;
const memory = new Map();
const previousGet = express.application.get;
let routeRegistered = false;

const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const dateKey = value => {
  const text = String(value || '').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
};
const round2 = value => Number(n(value).toFixed(2));
const pct = (value,total) => total > 0 ? round2(n(value) * 100 / n(total)) : null;

function selectedDates(type, from, to, db = getDb()) {
  ensureV246TrackingSchema(db);
  if (from === to) {
    return db.prepare(`
      SELECT reportDate FROM (
        SELECT DISTINCT reportDate FROM dashboard_daily_cache
          WHERE businessType=? AND snapshotStatus='COMPLETED' AND reportDate<=?
        UNION
        SELECT DISTINCT firstReportDate AS reportDate FROM qc_tracking_ledger
          WHERE businessType=? AND firstReportDate<=?
      ) ORDER BY reportDate DESC LIMIT 7
    `).all(type,to,type,to).map(row => String(row.reportDate || '')).filter(Boolean).sort();
  }
  return db.prepare(`
    SELECT reportDate FROM (
      SELECT DISTINCT reportDate FROM dashboard_daily_cache
        WHERE businessType=? AND snapshotStatus='COMPLETED' AND reportDate BETWEEN ? AND ?
      UNION
      SELECT DISTINCT firstReportDate AS reportDate FROM qc_tracking_ledger
        WHERE businessType=? AND firstReportDate BETWEEN ? AND ?
    ) ORDER BY reportDate ASC LIMIT 180
  `).all(type,from,to,type,from,to).map(row => String(row.reportDate || '')).filter(Boolean);
}

function emptyPayload(type) {
  return {
    ok:true,
    readId:V247_SHOPEE_TREND_ID,
    businessType:type,
    dates:[],daily:[],ticket:[],pod:[],podRate:[],avgPodDays:[],oc:[],ocRate:[],
    attempt1:[],attempt2:[],attempt3:[],attempt1Rate:[],attempt2Rate:[],attempt3Rate:[],attemptUnknown:[],attemptCoverageRate:[],ledgerReady:[],
    definitions:{
      podRate:'V246锁定账本POD/首次日报成员总票；账本未完成前不把部分账本冒充完整历史真值',
      ocRate:'V246锁定账本当前真实OC/首次日报成员总票',
      avgPodDays:'每票第一次日报日期锁定后至实际POD日期，含首尾当天；后续日报不得重置起算日',
      attemptRate:'真实派次证据对应已POD票数/当日POD；无证据显示—，未识别POD单独列出',
      trackingLedger:'V246每票持续追踪账本：非POD/退回完成/取消终态不得提前结案；历史补POD后原日报日期同步更新',
      regionTruth:'PP/PV取该票在对应首次日报日最后一次VALID+COMPLETED上传中的有效区域；后续漏票不能抹掉此前区域证据'
    }
  };
}

function ledgerOverall(db,type,dates){
  if(!dates.length)return new Map();
  const marks=dates.map(()=>'?').join(',');
  const rows=db.prepare(`SELECT firstReportDate,
      COUNT(*) AS ledgerCount,
      SUM(CASE WHEN terminalReason='POD' THEN 1 ELSE 0 END) AS pod,
      SUM(CASE WHEN terminalReason='POD' AND attemptNo=1 THEN 1 ELSE 0 END) AS attempt1,
      SUM(CASE WHEN terminalReason='POD' AND attemptNo=2 THEN 1 ELSE 0 END) AS attempt2,
      SUM(CASE WHEN terminalReason='POD' AND attemptNo>=3 THEN 1 ELSE 0 END) AS attempt3,
      SUM(CASE WHEN terminalReason='POD' AND attemptNo=0 THEN 1 ELSE 0 END) AS attemptUnknown,
      SUM(CASE WHEN terminalReason='POD' AND signingDays>0 THEN signingDays ELSE 0 END) AS signingDaysSum,
      SUM(CASE WHEN terminalReason='POD' AND signingDays>0 THEN 1 ELSE 0 END) AS signingDaysCount,
      SUM(CASE WHEN trackingStatus='OPEN' AND (
        UPPER(TRIM(COALESCE(currentState,'')))='OC'
        OR UPPER(TRIM(COALESCE(currentCategory,'')))='OC'
        OR UPPER(TRIM(COALESCE(currentCategory,''))) LIKE 'OC%'
        OR COALESCE(currentCategory,'') LIKE '%OC滞留%'
        OR UPPER(COALESCE(json_extract(currentStateJson,'$."当前状态"'),''))='OC'
        OR UPPER(COALESCE(json_extract(currentStateJson,'$."状态标识"'),''))='OC'
      ) THEN 1 ELSE 0 END) AS ocCurrent
    FROM qc_tracking_ledger
    WHERE businessType=? AND firstReportDate IN (${marks})
    GROUP BY firstReportDate`).all(type,...dates);
  return new Map(rows.map(row=>[String(row.firstReportDate||''),row]));
}

function ledgerRegions(db,type,dates){
  if(!dates.length)return new Map();
  const marks=dates.map(()=>'?').join(',');
  const rows=db.prepare(`
    WITH valid_rows AS (
      SELECT u.reportDate,UPPER(TRIM(u.shipmentCode)) AS shipmentCode,
        CASE WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP' WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV' ELSE 'UNKNOWN' END AS regionCode,
        ROW_NUMBER() OVER (
          PARTITION BY u.reportDate,UPPER(TRIM(u.shipmentCode))
          ORDER BY b.createdAt DESC,b.batchId DESC,u.rowNumber DESC
        ) AS rn
      FROM unified_import_rows u
      INNER JOIN unified_import_batches b ON b.batchId=u.batchId AND b.snapshotId=u.snapshotId AND b.status='VALID'
      INNER JOIN unified_snapshots s ON s.snapshotId=u.snapshotId AND s.status='COMPLETED'
      WHERE u.businessType=? AND u.reportDate IN (${marks}) AND TRIM(COALESCE(u.shipmentCode,''))<>''
    ), source_region AS (
      SELECT reportDate,shipmentCode,regionCode FROM valid_rows WHERE rn=1
    )
    SELECT l.firstReportDate AS reportDate,COALESCE(r.regionCode,'UNKNOWN') AS regionCode,
      COUNT(*) AS total,
      SUM(CASE WHEN l.terminalReason='POD' THEN 1 ELSE 0 END) AS pod,
      SUM(CASE WHEN l.terminalReason='POD' AND l.attemptNo=1 THEN 1 ELSE 0 END) AS attempt1,
      SUM(CASE WHEN l.terminalReason='POD' AND l.attemptNo=2 THEN 1 ELSE 0 END) AS attempt2,
      SUM(CASE WHEN l.terminalReason='POD' AND l.attemptNo>=3 THEN 1 ELSE 0 END) AS attempt3,
      SUM(CASE WHEN l.terminalReason='POD' AND l.attemptNo=0 THEN 1 ELSE 0 END) AS attemptUnknown
    FROM qc_tracking_ledger l
    LEFT JOIN source_region r ON r.reportDate=l.firstReportDate AND r.shipmentCode=UPPER(TRIM(l.shipmentCode))
    WHERE l.businessType=? AND l.firstReportDate IN (${marks})
    GROUP BY l.firstReportDate,COALESCE(r.regionCode,'UNKNOWN')
    ORDER BY l.firstReportDate,regionCode
  `).all(type,...dates,type,...dates);
  const byDate=new Map();
  for(const row of rows){
    const d=String(row.reportDate||'');if(!byDate.has(d))byDate.set(d,{});
    const total=n(row.total),pod=n(row.pod),a1=n(row.attempt1),a2=n(row.attempt2),a3=n(row.attempt3),known=a1+a2+a3;
    byDate.get(d)[String(row.regionCode||'UNKNOWN').toUpperCase()]={
      total,pod,attempt1:a1,attempt2:a2,attempt3:a3,attemptUnknown:Math.max(0,pod-known),attemptCoverageRate:pod?pct(known,pod):null,
      attempt1Rate:pod&&known?pct(a1,pod):null,attempt2Rate:pod&&known?pct(a2,pod):null,attempt3Rate:pod&&known?pct(a3,pod):null
    };
  }
  return byDate;
}

export function readV244ShopeeTrends(businessType='SHOPEECN', fromDate='', toDate='') {
  const type = String(businessType || '').toUpperCase();
  const to = dateKey(toDate);
  const from = dateKey(fromDate) || to;
  if (!TYPES.has(type)) throw new Error('V247仅支持SHOPEECN/SHOPEEVN');
  if (!from || !to || from > to) throw new Error('日期范围无效');
  const key = `${type}|${from}|${to}`;
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const db=getDb();ensureV246TrackingSchema(db);
  const dates = selectedDates(type,from,to,db);
  if (!dates.length) {
    const empty = emptyPayload(type);
    memory.set(key,{at:Date.now(),value:empty});
    return empty;
  }

  const placeholders = dates.map(() => '?').join(',');
  const cacheRows = db.prepare(`
    SELECT reportDate,
      SUM(COALESCE(CAST(json_extract(metricsJson,'$.total') AS REAL),0)) AS total,
      SUM(COALESCE(CAST(json_extract(metricsJson,'$.pod') AS REAL),0)) AS pod,
      SUM(COALESCE(CAST(json_extract(metricsJson,'$.ocCurrent') AS REAL),0)) AS ocCurrent
    FROM dashboard_daily_cache
    WHERE businessType=? AND snapshotStatus='COMPLETED' AND reportDate IN (${placeholders})
    GROUP BY reportDate ORDER BY reportDate ASC
  `).all(type,...dates);
  const cacheByDate=new Map(cacheRows.map(row=>[String(row.reportDate||''),row]));
  const lockedByDate=ledgerOverall(db,type,dates);
  const regionByDate=ledgerRegions(db,type,dates);

  const daily=dates.map(reportDate=>{
    const c=cacheByDate.get(reportDate)||{};
    const l=lockedByDate.get(reportDate)||{};
    const cacheTotal=n(c.total),ledgerCount=n(l.ledgerCount);
    const ledgerReady=ledgerCount>0&&(cacheTotal===0||ledgerCount>=cacheTotal);
    const total=ledgerReady?ledgerCount:cacheTotal;
    const pod=ledgerReady?n(l.pod):n(c.pod);
    const oc=ledgerReady?n(l.ocCurrent):n(c.ocCurrent);
    const attempt1=ledgerReady?n(l.attempt1):0;
    const attempt2=ledgerReady?n(l.attempt2):0;
    const attempt3=ledgerReady?n(l.attempt3):0;
    const attemptEvidenceCount=Math.min(pod,attempt1+attempt2+attempt3);
    const attemptUnknown=Math.max(0,pod-attemptEvidenceCount);
    const hasAttemptEvidence=pod>0&&attemptEvidenceCount>0;
    const signingDaysCount=ledgerReady?n(l.signingDaysCount):0;
    const signingDaysSum=ledgerReady?n(l.signingDaysSum):0;
    return{
      reportDate,total,pod,podRate:pct(pod,total),avgPodDays:signingDaysCount?round2(signingDaysSum/signingDaysCount):null,
      oc,ocRate:pct(oc,total),podDaysCount:signingDaysCount,podDaysSum:round2(signingDaysSum),
      attempt1,attempt2,attempt3,attemptEvidenceCount,attemptUnknown,
      attemptCoverageRate:pod>0?pct(attemptEvidenceCount,pod):null,
      attempt1Rate:hasAttemptEvidence ? pct(attempt1,pod) : null,
      attempt2Rate:hasAttemptEvidence ? pct(attempt2,pod) : null,
      attempt3Rate:hasAttemptEvidence ? pct(attempt3,pod) : null,
      attemptEvidenceComplete:pod>0&&attemptUnknown===0,
      ledgerReady,ledgerCount,cacheTotal,recoveredExtra:Math.max(0,ledgerCount-cacheTotal),
      regions:regionByDate.get(reportDate)||{},
      evidenceSource:ledgerReady?'V246_LOCKED_TRACKING_LEDGER':'V246_LEDGER_PREPARING_NO_PARTIAL_TRUTH'
    };
  });
  const value={
    ...emptyPayload(type),fromDate:dates[0],toDate:dates.at(-1),dates,daily,
    ticket:daily.map(row=>row.total),pod:daily.map(row=>row.pod),podRate:daily.map(row=>row.podRate),avgPodDays:daily.map(row=>row.avgPodDays),
    oc:daily.map(row=>row.oc),ocRate:daily.map(row=>row.ocRate),attempt1:daily.map(row=>row.attempt1),attempt2:daily.map(row=>row.attempt2),attempt3:daily.map(row=>row.attempt3),
    attempt1Rate:daily.map(row=>row.attempt1Rate),attempt2Rate:daily.map(row=>row.attempt2Rate),attempt3Rate:daily.map(row=>row.attempt3Rate),attemptUnknown:daily.map(row=>row.attemptUnknown),
    attemptCoverageRate:daily.map(row=>row.attemptCoverageRate),ledgerReady:daily.map(row=>row.ledgerReady)
  };
  memory.set(key,{at:Date.now(),value});
  return value;
}

export const readV245ShopeeTrends = readV244ShopeeTrends;
export const readV246ShopeeTrends = readV244ShopeeTrends;
export const readV247ShopeeTrends = readV244ShopeeTrends;

function handler(req,res){
  try {
    const data = readV247ShopeeTrends(req.query.businessType,req.query.from,req.query.to);
    res.setHeader('Cache-Control','private,max-age=10');
    res.setHeader('X-CE-QC-Shopee-Trend',V247_SHOPEE_TREND_ID);
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ok:false,readId:V247_SHOPEE_TREND_ID,error:error?.message||String(error)});
  }
}

express.application.get = function v247ShopeeTrendRoute(pathValue,...handlers){
  const path = String(pathValue || '');
  if (!routeRegistered && path === '/api/v234/trends') {
    routeRegistered = true;
    previousGet.call(this,'/api/v247/shopee-trends',handler);
    previousGet.call(this,'/api/v246/shopee-trends',handler);
    previousGet.call(this,'/api/v245/shopee-trends',handler);
    previousGet.call(this,'/api/v244/shopee-trends',handler);
    console.info('[CE-QC][V247]',V247_SHOPEE_TREND_ID,'registered Shopee locked-ledger dashboard truth endpoints');
  }
  return previousGet.call(this,pathValue,...handlers);
};