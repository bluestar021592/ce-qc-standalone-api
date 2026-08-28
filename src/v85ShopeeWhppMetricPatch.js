import './v351WhppUnifiedDashboardBridgePatch.js';
import './v352WhppVisibleTruthOwnerPatch.js';
import express from 'express';
import { getDb } from './db.js';

const PATCH_ID = '2026-08-13-v85-shopee-whpp-sql-metric-v2';
const ROUTE = '/api/v85/shopee-whpp-retention';
const TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const originalListen = express.application.listen;
let installed = false;

function normalizeDate(value) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function whereSql(includePagination = false) {
  return `
    FROM business_final_rows f
    INNER JOIN unified_import_batches b
      ON b.reportDate=f.reportDate AND b.status='VALID'
    INNER JOIN unified_snapshots s
      ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
    INNER JOIN unified_import_rows u
      ON u.snapshotId=b.snapshotId AND u.shipmentCode=f.shipmentCode AND u.businessType=?
    WHERE f.businessType='SHOPEE'
      AND f.reportDate BETWEEN ? AND ?
      AND COALESCE(f.isPod,0)=0
      AND UPPER(COALESCE(f.primaryCategory,'')) NOT IN ('POD','POD闭环','退回','RETURN','RETURNED','RETURN_COMPLETED')
      AND COALESCE(f.rawJson,'') NOT LIKE '%"退回状态":"已退回"%'
      AND COALESCE(f.rawJson,'') NOT LIKE '%"currentState":"RETURN_COMPLETED"%'
      AND COALESCE(f.rawJson,'') NOT LIKE '%"currentState":"RETURNED"%'
      AND COALESCE(f.rawJson,'') NOT LIKE '%"orderStatus":"100"%'
      AND COALESCE(f.rawJson,'') NOT LIKE '%"orderStatus":100%'
      AND (
        UPPER(REPLACE(REPLACE(REPLACE(COALESCE(f.latestNode,''),' ',''),'CEL:',''),'CE:',''))='WHPP'
        OR UPPER(COALESCE(f.latestEventDesc,'')) LIKE '%CE:WHPP%'
        OR UPPER(COALESCE(f.latestEventDesc,'')) LIKE '%CEL:WHPP%'
        OR COALESCE(f.primaryCategory,'')='WHPP滞留包裹'
        OR COALESCE(f.rawJson,'') LIKE '%"SHOPEE_WHPP_RETENTION"%'
      )
    ${includePagination ? 'ORDER BY f.reportDate DESC,f.latestEventTime DESC,f.shipmentCode LIMIT ? OFFSET ?' : ''}
  `;
}

function handler(req, res) {
  try {
    const type = String(req.query.businessType || '').trim().toUpperCase();
    if (!TYPES.has(type)) return res.status(400).json({ ok: false, error: 'businessType仅支持SHOPEECN或SHOPEEVN。' });
    const from = normalizeDate(req.query.from || req.query.reportDate);
    const to = normalizeDate(req.query.to || req.query.reportDate || from);
    if (!from || !to || from > to) return res.status(400).json({ ok: false, error: '请选择有效日期范围。' });
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(1000, Number(req.query.pageSize || 300)));
    const offset = (page - 1) * pageSize;
    const db = getDb();
    const total = Number(db.prepare(`SELECT COUNT(DISTINCT f.reportDate||'|'||f.shipmentCode) AS count ${whereSql(false)}`).get(type, from, to)?.count || 0);
    const rows = db.prepare(`
      SELECT f.reportDate,f.shipmentCode,u.regionCode,
             f.primaryCategory,f.latestEventTime,f.latestEventDesc,f.latestNode
      ${whereSql(true)}
    `).all(type, from, to, pageSize, offset).map(row => ({
      reportDate: row.reportDate,
      shipmentCode: row.shipmentCode,
      运单号: row.shipmentCode,
      businessType: type,
      regionCode: row.regionCode || '',
      currentState: 'SHOPEE_WHPP_RETENTION',
      primaryCategory: 'WHPP滞留包裹',
      specialState: 'SHOPEE_WHPP_RETENTION',
      WHPP滞留: '是',
      responsibilityHub: 'WHPP',
      latestEventTime: row.latestEventTime || '',
      最后节点时间: row.latestEventTime || '',
      latestEventDesc: row.latestEventDesc || row.latestNode || 'CE:WHPP',
      最后节点: row.latestEventDesc || row.latestNode || 'CE:WHPP'
    }));
    res.setHeader('Cache-Control', 'private, max-age=15');
    res.json({
      ok: true,
      patchId: PATCH_ID,
      businessType: type,
      from,
      to,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      responsibility: 'WHPP',
      splitByRegion: false,
      rows
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
}

express.application.listen = function v85ShopeeWhppMetricListen(...args) {
  if (!installed) {
    installed = true;
    this.get(ROUTE, handler);
  }
  return originalListen.apply(this, args);
};

export const V85_SHOPEE_WHPP_METRIC_PATCH_ID = PATCH_ID;