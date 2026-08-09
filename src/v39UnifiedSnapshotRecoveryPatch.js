import express from 'express';
import { getDb, nowIso } from './db.js';
import { buildConsistencyReport } from './consistency.js';

const GUARDED_ROUTES = new Set(['/api/shopee/run/start', '/api/shopee/run/resume']);
const installedRoutes = new Set();

function billOf(row = {}) {
  return String(row?.运单号 || row?.shipmentCode || row?.waybill || row?.billNo || '').trim().toUpperCase();
}

function dedupeRowsByBill(rows = []) {
  const output = [];
  const positionByBill = new Map();
  for (const row of rows || []) {
    const bill = billOf(row);
    if (!bill) {
      output.push(row);
      continue;
    }
    if (positionByBill.has(bill)) {
      // Pipeline order is scan-derived row first, trajectory-derived row later.
      // Keep the later row so trajectory status 80 / latest effective state wins.
      output[positionByBill.get(bill)] = row;
      continue;
    }
    positionByBill.set(bill, output.length);
    output.push(row);
  }
  return output;
}

function duplicateOnlyConsistency(consistency = {}) {
  const errors = Array.isArray(consistency?.errors) ? consistency.errors.map(value => String(value || '')) : [];
  return errors.length > 0 && errors.every(message => /最终结果存在重复运单号/.test(message));
}

function currentUnifiedReportDate(db) {
  return String(db.prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC LIMIT 1").get()?.reportDate || '').trim();
}

export function repairLegacyDuplicateOnlyCcslSnapshot(reportDate = '') {
  const db = getDb();
  const date = String(reportDate || currentUnifiedReportDate(db)).trim();
  if (!date) return { repaired: false, reason: 'REPORT_DATE_MISSING' };

  const row = db.prepare(`
    SELECT id,snapshotId,payloadJson,status,reconciliationStatus
    FROM export_snapshots
    WHERE reportDate=? AND snapshotType='dashboard'
    ORDER BY id DESC LIMIT 1
  `).get(date);
  if (!row?.payloadJson) return { repaired: false, reason: 'CCSL_SNAPSHOT_MISSING', reportDate: date };
  if (String(row.status || 'VALID') === 'VALID' && String(row.reconciliationStatus || 'COMPLETED') === 'COMPLETED') {
    return { repaired: false, reason: 'ALREADY_VALID', reportDate: date, snapshotId: row.snapshotId };
  }

  let payload;
  try { payload = JSON.parse(row.payloadJson || '{}'); }
  catch { return { repaired: false, reason: 'SNAPSHOT_JSON_INVALID', reportDate: date, snapshotId: row.snapshotId }; }

  if (!duplicateOnlyConsistency(payload.consistency)) {
    return {
      repaired: false,
      reason: 'NOT_DUPLICATE_ONLY',
      reportDate: date,
      snapshotId: row.snapshotId,
      errors: Array.isArray(payload.consistency?.errors) ? payload.consistency.errors.slice(0, 20) : []
    };
  }

  const state = payload.state && typeof payload.state === 'object' ? payload.state : {};
  const before = Array.isArray(state.finalRows) ? state.finalRows.length : 0;
  state.finalRows = dedupeRowsByBill(state.finalRows || []);
  state.finalDiversionRows = dedupeRowsByBill(state.finalDiversionRows || []);
  const after = state.finalRows.length;
  const consistency = buildConsistencyReport(state);

  // Never relax a real business-data inconsistency. Recovery is allowed only when
  // deduping the known legacy scan-POD + trajectory-POD duplicate removes every
  // hard consistency error. Warnings remain visible but are not reconciliation
  // blockers, matching createDashboardSnapshot's normal behavior.
  if (Array.isArray(consistency.errors) && consistency.errors.length > 0) {
    return {
      repaired: false,
      reason: 'ERRORS_REMAIN_AFTER_DEDUPE',
      reportDate: date,
      snapshotId: row.snapshotId,
      removedDuplicates: Math.max(0, before - after),
      errors: consistency.errors.slice(0, 20)
    };
  }

  payload.state = state;
  payload.consistency = consistency;
  payload.status = 'VALID';
  payload.reconciliationStatus = 'COMPLETED';
  payload.legacyDuplicateRecovery = {
    recoveredAt: nowIso(),
    reason: 'CCSL_SCAN_AND_TRACK_POD_DUPLICATE',
    finalRowsBefore: before,
    finalRowsAfter: after,
    removedDuplicates: Math.max(0, before - after)
  };

  const now = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE export_snapshots
      SET payloadJson=?, consistencyJson=?, status='VALID', reconciliationStatus='COMPLETED', invalidReason=''
      WHERE id=?
    `).run(JSON.stringify(payload), JSON.stringify(consistency), row.id);
    db.prepare(`
      INSERT INTO app_meta(key,value,updatedAt) VALUES('current_snapshot_id',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt
    `).run(row.snapshotId, now);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }

  console.log(`[V39][UNIFIED_RECOVERY] repaired CCSL duplicate-only snapshot ${row.snapshotId}: ${before} -> ${after}`);
  return {
    repaired: true,
    reportDate: date,
    snapshotId: row.snapshotId,
    finalRowsBefore: before,
    finalRowsAfter: after,
    removedDuplicates: Math.max(0, before - after)
  };
}

function prepareUnifiedReconciliation(req, res, next) {
  try {
    const result = repairLegacyDuplicateOnlyCcslSnapshot();
    if (result.repaired) req.ceQcLegacySnapshotRecovery = result;
    next();
  } catch (error) {
    console.error('[V39][UNIFIED_RECOVERY]', error);
    next(error);
  }
}

const previousPost = express.application.post;
express.application.post = function v39UnifiedSnapshotRecoveryPost(...args) {
  const route = String(args[0] || '');
  if (GUARDED_ROUTES.has(route) && !installedRoutes.has(route)) {
    installedRoutes.add(route);
    return previousPost.apply(this, [args[0], prepareUnifiedReconciliation, ...args.slice(1)]);
  }
  return previousPost.apply(this, args);
};
