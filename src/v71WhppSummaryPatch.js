import express from 'express';
import { getDb } from './db.js';

const PATCH_ID = '2026-08-12-v71-whpp-light-summary-v1';

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

function loadSummary(reportDate = '') {
  const db = getDb();
  const date = dateOnly(reportDate) || String(db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='WHPP' ORDER BY reportDate DESC LIMIT 1").get()?.reportDate || '');
  if (!date) return { reportDate: '', total: 0, metrics: {}, regionPvUnresolved: 0, activeStoreRetention: 0, selfPickup: 0, completed: false };

  const daily = db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date);
  const history = db.prepare("SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date);
  const historySummary = safeJson(history?.summaryJson, {});
  const total = Number(historySummary.total ?? daily?.totalCount ?? 0);
  const metrics = { ...historySummary };
  delete metrics.accounting;
  delete metrics.snapshotId;

  // These three values are needed by the homepage combined KPI, but the legacy
  // WHPP history summary did not persist them. Compute them with small indexed
  // day-scoped SQL aggregates instead of loading the multi-megabyte WHPP state.
  const finalTable = "business_final_rows";
  const terminalSql = `(COALESCE(isPod,0)=1 OR UPPER(COALESCE(json_extract(rawJson,'$.currentState'),'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') OR COALESCE(json_extract(rawJson,'$.退回状态'),'')='已退回')`;
  const specialSql = `UPPER(COALESCE(json_extract(rawJson,'$.specialState'),json_extract(rawJson,'$.primaryCategory'),json_extract(rawJson,'$.主分类'),'')) IN ('SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION','CCSL580_DIVERSION','CECN_RETENTION','CEZT_RETENTION')`;
  const shopSql = `COALESCE(json_extract(rawJson,'$.shopState'),json_extract(rawJson,'$.storeFlowState'),'') IN ('SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT')`;

  const regionPvUnresolved = countOne(db, `SELECT COUNT(*) count FROM ${finalTable} WHERE businessType='WHPP' AND reportDate=? AND UPPER(COALESCE(json_extract(rawJson,'$.regionCode'),json_extract(rawJson,'$.区域'),''))='PV' AND NOT ${terminalSql} AND NOT ${specialSql} AND NOT ${shopSql}`, date);
  const activeStoreRetention = countOne(db, `SELECT COUNT(*) count FROM ${finalTable} WHERE businessType='WHPP' AND reportDate=? AND NOT ${terminalSql} AND ${shopSql} AND COALESCE(CAST(json_extract(rawJson,'$.shopRetentionNaturalDays') AS INTEGER),0)>=2`, date);
  const selfPickup = countOne(db, `SELECT COUNT(*) count FROM ${finalTable} WHERE businessType='WHPP' AND reportDate=? AND NOT ${terminalSql} AND UPPER(COALESCE(json_extract(rawJson,'$.specialState'),json_extract(rawJson,'$.primaryCategory'),json_extract(rawJson,'$.主分类'),''))='SELF_PICKUP'`, date);

  if (!history) {
    // Imported but not finalized yet: preserve the accounting truth without
    // pretending that CE API processing has completed.
    metrics.total = total;
    metrics.pod = Number(metrics.pod || 0);
    metrics.returned = Number(metrics.returned || 0);
    metrics.cancelled = Number(metrics.cancelled || 0);
    metrics.unresolved = Math.max(0, total - metrics.pod - metrics.returned - metrics.cancelled);
  }

  return {
    reportDate: date,
    total,
    metrics,
    regionPvUnresolved,
    activeStoreRetention,
    selfPickup,
    completed: Boolean(history)
  };
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
