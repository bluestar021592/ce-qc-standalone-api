import express from 'express';
import { getDb } from './db.js';

const PATCH_ID = '2026-08-12-v71-whpp-light-summary-v2';

function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}

function dateOnly(value = '') {
  const text = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function countOne(db, sql, ...params) {
  try { return Number(db.prepare(sql).get(...params)?.count || 0); }
  catch { return 0; }
}

function emptyRegion(code) {
  return { regionCode: code, total: 0, pod: 0, podRate: 0, returned: 0, cancelled: 0, unresolved: 0, pending1: 0, pending2: 0, pending3: 0, oc1: 0, oc2: 0, oc3: 0, shop: 0, phnomPenhShop: 0, provinceShop: 0 };
}

function loadRegions(db, date) {
  const terminal = `(COALESCE(isPod,0)=1 OR UPPER(COALESCE(json_extract(rawJson,'$.currentState'),'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') OR COALESCE(json_extract(rawJson,'$.退回状态'),'')='已退回')`;
  const returned = `(COALESCE(json_extract(rawJson,'$.退回状态'),'')='已退回' OR UPPER(COALESCE(json_extract(rawJson,'$.currentState'),'')) IN ('RETURNED','RETURN_COMPLETED') OR COALESCE(primaryCategory,'')='退回')`;
  const cancelled = `(UPPER(COALESCE(json_extract(rawJson,'$.currentState'),''))='ORDER_CANCELLED' OR COALESCE(json_extract(rawJson,'$.订单取消'),'')='是')`;
  const special = `UPPER(COALESCE(json_extract(rawJson,'$.specialState'),json_extract(rawJson,'$.primaryCategory'),json_extract(rawJson,'$.主分类'),'')) IN ('SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION','CCSL580_DIVERSION','CECN_RETENTION','CEZT_RETENTION')`;
  const shop = `COALESCE(json_extract(rawJson,'$.shopState'),json_extract(rawJson,'$.storeFlowState'),'') IN ('SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT')`;
  const actionable = `(NOT ${terminal} AND NOT ${special} AND NOT ${shop})`;
  const regionExpr = `CASE UPPER(COALESCE(json_extract(rawJson,'$.regionCode'),json_extract(rawJson,'$.区域'),'')) WHEN 'PP' THEN 'PP' WHEN 'PV' THEN 'PV' ELSE 'UNKNOWN' END`;
  const rows = db.prepare(`
    SELECT ${regionExpr} regionCode,
      COUNT(*) total,
      SUM(CASE WHEN COALESCE(isPod,0)=1 THEN 1 ELSE 0 END) pod,
      SUM(CASE WHEN ${returned} AND COALESCE(isPod,0)=0 THEN 1 ELSE 0 END) returned,
      SUM(CASE WHEN ${cancelled} AND COALESCE(isPod,0)=0 AND NOT ${returned} THEN 1 ELSE 0 END) cancelled,
      SUM(CASE WHEN ${actionable} THEN 1 ELSE 0 END) unresolved,
      SUM(CASE WHEN ${actionable} AND COALESCE(CAST(json_extract(rawJson,'$.Pending当前次数') AS INTEGER),CAST(json_extract(rawJson,'$.Pending次数') AS INTEGER),CAST(json_extract(rawJson,'$.pendingDistinctDayCount') AS INTEGER),0)>=1 THEN 1 ELSE 0 END) pending1,
      SUM(CASE WHEN ${actionable} AND COALESCE(CAST(json_extract(rawJson,'$.Pending当前次数') AS INTEGER),CAST(json_extract(rawJson,'$.Pending次数') AS INTEGER),CAST(json_extract(rawJson,'$.pendingDistinctDayCount') AS INTEGER),0)>=2 THEN 1 ELSE 0 END) pending2,
      SUM(CASE WHEN ${actionable} AND COALESCE(CAST(json_extract(rawJson,'$.Pending当前次数') AS INTEGER),CAST(json_extract(rawJson,'$.Pending次数') AS INTEGER),CAST(json_extract(rawJson,'$.pendingDistinctDayCount') AS INTEGER),0)>=3 THEN 1 ELSE 0 END) pending3,
      SUM(CASE WHEN ${actionable} AND COALESCE(CAST(json_extract(rawJson,'$.OC天数') AS INTEGER),0)>=1 THEN 1 ELSE 0 END) oc1,
      SUM(CASE WHEN ${actionable} AND COALESCE(CAST(json_extract(rawJson,'$.OC天数') AS INTEGER),0)>=2 THEN 1 ELSE 0 END) oc2,
      SUM(CASE WHEN ${actionable} AND COALESCE(CAST(json_extract(rawJson,'$.OC天数') AS INTEGER),0)>=3 THEN 1 ELSE 0 END) oc3,
      SUM(CASE WHEN NOT ${terminal} AND ${shop} THEN 1 ELSE 0 END) shop
    FROM business_final_rows
    WHERE businessType='WHPP' AND reportDate=?
    GROUP BY ${regionExpr}
  `).all(date);
  const out = { PP: emptyRegion('PP'), PV: emptyRegion('PV'), UNKNOWN: emptyRegion('UNKNOWN') };
  for (const row of rows) {
    const code = ['PP','PV'].includes(String(row.regionCode)) ? String(row.regionCode) : 'UNKNOWN';
    const total = Number(row.total || 0);
    const normalized = {
      regionCode: code,
      total,
      pod: Number(row.pod || 0),
      podRate: total ? Number(row.pod || 0) * 100 / total : 0,
      returned: Number(row.returned || 0),
      cancelled: Number(row.cancelled || 0),
      unresolved: Number(row.unresolved || 0),
      pending1: Number(row.pending1 || 0),
      pending2: Number(row.pending2 || 0),
      pending3: Number(row.pending3 || 0),
      oc1: Number(row.oc1 || 0),
      oc2: Number(row.oc2 || 0),
      oc3: Number(row.oc3 || 0),
      shop: Number(row.shop || 0),
      phnomPenhShop: code === 'PP' ? Number(row.shop || 0) : 0,
      provinceShop: code === 'PV' ? Number(row.shop || 0) : 0
    };
    out[code] = normalized;
  }
  return out;
}

function loadSummary(reportDate = '') {
  const db = getDb();
  const date = dateOnly(reportDate) || String(db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='WHPP' ORDER BY reportDate DESC LIMIT 1").get()?.reportDate || '');
  if (!date) {
    const metrics = { total: 0, pod: 0, podRate: 0, returned: 0, returnRate: 0, cancelled: 0, cancelRate: 0, unresolved: 0 };
    return { reportDate: '', total: 0, metrics, regions: { PP: emptyRegion('PP'), PV: emptyRegion('PV'), UNKNOWN: emptyRegion('UNKNOWN') }, regionPvUnresolved: 0, activeStoreRetention: 0, selfPickup: 0, completed: false, state: { reportDate: '', dailyReportReady: false }, dashboard: { metrics, regions: { PP: emptyRegion('PP'), PV: emptyRegion('PV'), UNKNOWN: emptyRegion('UNKNOWN') } } };
  }

  const daily = db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date);
  const history = db.prepare("SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date);
  const historySummary = safeJson(history?.summaryJson, {});
  const total = Number(historySummary.total ?? daily?.totalCount ?? 0);
  const metrics = { ...historySummary, total };
  delete metrics.accounting;
  delete metrics.snapshotId;

  const finalTable = 'business_final_rows';
  const terminalSql = `(COALESCE(isPod,0)=1 OR UPPER(COALESCE(json_extract(rawJson,'$.currentState'),'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') OR COALESCE(json_extract(rawJson,'$.退回状态'),'')='已退回')`;
  const specialSql = `UPPER(COALESCE(json_extract(rawJson,'$.specialState'),json_extract(rawJson,'$.primaryCategory'),json_extract(rawJson,'$.主分类'),'')) IN ('SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION','CCSL580_DIVERSION','CECN_RETENTION','CEZT_RETENTION')`;
  const shopSql = `COALESCE(json_extract(rawJson,'$.shopState'),json_extract(rawJson,'$.storeFlowState'),'') IN ('SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT')`;
  const regionPvUnresolved = countOne(db, `SELECT COUNT(*) count FROM ${finalTable} WHERE businessType='WHPP' AND reportDate=? AND UPPER(COALESCE(json_extract(rawJson,'$.regionCode'),json_extract(rawJson,'$.区域'),''))='PV' AND NOT ${terminalSql} AND NOT ${specialSql} AND NOT ${shopSql}`, date);
  const activeStoreRetention = countOne(db, `SELECT COUNT(*) count FROM ${finalTable} WHERE businessType='WHPP' AND reportDate=? AND NOT ${terminalSql} AND ${shopSql} AND COALESCE(CAST(json_extract(rawJson,'$.shopRetentionNaturalDays') AS INTEGER),0)>=2`, date);
  const selfPickup = countOne(db, `SELECT COUNT(*) count FROM ${finalTable} WHERE businessType='WHPP' AND reportDate=? AND NOT ${terminalSql} AND UPPER(COALESCE(json_extract(rawJson,'$.specialState'),json_extract(rawJson,'$.primaryCategory'),json_extract(rawJson,'$.主分类'),''))='SELF_PICKUP'`, date);
  const regions = loadRegions(db, date);

  if (!history) {
    metrics.pod = Number(metrics.pod || 0);
    metrics.podRate = total ? metrics.pod * 100 / total : 0;
    metrics.returned = Number(metrics.returned || 0);
    metrics.returnRate = total ? metrics.returned * 100 / total : 0;
    metrics.cancelled = Number(metrics.cancelled || 0);
    metrics.cancelRate = total ? metrics.cancelled * 100 / total : 0;
    metrics.unresolved = Math.max(0, total - metrics.pod - metrics.returned - metrics.cancelled);
  }

  const state = { reportDate: date, dailyReportReady: Boolean(daily), snapshotStatus: history ? 'COMPLETED' : 'PENDING' };
  const dashboard = { businessType: 'WHPP', reportDate: date, metrics, regions };
  return { reportDate: date, total, metrics, regions, regionPvUnresolved, activeStoreRetention, selfPickup, completed: Boolean(history), state, dashboard };
}

let installed = false;
const previousListen = express.application.listen;
express.application.listen = function v71WhppSummaryListen(...args) {
  if (!installed) {
    installed = true;
    this.get('/api/v71/whpp-summary', (req, res) => {
      try {
        res.setHeader('Cache-Control', 'private, max-age=5');
        res.json({ ok: true, patchId: PATCH_ID, ...loadSummary(req.query.reportDate) });
      } catch (error) {
        console.error('[V71][WHPP_SUMMARY]', error);
        res.status(500).json({ ok: false, patchId: PATCH_ID, error: error.message || String(error) });
      }
    });
  }
  return previousListen.apply(this, args);
};

export const V71_WHPP_SUMMARY_PATCH_ID = PATCH_ID;
