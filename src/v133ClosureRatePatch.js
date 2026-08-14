import express from 'express';
import { getDb } from './db.js';

const PATCH_ID = '2026-08-14-v133-unified-closure-rate-v2';
const ROUTE = '/api/v133/closure-summary';
const TYPES = Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const cache = new Map();
const CACHE_MS = Math.max(5_000, Number(process.env.V133_CLOSURE_CACHE_MS || 15_000));

function text(value) { return String(value ?? '').trim(); }
function dateOnly(value) {
  const valueText = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(valueText) ? valueText : '';
}
function rate(closed, total) { return total ? Number((Number(closed || 0) * 100 / Number(total)).toFixed(2)) : null; }

function latestBatch(db, requestedDate = '') {
  const date = dateOnly(requestedDate);
  if (date) return db.prepare(`SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC LIMIT 1`).get(date) || null;
  return db.prepare(`SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1`).get() || null;
}
function hasCompletedSnapshot(db, businessType, reportDate, total) {
  if (Number(total || 0) <= 0) return true;
  return Boolean(db.prepare(`SELECT 1 FROM business_export_snapshots WHERE businessType=? AND reportDate=? AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED' ORDER BY createdAt DESC LIMIT 1`).get(businessType, reportDate));
}
function coreRows(db, batch) {
  const result = new Map();
  if (!batch?.snapshotId) return result;
  const rows = db.prepare(`
    SELECT u.businessType,COUNT(*) AS total,
           SUM(CASE WHEN UPPER(COALESCE(c.status,'OPEN'))='OPEN' THEN 1 ELSE 0 END) AS unresolved
    FROM (SELECT DISTINCT businessType,shipmentCode FROM unified_import_rows WHERE snapshotId=?) u
    LEFT JOIN carryover_open_items c ON c.shipmentCode=u.shipmentCode AND c.businessType=u.businessType
    GROUP BY u.businessType
  `).all(batch.snapshotId);
  for (const row of rows) {
    const type = text(row.businessType).toUpperCase();
    if (!TYPES.includes(type) || type === 'WHPP') continue;
    result.set(type, { total:Number(row.total || 0), unresolved:Number(row.unresolved || 0) });
  }
  return result;
}
function whppRow(db, reportDate) {
  const row = db.prepare(`
    SELECT COUNT(*) AS total,SUM(CASE WHEN UPPER(COALESCE(c.status,'OPEN'))='OPEN' THEN 1 ELSE 0 END) AS unresolved
    FROM (SELECT DISTINCT shipmentCode FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?) w
    LEFT JOIN carryover_open_items c ON c.shipmentCode=w.shipmentCode AND c.businessType='WHPP'
  `).get(reportDate) || {};
  return { total:Number(row.total || 0), unresolved:Number(row.unresolved || 0) };
}
function buildSummary(requestedDate = '') {
  const db = getDb();
  const batch = latestBatch(db, requestedDate);
  if (!batch) return { ok:true, patchId:PATCH_ID, reportDate:'', total:0, closed:0, unresolved:0, closureRate:null, completed:true, byBusiness:{} };
  const key = `${batch.snapshotId}|${batch.reportDate}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.payload, cacheHit:true };
  const core = coreRows(db, batch); core.set('WHPP', whppRow(db, batch.reportDate));
  const byBusiness = {}; let total = 0; let unresolved = 0; let allCompleted = true;
  for (const type of TYPES) {
    const row = core.get(type) || { total:0, unresolved:0 };
    const businessTotal = Number(row.total || 0);
    const safeUnresolved = Math.max(0, Math.min(businessTotal, Number(row.unresolved || 0)));
    const closed = Math.max(0, businessTotal - safeUnresolved);
    const completed = hasCompletedSnapshot(db, type, batch.reportDate, businessTotal);
    byBusiness[type] = { total:businessTotal, closed, unresolved:safeUnresolved, closureRate:businessTotal > 0 && completed ? rate(closed, businessTotal) : null, completed };
    total += businessTotal; unresolved += safeUnresolved;
    if (businessTotal > 0 && !completed) allCompleted = false;
  }
  const closed = Math.max(0, total - unresolved);
  const payload = { ok:true, patchId:PATCH_ID, reportDate:batch.reportDate, snapshotId:batch.snapshotId, total, closed, unresolved, closureRate:total > 0 && allCompleted ? rate(closed,total) : null, completed:allCompleted, byBusiness, generatedAt:new Date().toISOString(), cacheHit:false };
  cache.set(key, { at:Date.now(), payload });
  return payload;
}
function handler(req,res){
  try { const payload=buildSummary(req.query.reportDate||req.query.date||''); res.setHeader('Cache-Control','private, max-age=10'); res.setHeader('Server-Timing','v133;desc=closure-summary'); res.json(payload); }
  catch(error){ res.status(500).json({ok:false,patchId:PATCH_ID,error:error?.message||String(error)}); }
}
const originalListen=express.application.listen; let installed=false;
express.application.listen=function v133ClosureListen(...args){ if(!installed){installed=true;this.get(ROUTE,handler);} return originalListen.apply(this,args); };
export function inspectV133ClosureSummary(requestedDate=''){return buildSummary(requestedDate);}
export const V133_CLOSURE_RATE_PATCH_ID=PATCH_ID;
