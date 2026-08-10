import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = 'D:\\CE CCSL金边数据库';
const VALID_TYPES = new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN']);

function resolveProjectPath(value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(projectRoot, value);
}

function getConfig() {
  const dataDir = resolveProjectPath(process.env.DATA_DIR || DEFAULT_DATA_DIR);
  const dbFile = resolveProjectPath(process.env.DB_FILE || path.join(dataDir, 'ce_qc_monitor.db'));
  return { dataDir, dbFile };
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function billOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || row.waybill || row.billNo || '').trim().toUpperCase();
}

function isPod(row = {}) {
  return Number(row.isPod || 0) === 1
    || String(row.是否POD || '').trim() === '是'
    || String(row.orderStatus || '').trim() === '85'
    || String(row.currentState || row.state || '').trim().toUpperCase() === 'POD'
    || String(row.异常分类 || row.primaryCategory || row.category || '').trim().toUpperCase() === 'POD闭环';
}

function pct(n, d) { return d ? `${(Number(n || 0) / Number(d || 0) * 100).toFixed(2)}%` : '0.00%'; }

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function readBatch(db, reportDate) {
  return db.prepare(`
    SELECT b.*,s.status AS snapshotStatus,s.payloadJson
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND b.reportDate=?
    ORDER BY b.createdAt DESC
    LIMIT 1
  `).get(reportDate) || null;
}

function auditBusiness(db, batch, type) {
  const sourceRows = db.prepare(`
    SELECT shipmentCode FROM unified_import_rows
    WHERE snapshotId=? AND businessType=?
    ORDER BY shipmentCode
  `).all(batch.snapshotId, type);
  const sourceBills = [...new Set(sourceRows.map(r => String(r.shipmentCode || '').trim().toUpperCase()).filter(Boolean))];
  const sourceSet = new Set(sourceBills);

  const payload = safeJson(batch.payloadJson, {});
  const payloadRows = Array.isArray(payload.finalRows) ? payload.finalRows.filter(row => sourceSet.has(billOf(row))) : [];
  const payloadBills = new Set(payloadRows.map(billOf).filter(Boolean));
  const payloadPod = payloadRows.filter(isPod).length;

  let normalizedRows = [];
  if (type.startsWith('SHOPEE')) {
    if (tableExists(db, 'business_final_rows')) {
      normalizedRows = db.prepare(`
        SELECT f.* FROM business_final_rows f
        INNER JOIN unified_import_rows u
          ON u.shipmentCode=f.shipmentCode AND u.snapshotId=? AND u.businessType=?
        WHERE f.businessType='SHOPEE' AND f.reportDate=?
        ORDER BY f.shipmentCode
      `).all(batch.snapshotId, type, batch.reportDate);
    }
  } else if (tableExists(db, 'final_rows')) {
    normalizedRows = db.prepare(`
      SELECT f.* FROM final_rows f
      INNER JOIN unified_import_rows u
        ON u.shipmentCode=f.shipmentCode AND u.snapshotId=? AND u.businessType=?
      WHERE f.reportDate=?
      ORDER BY f.shipmentCode
    `).all(batch.snapshotId, type, batch.reportDate);
  }
  const normalizedBills = new Set(normalizedRows.map(billOf).filter(Boolean));
  const normalizedPod = normalizedRows.filter(isPod).length;
  const blankCategory = normalizedRows.filter(row => !String(row.currentMainCategory || row.primaryCategory || row.category || '').trim()).length;

  let currentRows = [];
  if (tableExists(db, 'shipment_current_state')) {
    currentRows = db.prepare(`
      SELECT c.shipmentCode,c.state,c.apiStatus,c.lastEventTime
      FROM shipment_current_state c
      INNER JOIN unified_import_rows u
        ON u.shipmentCode=c.shipmentCode AND u.snapshotId=? AND u.businessType=?
      WHERE c.snapshotId=?
      ORDER BY c.shipmentCode
    `).all(batch.snapshotId, type, batch.snapshotId);
  }
  const currentBills = new Set(currentRows.map(billOf).filter(Boolean));
  const currentPod = currentRows.filter(isPod).length;

  const missingPayload = sourceBills.filter(b => !payloadBills.has(b));
  const missingNormalized = sourceBills.filter(b => !normalizedBills.has(b));
  const missingCurrent = sourceBills.filter(b => !currentBills.has(b));

  let conclusion = 'CONSISTENT';
  if (missingPayload.length) conclusion = 'SNAPSHOT_PAYLOAD_MISSING';
  else if (missingNormalized.length) conclusion = 'NORMALIZED_FINAL_ROWS_MISSING';
  else if (payloadPod !== normalizedPod) conclusion = 'POD_COUNT_MISMATCH';
  else if (blankCategory === normalizedRows.length && normalizedRows.length > 0 && normalizedPod === 0) conclusion = 'NORMALIZED_OUTCOME_EMPTY';

  return {
    businessType: type,
    source: sourceBills.length,
    payloadFinal: payloadBills.size,
    payloadPod,
    normalizedFinal: normalizedBills.size,
    normalizedPod,
    currentState: currentBills.size,
    currentPod,
    blankCategory,
    missingPayloadCount: missingPayload.length,
    missingNormalizedCount: missingNormalized.length,
    missingCurrentCount: missingCurrent.length,
    sampleMissingNormalized: missingNormalized.slice(0, 10),
    conclusion
  };
}

