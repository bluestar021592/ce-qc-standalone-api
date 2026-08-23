import express from 'express';
import { getDb } from './db.js';
import { readV246ShopeeDailyTruth } from './v246TrackingLedgerCore.js';

export const V244_SHOPEE_TREND_ID = '2026-08-23-v246-shopee-locked-tracking-truth-v1';
export const V245_SHOPEE_TREND_ID = V244_SHOPEE_TREND_ID;
export const V246_SHOPEE_TREND_ID = V244_SHOPEE_TREND_ID;
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

function selectedDates(type, from, to) {
  const db = getDb();
  if (from === to) {
    return db.prepare(`SELECT DISTINCT reportDate FROM dashboard_daily_cache
      WHERE businessType=? AND snapshotStatus='COMPLETED' AND reportDate<=?
      ORDER BY reportDate DESC LIMIT 7`).all(type,to)
      .map(row => String(row.reportDate || '')).filter(Boolean).sort();
  }
  return db.prepare(`SELECT DISTINCT reportDate FROM dashboard_daily_cache
    WHERE businessType=? AND snapshotStatus='COMPLETED' AND reportDate BETWEEN ? AND ?
    ORDER BY reportDate ASC LIMIT 180`).all(type,from,to)
    .map(row => String(row.reportDate || '')).filter(Boolean);
}

function emptyPayload(type) {
  return {
    ok:true,
    readId:V246_SHOPEE_TREND_ID,
    businessType:type,
    dates:[],daily:[],ticket:[],pod:[],podRate:[],avgPodDays:[],oc:[],ocRate:[],
    attempt1:[],attempt2:[],attempt3:[],attempt1Rate:[],attempt2Rate:[],attempt3Rate:[],attemptUnknown:[],attemptCoverageRate:[],
    definitions:{
      podRate:'POD/当日总票',
      ocRate:'当日当前OC/当日总票',
      avgPodDays:'每票首次日报日期锁定后至实际POD日期，含首尾当天；后续日报不得重置起算日',
      attemptRate:'真实派次证据对应已POD票数/当日POD；无证据显示—，未识别POD单独列出',
      trackingLedger:'V246每票持续追踪账本：非POD/退回/取消终态不得提前结案'
    }
  };
}

