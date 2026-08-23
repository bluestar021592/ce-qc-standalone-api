import express from 'express';
import { getDb } from './db.js';

export const V244_SHOPEE_TREND_ID = '2026-08-23-v244-shopee-operational-trends-v1';
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

export function readV244ShopeeTrends(businessType='SHOPEECN', fromDate='', toDate='') {
  const type = String(businessType || '').toUpperCase();
  const to = dateKey(toDate);
  const from = dateKey(fromDate) || to;
  if (!TYPES.has(type)) throw new Error('V244仅支持SHOPEECN/SHOPEEVN');
  if (!from || !to || from > to) throw new Error('日期范围无效');
  const key = `${type}|${from}|${to}`;
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const dates = selectedDates(type,from,to);
  if (!dates.length) {
    const empty = { ok:true, readId:V244_SHOPEE_TREND_ID, businessType:type, dates:[], daily:[], ticket:[], pod:[], avgPodDays:[], oc:[], definitions:{ avgPodDays:'日报/首次入库日期至实际POD日期，含首尾当天' } };
    memory.set(key,{at:Date.now(),value:empty});
    return empty;
  }

  const placeholders = dates.map(() => '?').join(',');
  const db = getDb();
  const cacheRows = db.prepare(`
    SELECT reportDate,snapshotId,
      SUM(COALESCE(CAST(json_extract(metricsJson,'$.total') AS REAL),0)) AS total,
      SUM(COALESCE(CAST(json_extract(metricsJson,'$.pod') AS REAL),0)) AS pod,
      SUM(COALESCE(CAST(json_extract(metricsJson,'$.ocCurrent') AS REAL),0)) AS ocCurrent
    FROM dashboard_daily_cache
    WHERE businessType=? AND snapshotStatus='COMPLETED' AND reportDate IN (${placeholders})
    GROUP BY reportDate,snapshotId ORDER BY reportDate ASC
  `).all(type,...dates);

  const dayRows = db.prepare(`
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

  const daysByDate = new Map(dayRows.map(row => [String(row.reportDate || ''), row]));
  const cacheByDate = new Map(cacheRows.map(row => [String(row.reportDate || ''), row]));
  const daily = dates.map(reportDate => {
    const c = cacheByDate.get(reportDate) || {};
    const d = daysByDate.get(reportDate) || {};
    const podDaysCount = n(d.podDaysCount);
    const podDaysSum = n(d.podDaysSum);
    return {
      reportDate,
      total:n(c.total),
      pod:n(c.pod),
      avgPodDays:podDaysCount ? round2(podDaysSum / podDaysCount) : null,
      oc:n(c.ocCurrent),
      podDaysCount,
      podDaysSum:round2(podDaysSum)
    };
  });
  const value = {
    ok:true,
    readId:V244_SHOPEE_TREND_ID,
    businessType:type,
    fromDate:dates[0],
    toDate:dates.at(-1),
    dates,
    daily,
    ticket:daily.map(row=>row.total),
    pod:daily.map(row=>row.pod),
    avgPodDays:daily.map(row=>row.avgPodDays),
    oc:daily.map(row=>row.oc),
    definitions:{ avgPodDays:'日报/首次入库日期至实际POD日期，含首尾当天；仅统计有效POD日期' }
  };
  memory.set(key,{at:Date.now(),value});
  return value;
}

function handler(req,res){
  try {
    const data = readV244ShopeeTrends(req.query.businessType,req.query.from,req.query.to);
    res.setHeader('Cache-Control','private,max-age=10');
    res.setHeader('X-CE-QC-Shopee-Trend',V244_SHOPEE_TREND_ID);
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ok:false,readId:V244_SHOPEE_TREND_ID,error:error?.message||String(error)});
  }
}

express.application.get = function v244ShopeeTrendRoute(pathValue,...handlers){
  const path = String(pathValue || '');
  if (!routeRegistered && path === '/api/v234/trends') {
    routeRegistered = true;
    previousGet.call(this,'/api/v244/shopee-trends',handler);
    console.info('[CE-QC][V244]',V244_SHOPEE_TREND_ID,'registered Shopee operational trend endpoint');
  }
  return previousGet.call(this,pathValue,...handlers);
};