function main() {
  const reportDate = String(process.argv[2] || '').trim();
  const requestedType = String(process.argv[3] || 'ALL').trim().toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    console.error('Usage: node scripts/CE_QC_Business_Snapshot_Audit_ReadOnly.mjs YYYY-MM-DD [BUSINESS_TYPE|ALL]');
    process.exitCode = 2;
    return;
  }
  if (requestedType !== 'ALL' && !VALID_TYPES.has(requestedType)) {
    console.error(`Unsupported business type: ${requestedType}`);
    process.exitCode = 2;
    return;
  }

  const cfg = getConfig();
  if (!fs.existsSync(cfg.dbFile)) {
    console.error(`Database not found: ${cfg.dbFile}`);
    process.exitCode = 3;
    return;
  }

  const before = fs.statSync(cfg.dbFile);
  const db = new DatabaseSync(cfg.dbFile, { readOnly: true });
  try {
    const integrity = String(db.prepare('PRAGMA integrity_check').get()?.integrity_check || 'unknown');
    const batch = readBatch(db, reportDate);
    console.log('\nCE QC BUSINESS SNAPSHOT AUDIT - STRICT READ ONLY');
    console.log(`Database: ${cfg.dbFile}`);
    console.log(`SQLite integrity: ${integrity}`);
    console.log(`Report date: ${reportDate}`);
    if (!batch) {
      console.log('RESULT: NO_VALID_BATCH');
      return;
    }
    console.log(`Batch: ${batch.batchId}`);
    console.log(`Snapshot: ${batch.snapshotId}`);
    console.log(`Snapshot status: ${batch.snapshotStatus || 'MISSING'}`);
    console.log('');
    const types = requestedType === 'ALL' ? [...VALID_TYPES] : [requestedType];
    const results = types.map(type => auditBusiness(db, batch, type));
    console.log('BUSINESS      SOURCE  PAYLOAD  PAY_POD  NORMAL  NORM_POD  CURRENT  CUR_POD  RESULT');
    console.log('------------  ------  -------  -------  ------  --------  -------  -------  -----------------------------');
    for (const r of results) {
      console.log(`${r.businessType.padEnd(12)}  ${String(r.source).padEnd(6)}  ${String(r.payloadFinal).padEnd(7)}  ${String(r.payloadPod).padEnd(7)}  ${String(r.normalizedFinal).padEnd(6)}  ${String(r.normalizedPod).padEnd(8)}  ${String(r.currentState).padEnd(7)}  ${String(r.currentPod).padEnd(7)}  ${r.conclusion}`);
    }
    console.log('');
    for (const r of results) {
      console.log(`[${r.businessType}] source=${r.source}, payload POD=${r.payloadPod} (${pct(r.payloadPod, r.source)}), normalized POD=${r.normalizedPod} (${pct(r.normalizedPod, r.source)}), blankCategory=${r.blankCategory}`);
      if (r.missingNormalizedCount) console.log(`  missing normalized final rows: ${r.missingNormalizedCount}; sample: ${r.sampleMissingNormalized.join(', ')}`);
    }
  } finally {
    db.close();
  }
  const after = fs.statSync(cfg.dbFile);
  console.log('');
  console.log('READ-ONLY CONFIRMED');
  console.log(`DATABASE MODIFIED: ${before.size === after.size && before.mtimeMs === after.mtimeMs ? 'NO' : 'YES'}`);
}

main();