export function readV244ShopeeTrends(businessType='SHOPEECN', fromDate='', toDate='') {
  const type = String(businessType || '').toUpperCase();
  const to = dateKey(toDate);
  const from = dateKey(fromDate) || to;
  if (!TYPES.has(type)) throw new Error('V246仅支持SHOPEECN/SHOPEEVN');
  if (!from || !to || from > to) throw new Error('日期范围无效');
  const key = `${type}|${from}|${to}`;
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const dates = selectedDates(type,from,to);
  if (!dates.length) {
    const empty = emptyPayload(type);
    memory.set(key,{at:Date.now(),value:empty});
    return empty;
  }

  const placeholders = dates.map(() => '?').join(',');
  const db = getDb();
  const cacheRows = db.prepare(`
    SELECT reportDate,snapshotId,
      SUM(COALESCE(CAST(json_extract(metricsJson,'$.total') AS REAL),0)) AS total,
      SUM(COALESCE(CAST(json_extract(metricsJson,'$.pod') AS REAL),0)) AS pod,
      SUM(COALESCE(CAST(json_extract(metricsJson,'$.ocCurrent') AS REAL),0)) AS ocCurrent,
      SUM(COALESCE(CAST(json_extract(metricsJson,'$.attempt1') AS REAL),0)) AS attempt1,
      SUM(COALESCE(CAST(json_extract(metricsJson,'$.attempt2') AS REAL),0)) AS attempt2,
      SUM(COALESCE(CAST(json_extract(metricsJson,'$.attempt3') AS REAL),0)) AS attempt3
    FROM dashboard_daily_cache
    WHERE businessType=? AND snapshotStatus='COMPLETED' AND reportDate IN (${placeholders})
    GROUP BY reportDate,snapshotId ORDER BY reportDate ASC
  `).all(type,...dates);

  // Legacy fallback is retained only for a first boot before the V246 ledger has
  // reconciled. Once a ledger row exists for a date, the locked firstReportDate
  // is authoritative and this per-day fallback is no longer used.
  const legacyDayRows = db.prepare(`
    WITH exact_members AS (
      SELECT c.reportDate,c.snapshotId,u.shipmentCode,
        COALESCE(f.isPod,0) AS isPod,
        REPLACE(SUBSTR(COALESCE(
          NULLIF(json_extract(f.rawJson,'$."POD时间"'),''),
          NULLIF(json_extract(f.rawJson,'$.podTime'),''),
          NULLIF(json_extract(f.rawJson,'$."签收时间"'),''),
          NULLIF(f.latestEventTime,''),''
        ),1,10),'/','-') AS podDate
      FROM (SELECT DISTINCT reportDate,snapshotId FROM dashboard_daily_cache
            WHERE businessType=? AND snapshotStatus='COMPLETED' AND reportDate IN (${placeholders})) c
      JOIN unified_import_rows u ON u.snapshotId=c.snapshotId AND u.reportDate=c.reportDate AND u.businessType=?
      LEFT JOIN business_final_rows f ON f.businessType='SHOPEE' AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
    )
    SELECT reportDate,
      SUM(CASE WHEN isPod=1 AND podDate GLOB '????-??-??' AND podDate>=reportDate
        THEN julianday(podDate)-julianday(reportDate)+1 ELSE 0 END) AS podDaysSum,
      SUM(CASE WHEN isPod=1 AND podDate GLOB '????-??-??' AND podDate>=reportDate THEN 1 ELSE 0 END) AS podDaysCount
    FROM exact_members GROUP BY reportDate ORDER BY reportDate ASC
  `).all(type,...dates,type);

  const ledgerByDate = readV246ShopeeDailyTruth(type,dates,db);
  const legacyDaysByDate = new Map(legacyDayRows.map(row => [String(row.reportDate || ''), row]));
  const cacheByDate = new Map(cacheRows.map(row => [String(row.reportDate || ''), row]));
  const daily = dates.map(reportDate => {
    const c = cacheByDate.get(reportDate) || {};
    const locked = ledgerByDate.get(reportDate) || null;
    const legacy = legacyDaysByDate.get(reportDate) || {};
    const total = n(c.total);
    const pod = n(c.pod);
    const oc = n(c.ocCurrent);
    const attempt1 = locked ? Math.max(0,n(locked.attempt1)) : Math.max(0,n(c.attempt1));
    const attempt2 = locked ? Math.max(0,n(locked.attempt2)) : Math.max(0,n(c.attempt2));
    const attempt3 = locked ? Math.max(0,n(locked.attempt3)) : Math.max(0,n(c.attempt3));
    const attemptEvidenceCount = Math.min(pod,attempt1 + attempt2 + attempt3);
    const attemptUnknown = Math.max(0,pod - attemptEvidenceCount);
    const hasAttemptEvidence = pod > 0 && attemptEvidenceCount > 0;
    const podDaysCount = locked ? n(locked.signingDaysCount) : n(legacy.podDaysCount);
    const podDaysSum = locked ? n(locked.signingDaysSum) : n(legacy.podDaysSum);
    return {
      reportDate,
      total,
      pod,
      podRate:pct(pod,total),
      avgPodDays:podDaysCount ? round2(podDaysSum / podDaysCount) : null,
      oc,
      ocRate:pct(oc,total),
      podDaysCount,
      podDaysSum:round2(podDaysSum),
      attempt1,
      attempt2,
      attempt3,
      attemptEvidenceCount,
      attemptUnknown,
      attemptCoverageRate:pod > 0 ? pct(attemptEvidenceCount,pod) : null,
      attempt1Rate:hasAttemptEvidence ? pct(attempt1,pod) : null,
      attempt2Rate:hasAttemptEvidence ? pct(attempt2,pod) : null,
      attempt3Rate:hasAttemptEvidence ? pct(attempt3,pod) : null,
      attemptEvidenceComplete:pod > 0 && attemptUnknown === 0,
      evidenceSource:locked ? 'V246_LOCKED_TRACKING_LEDGER' : 'LEGACY_FIRST_BOOT_FALLBACK'
    };
  });
  const value = {
    ...emptyPayload(type),
    fromDate:dates[0],
    toDate:dates.at(-1),
    dates,
    daily,
    ticket:daily.map(row=>row.total),
    pod:daily.map(row=>row.pod),
    podRate:daily.map(row=>row.podRate),
    avgPodDays:daily.map(row=>row.avgPodDays),
    oc:daily.map(row=>row.oc),
    ocRate:daily.map(row=>row.ocRate),
    attempt1:daily.map(row=>row.attempt1),
    attempt2:daily.map(row=>row.attempt2),
    attempt3:daily.map(row=>row.attempt3),
    attempt1Rate:daily.map(row=>row.attempt1Rate),
    attempt2Rate:daily.map(row=>row.attempt2Rate),
    attempt3Rate:daily.map(row=>row.attempt3Rate),
    attemptUnknown:daily.map(row=>row.attemptUnknown),
    attemptCoverageRate:daily.map(row=>row.attemptCoverageRate)
  };
  memory.set(key,{at:Date.now(),value});
  return value;
}

export const readV245ShopeeTrends = readV244ShopeeTrends;
export const readV246ShopeeTrends = readV244ShopeeTrends;

function handler(req,res){
  try {
    const data = readV246ShopeeTrends(req.query.businessType,req.query.from,req.query.to);
    res.setHeader('Cache-Control','private,max-age=10');
    res.setHeader('X-CE-QC-Shopee-Trend',V246_SHOPEE_TREND_ID);
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ok:false,readId:V246_SHOPEE_TREND_ID,error:error?.message||String(error)});
  }
}

express.application.get = function v246ShopeeTrendRoute(pathValue,...handlers){
  const path = String(pathValue || '');
  if (!routeRegistered && path === '/api/v234/trends') {
    routeRegistered = true;
    previousGet.call(this,'/api/v246/shopee-trends',handler);
    previousGet.call(this,'/api/v245/shopee-trends',handler);
    previousGet.call(this,'/api/v244/shopee-trends',handler);
    console.info('[CE-QC][V246]',V246_SHOPEE_TREND_ID,'registered Shopee locked tracking truth endpoints');
  }
  return previousGet.call(this,pathValue,...handlers);
};
