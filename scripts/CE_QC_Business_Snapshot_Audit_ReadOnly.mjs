import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = 'D:\\CE CCSL金边数据库';
const VALID_TYPES = new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const SHOPEE = new Set(['SHOPEECN','SHOPEEVN']);
const resolveProjectPath = value => path.isAbsolute(value) ? path.normalize(value) : path.resolve(projectRoot, value);
const pct = (n,d) => d ? `${(Number(n || 0) / Number(d || 0) * 100).toFixed(2)}%` : '0.00%';
const now = () => Number(process.hrtime.bigint()) / 1e6;

function getConfig() {
  const dataDir = resolveProjectPath(process.env.DATA_DIR || DEFAULT_DATA_DIR);
  return { dataDir, dbFile: resolveProjectPath(process.env.DB_FILE || path.join(dataDir, 'ce_qc_monitor.db')) };
}
function tableExists(db, name) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)); }
function readBatch(db, reportDate) {
  return db.prepare(`
    SELECT b.batchId,b.snapshotId,b.reportDate,b.createdAt,s.status AS snapshotStatus
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND b.reportDate=?
    ORDER BY b.createdAt DESC LIMIT 1
  `).get(reportDate) || null;
}
function sourceCount(db, batch, type) {
  if (type === 'WHPP') {
    if (!tableExists(db,'business_daily_parse_rows')) return 0;
    return Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?").get(batch.reportDate)?.count || 0);
  }
  return Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM unified_import_rows WHERE snapshotId=? AND businessType=?").get(batch.snapshotId, type)?.count || 0);
}
function normalizedStats(db, batch, type) {
  if (type === 'WHPP') {
    if (!tableExists(db,'business_final_rows')) return {count:0,pod:0,blank:0};
    return db.prepare(`
      SELECT COUNT(*) count,COALESCE(SUM(pod),0) pod,COALESCE(SUM(blank),0) blank FROM (
        SELECT shipmentCode,
          MAX(CASE WHEN COALESCE(isPod,0)=1 THEN 1 ELSE 0 END) pod,
          MIN(CASE WHEN COALESCE(primaryCategory,'')='' THEN 1 ELSE 0 END) blank
        FROM business_final_rows
        WHERE businessType='WHPP' AND reportDate=?
        GROUP BY shipmentCode
      )
    `).get(batch.reportDate) || {count:0,pod:0,blank:0};
  }
  if (SHOPEE.has(type)) {
    if (!tableExists(db,'business_final_rows')) return {count:0,pod:0,blank:0};
    return db.prepare(`
      SELECT COUNT(*) count,COALESCE(SUM(pod),0) pod,COALESCE(SUM(blank),0) blank FROM (
        SELECT f.shipmentCode,
          MAX(CASE WHEN COALESCE(f.isPod,0)=1 THEN 1 ELSE 0 END) pod,
          MIN(CASE WHEN COALESCE(f.primaryCategory,'')='' THEN 1 ELSE 0 END) blank
        FROM business_final_rows f
        INNER JOIN unified_import_rows u ON u.shipmentCode=f.shipmentCode AND u.snapshotId=? AND u.businessType=?
        WHERE f.reportDate=? AND f.businessType IN ('SHOPEE', ?)
        GROUP BY f.shipmentCode
      )
    `).get(batch.snapshotId,type,batch.reportDate,type) || {count:0,pod:0,blank:0};
  }
  if (!tableExists(db,'final_rows')) return {count:0,pod:0,blank:0};
  return db.prepare(`
    SELECT COUNT(*) count,COALESCE(SUM(pod),0) pod,COALESCE(SUM(blank),0) blank FROM (
      SELECT f.shipmentCode,
        MAX(CASE WHEN COALESCE(f.isPod,0)=1 THEN 1 ELSE 0 END) pod,
        MIN(CASE WHEN COALESCE(f.primaryCategory,'')='' THEN 1 ELSE 0 END) blank
      FROM final_rows f
      INNER JOIN unified_import_rows u ON u.shipmentCode=f.shipmentCode AND u.snapshotId=? AND u.businessType=?
      WHERE f.reportDate=?
      GROUP BY f.shipmentCode
    )
  `).get(batch.snapshotId,type,batch.reportDate) || {count:0,pod:0,blank:0};
}
function currentStats(db, batch, type) {
  if (!tableExists(db,'shipment_current_state')) return {count:0,pod:0};
  if (type === 'WHPP') {
    return db.prepare(`
      SELECT COUNT(*) count,COALESCE(SUM(pod),0) pod FROM (
        SELECT shipmentCode,MAX(CASE WHEN UPPER(COALESCE(state,''))='POD' THEN 1 ELSE 0 END) pod
        FROM shipment_current_state WHERE businessType='WHPP' AND reportDate=? GROUP BY shipmentCode
      )
    `).get(batch.reportDate) || {count:0,pod:0};
  }
  return db.prepare(`
    SELECT COUNT(*) count,COALESCE(SUM(pod),0) pod FROM (
      SELECT s.shipmentCode,MAX(CASE WHEN UPPER(COALESCE(s.state,''))='POD' THEN 1 ELSE 0 END) pod
      FROM shipment_current_state s
      INNER JOIN unified_import_rows u ON u.shipmentCode=s.shipmentCode AND u.snapshotId=? AND u.businessType=?
      WHERE s.snapshotId=? GROUP BY s.shipmentCode
    )
  `).get(batch.snapshotId,type,batch.snapshotId) || {count:0,pod:0};
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
    console.error(`RESULT: BLOCKED_DATABASE_NOT_FOUND ${cfg.dbFile}`);
    process.exitCode = 3;
    return;
  }

  const before = fs.statSync(cfg.dbFile);
  const db = new DatabaseSync(cfg.dbFile, { readOnly: true });
  let blocked = false;
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1500;');
    console.log('\nCE QC BUSINESS SNAPSHOT AUDIT - FAST STRICT READ ONLY');
    console.log(`Database: ${cfg.dbFile}`);
    console.log(`Report date: ${reportDate}`);
    console.log('Large snapshot payload JSON is intentionally NOT parsed during live verification.');
    const batch = readBatch(db, reportDate);
    if (!batch) {
      console.log('RESULT: BLOCKED_NO_VALID_BATCH');
      process.exitCode = 10;
      return;
    }
    console.log(`Batch: ${batch.batchId}`);
    console.log(`Snapshot: ${batch.snapshotId}`);
    console.log(`Snapshot status: ${batch.snapshotStatus || 'MISSING'}`);
    if (batch.snapshotStatus !== 'COMPLETED') blocked = true;

    const types = requestedType === 'ALL' ? [...VALID_TYPES] : [requestedType];
    console.log('\nBUSINESS      SOURCE  NORMAL  NORM_POD  CURRENT  CUR_POD  BLANK_CAT  QUERY_MS  RESULT');
    console.log('------------  ------  ------  --------  -------  -------  ---------  --------  ----------------------');
    for (const type of types) {
      const started = now();
      const source = sourceCount(db,batch,type);
      const norm = normalizedStats(db,batch,type);
      const current = currentStats(db,batch,type);
      const elapsed = now() - started;
      const pass = source === Number(norm.count || 0)
        && source === Number(current.count || 0)
        && Number(norm.pod || 0) === Number(current.pod || 0);
      if (!pass || elapsed > 3000) blocked = true;
      console.log(`${type.padEnd(12)}  ${String(source).padEnd(6)}  ${String(norm.count||0).padEnd(6)}  ${String(norm.pod||0).padEnd(8)}  ${String(current.count||0).padEnd(7)}  ${String(current.pod||0).padEnd(7)}  ${String(norm.blank||0).padEnd(9)}  ${elapsed.toFixed(1).padEnd(8)}  ${pass ? (elapsed > 3000 ? 'BLOCKED_SLOW_QUERY' : 'CONSISTENT') : 'BLOCKED_MISMATCH'}`);
      console.log(`  POD rate: ${pct(norm.pod, source)}`);
    }
    console.log(`\nRESULT: ${blocked ? 'BLOCKED' : 'READY'}`);
    process.exitCode = blocked ? 10 : 0;
  } catch (error) {
    console.error('RESULT: BLOCKED_AUDIT_ERROR');
    console.error(error?.stack || error);
    process.exitCode = 20;
  } finally {
    db.close();
  }
  const after = fs.statSync(cfg.dbFile);
  console.log('READ-ONLY CONFIRMED');
  console.log(`DATABASE MODIFIED: ${before.size === after.size && before.mtimeMs === after.mtimeMs ? 'NO' : 'YES'}`);
}

main();
