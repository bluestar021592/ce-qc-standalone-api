import express from 'express';
import { getDb } from './db.js';

const BUSINESS_TYPES = ['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];

function safeJson(value, fallback = {}) {
  try { return JSON.parse(String(value || '')) || fallback; }
  catch { return fallback; }
}

function normalizeStatus(value) {
  const status = String(value || 'OPEN').toUpperCase();
  return ['OPEN','CLOSED','ALL'].includes(status) ? status : 'OPEN';
}

function normalizeBusiness(value) {
  const type = String(value || 'ALL').toUpperCase();
  return BUSINESS_TYPES.includes(type) ? type : 'ALL';
}

function businessCounts(status) {
  const db = getDb();
  const counts = Object.fromEntries(BUSINESS_TYPES.map(type => [type, 0]));
  const rows = status === 'ALL'
    ? db.prepare(`SELECT businessType,COUNT(*) AS count FROM carryover_open_items GROUP BY businessType`).all()
    : db.prepare(`SELECT businessType,COUNT(*) AS count FROM carryover_open_items WHERE UPPER(COALESCE(status,''))=? GROUP BY businessType`).all(status);
  for (const row of rows) {
    const type = String(row.businessType || '').toUpperCase();
    if (counts[type] !== undefined) counts[type] = Number(row.count || 0);
  }
  return { ALL: Object.values(counts).reduce((sum, value) => sum + value, 0), ...counts };
}

function loadRows(status, businessType, limit) {
  const db = getDb();
  const max = Math.max(1, Math.min(1000, Number(limit) || 500));
  const clauses = [];
  const params = [];
  if (status !== 'ALL') {
    clauses.push(`UPPER(COALESCE(o.status,''))=?`);
    params.push(status);
  }
  if (businessType !== 'ALL') {
    clauses.push('UPPER(COALESCE(o.businessType,\'\'))=?');
    params.push(businessType);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT o.shipmentCode,o.businessType,o.sourceReportDate,o.lastReportDate,o.status,o.apiStatus,o.closeReason,
           o.stateJson AS carryStateJson,o.createdAt,o.updatedAt,
           c.state AS currentState,c.apiStatus AS currentApiStatus,c.lastEventTime AS currentLastEventTime,
           c.stateJson AS currentStateJson,c.updatedAt AS currentUpdatedAt
    FROM carryover_open_items o
    LEFT JOIN shipment_current_state c ON c.shipmentCode=o.shipmentCode
    ${where}
    ORDER BY COALESCE(c.updatedAt,o.updatedAt) DESC,o.sourceReportDate,o.shipmentCode
    LIMIT ?
  `).all(...params, max);
  const now = Date.now();
  return rows.map(row => {
    const before = safeJson(row.carryStateJson, {});
    const current = safeJson(row.currentStateJson, {});
    const previousTime = String(before.lastEventTime || before.最新时间 || before.最后节点时间 || '');
    const latestTime = String(row.currentLastEventTime || current.lastEventTime || current.最新时间 || current.最后节点时间 || previousTime || '');
    const latestNode = current.latestEventDesc || current.lastEventDesc || current.最新节点 || current.最后节点
      || before.latestEventDesc || before.lastEventDesc || before.最新节点 || before.最后节点 || '';
    const hasNewNode = Boolean(latestTime && (!previousTime || latestTime > previousTime));
    const sourceMs = Date.parse(`${row.sourceReportDate}T00:00:00+07:00`);
    const daysOpen = Number.isFinite(sourceMs) ? Math.max(0, Math.floor((now - sourceMs) / 86400000)) : 0;
    return {
      shipmentCode: row.shipmentCode,
      businessType: String(row.businessType || '').toUpperCase(),
      sourceReportDate: row.sourceReportDate,
      lastReportDate: row.lastReportDate,
      status: row.status,
      currentState: row.currentState || before.currentState || '',
      apiStatus: row.currentApiStatus || row.apiStatus || '',
      latestNode,
      latestEventTime: latestTime,
      previousEventTime: previousTime,
      hasNewNode,
      daysOpen,
      category: current.primaryCategory || current.当前分类 || before.primaryCategory || before.当前分类 || '',
      pendingDays: Number(current.pendingDistinctDayCount || current.Pending次数 || before.pendingDistinctDayCount || before.Pending次数 || 0),
      ocDays: Number(current.OC天数 || before.OC天数 || 0),
      closeReason: row.closeReason || '',
      updatedAt: row.currentUpdatedAt || row.updatedAt || ''
    };
  });
}

export function v27CarryBusinessHandler(req, res) {
  try {
    const status = normalizeStatus(req.query.status);
    const businessType = normalizeBusiness(req.query.businessType);
    const counts = businessCounts(status);
    const rows = loadRows(status, businessType, req.query.limit);
    const summary = {
      total: rows.length,
      newNode: rows.filter(row => row.hasNewNode).length,
      stale3: rows.filter(row => row.daysOpen >= 3 && !row.hasNewNode).length,
      closed: rows.filter(row => String(row.status || '').toUpperCase() === 'CLOSED').length
    };
    res.setHeader('Cache-Control', 'private, max-age=20');
    res.json({
      ok: true,
      status,
      businessType,
      businessSummary: counts,
      summary,
      rows,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[V27][CARRY_BUSINESS]', error);
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
}

let installed = false;
const originalListen = express.application.listen;
express.application.listen = function v27CarryBusinessListen(...args) {
  if (!installed) {
    installed = true;
    this.get('/api/v27/carry-monitor-business', v27CarryBusinessHandler);
  }
  return originalListen.apply(this, args);
};
