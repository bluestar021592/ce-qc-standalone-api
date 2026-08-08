import express from 'express';
import { getDb } from './db.js';

const BUSINESS_TYPES = ['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];

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
    ? db.prepare(`SELECT UPPER(COALESCE(businessType,'')) AS businessType,COUNT(*) AS count FROM carryover_open_items GROUP BY UPPER(COALESCE(businessType,''))`).all()
    : db.prepare(`SELECT UPPER(COALESCE(businessType,'')) AS businessType,COUNT(*) AS count FROM carryover_open_items WHERE UPPER(COALESCE(status,''))=? GROUP BY UPPER(COALESCE(businessType,''))`).all(status);
  for (const row of rows) {
    const type = String(row.businessType || '').toUpperCase();
    if (counts[type] !== undefined) counts[type] = Number(row.count || 0);
  }
  return { ALL: Object.values(counts).reduce((sum, value) => sum + value, 0), ...counts };
}

function jsonValue(alias, paths) {
  const args = paths.map(path => `json_extract(${alias}.stateJson,'${path}')`).join(',');
  return `CASE WHEN json_valid(${alias}.stateJson) THEN COALESCE(${args}) END`;
}

function buildBaseSql(status, businessType) {
  const clauses = [];
  const params = [];
  if (status !== 'ALL') {
    clauses.push(`UPPER(COALESCE(o.status,''))=?`);
    params.push(status);
  }
  if (businessType !== 'ALL') {
    clauses.push(`UPPER(COALESCE(o.businessType,''))=?`);
    params.push(businessType);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const previousTime = `COALESCE(${jsonValue('o',['$.lastEventTime','$.最新时间','$.最后节点时间'])},'')`;
  const currentJsonTime = jsonValue('c',['$.lastEventTime','$.最新时间','$.最后节点时间']);
  const latestTime = `COALESCE(c.lastEventTime,${currentJsonTime},${previousTime},'')`;
  const latestNode = `COALESCE(${jsonValue('c',['$.latestEventDesc','$.lastEventDesc','$.最新节点','$.最后节点'])},${jsonValue('o',['$.latestEventDesc','$.lastEventDesc','$.最新节点','$.最后节点'])},'')`;
  const category = `COALESCE(${jsonValue('c',['$.primaryCategory','$.当前分类'])},${jsonValue('o',['$.primaryCategory','$.当前分类'])},'')`;
  const pendingDays = `CAST(COALESCE(${jsonValue('c',['$.pendingDistinctDayCount','$.Pending次数'])},${jsonValue('o',['$.pendingDistinctDayCount','$.Pending次数'])},0) AS INTEGER)`;
  const ocDays = `CAST(COALESCE(${jsonValue('c',['$.OC天数'])},${jsonValue('o',['$.OC天数'])},0) AS INTEGER)`;

  const sql = `
    WITH base AS (
      SELECT
        o.shipmentCode,
        UPPER(COALESCE(o.businessType,'')) AS businessType,
        o.sourceReportDate,
        o.lastReportDate,
        o.status,
        COALESCE(c.state,'') AS currentState,
        COALESCE(c.apiStatus,o.apiStatus,'') AS apiStatus,
        o.closeReason,
        ${previousTime} AS previousEventTime,
        ${latestTime} AS latestEventTime,
        ${latestNode} AS latestNode,
        ${category} AS category,
        ${pendingDays} AS pendingDays,
        ${ocDays} AS ocDays,
        COALESCE(c.updatedAt,o.updatedAt,'') AS effectiveUpdatedAt
      FROM carryover_open_items o
      LEFT JOIN shipment_current_state c ON c.shipmentCode=o.shipmentCode
      ${where}
    )
  `;
  return { sql, params };
}

function loadCarryData(status, businessType, rawLimit) {
  const db = getDb();
  const pageSize = Math.max(1, Math.min(100, Number(rawLimit) || 50));
  const { sql, params } = buildBaseSql(status, businessType);
  const changedExpr = `(latestEventTime<>'' AND (previousEventTime='' OR latestEventTime>previousEventTime))`;
  const daysExpr = `CAST(MAX(0,julianday('now','localtime')-julianday(sourceReportDate)) AS INTEGER)`;

  const summaryRow = db.prepare(`${sql}
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ${changedExpr} THEN 1 ELSE 0 END) AS newNode,
      SUM(CASE WHEN ${daysExpr}>=3 AND NOT ${changedExpr} THEN 1 ELSE 0 END) AS stale3,
      SUM(CASE WHEN UPPER(COALESCE(status,''))='CLOSED' THEN 1 ELSE 0 END) AS closed
    FROM base
  `).get(...params) || {};

  const rows = db.prepare(`${sql}
    SELECT *,
      CASE WHEN ${changedExpr} THEN 1 ELSE 0 END AS hasNewNode,
      ${daysExpr} AS daysOpen
    FROM base
    ORDER BY effectiveUpdatedAt DESC,sourceReportDate,shipmentCode
    LIMIT ?
  `).all(...params, pageSize).map(row => ({
    shipmentCode: row.shipmentCode,
    businessType: row.businessType,
    sourceReportDate: row.sourceReportDate,
    lastReportDate: row.lastReportDate,
    status: row.status,
    currentState: row.currentState,
    apiStatus: row.apiStatus,
    latestNode: row.latestNode || '',
    latestEventTime: row.latestEventTime || '',
    previousEventTime: row.previousEventTime || '',
    hasNewNode: Boolean(row.hasNewNode),
    daysOpen: Number(row.daysOpen || 0),
    category: row.category || '',
    pendingDays: Number(row.pendingDays || 0),
    ocDays: Number(row.ocDays || 0),
    closeReason: row.closeReason || '',
    updatedAt: row.effectiveUpdatedAt || ''
  }));

  return {
    rows,
    pageSize,
    summary: {
      total: Number(summaryRow.total || 0),
      newNode: Number(summaryRow.newNode || 0),
      stale3: Number(summaryRow.stale3 || 0),
      closed: Number(summaryRow.closed || 0)
    }
  };
}

export function v27CarryBusinessHandler(req, res) {
  const started = Date.now();
  try {
    const status = normalizeStatus(req.query.status);
    const businessType = normalizeBusiness(req.query.businessType);
    const counts = businessCounts(status);
    const data = loadCarryData(status, businessType, req.query.limit || req.query.pageSize);
    res.setHeader('Cache-Control', 'private, max-age=20, stale-while-revalidate=60');
    res.setHeader('Server-Timing', `carry-monitor;dur=${Date.now()-started}`);
    res.json({
      ok: true,
      status,
      businessType,
      businessSummary: counts,
      summary: data.summary,
      rows: data.rows,
      pageSize: data.pageSize,
      generatedAt: new Date().toISOString(),
      elapsedMs: Date.now()-started
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
