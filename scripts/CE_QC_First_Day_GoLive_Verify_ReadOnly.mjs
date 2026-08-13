import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = 'D:\\CE CCSL金边数据库';
const CORE_TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const TYPES = [...CORE_TYPES, 'WHPP'];
const SHOPEE = new Set(['SHOPEECN','SHOPEEVN']);

const resolvePath = value => path.isAbsolute(value) ? path.normalize(value) : path.resolve(root, value);
const dataDir = resolvePath(process.env.DATA_DIR || DEFAULT_DATA_DIR);
const dbFile = resolvePath(process.env.DB_FILE || path.join(dataDir, 'ce_qc_monitor.db'));
const requestedDate = String(process.argv[2] || '').trim();

const zeros = () => Object.fromEntries(TYPES.map(type => [type, 0]));
const pad = (value, width) => String(value).padEnd(width);
const now = () => Number(process.hrtime.bigint()) / 1e6;

function timed(label, fn) {
  const started = now();
  const value = fn();
  const elapsed = now() - started;
  console.log(`[PERF] ${label}: ${elapsed.toFixed(1)} ms`);
  return { value, elapsed };
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function groupedSourceCounts(db, snapshotId) {
  const out = zeros();
  const rows = db.prepare(`
    SELECT businessType, COUNT(DISTINCT shipmentCode) AS count
    FROM unified_import_rows
    WHERE snapshotId=?
    GROUP BY businessType
  `).all(snapshotId);
  for (const row of rows) if (CORE_TYPES.includes(row.businessType)) out[row.businessType] = Number(row.count || 0);
  return out;
}

function whppSourceCount(db, reportDate) {
  if (!tableExists(db, 'business_daily_parse_rows')) return 0;
  return Number(db.prepare(`
    SELECT COUNT(DISTINCT shipmentCode) AS count
    FROM business_daily_parse_rows
    WHERE businessType='WHPP' AND reportDate=?
  `).get(reportDate)?.count || 0);
}

function normalizedStats(db, batch, type) {
  if (type === 'WHPP') {
    if (!tableExists(db, 'business_final_rows')) return { count: 0, pod: 0 };
    return db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(pod),0) AS pod
      FROM (
        SELECT shipmentCode, MAX(CASE WHEN COALESCE(isPod,0)=1 THEN 1 ELSE 0 END) AS pod
        FROM business_final_rows
        WHERE businessType='WHPP' AND reportDate=?
        GROUP BY shipmentCode
      )
    `).get(batch.reportDate) || { count: 0, pod: 0 };
  }

  if (SHOPEE.has(type)) {
    if (!tableExists(db, 'business_final_rows')) return { count: 0, pod: 0 };
    return db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(pod),0) AS pod
      FROM (
        SELECT f.shipmentCode, MAX(CASE WHEN COALESCE(f.isPod,0)=1 THEN 1 ELSE 0 END) AS pod
        FROM business_final_rows f
        INNER JOIN unified_import_rows u
          ON u.shipmentCode=f.shipmentCode AND u.snapshotId=? AND u.businessType=?
        WHERE f.reportDate=? AND f.businessType IN ('SHOPEE', ?)
        GROUP BY f.shipmentCode
      )
    `).get(batch.snapshotId, type, batch.reportDate, type) || { count: 0, pod: 0 };
  }

  if (!tableExists(db, 'final_rows')) return { count: 0, pod: 0 };
  return db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(pod),0) AS pod
    FROM (
      SELECT f.shipmentCode, MAX(CASE WHEN COALESCE(f.isPod,0)=1 THEN 1 ELSE 0 END) AS pod
      FROM final_rows f
      INNER JOIN unified_import_rows u
        ON u.shipmentCode=f.shipmentCode AND u.snapshotId=? AND u.businessType=?
      WHERE f.reportDate=?
      GROUP BY f.shipmentCode
    )
  `).get(batch.snapshotId, type, batch.reportDate) || { count: 0, pod: 0 };
}

function currentStats(db, batch, type) {
  if (!tableExists(db, 'shipment_current_state')) return { count: 0, pod: 0 };
  if (type === 'WHPP') {
    return db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(pod),0) AS pod
      FROM (
        SELECT shipmentCode, MAX(CASE WHEN UPPER(COALESCE(state,''))='POD' THEN 1 ELSE 0 END) AS pod
        FROM shipment_current_state
        WHERE businessType='WHPP' AND reportDate=?
        GROUP BY shipmentCode
      )
    `).get(batch.reportDate) || { count: 0, pod: 0 };
  }
  return db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(pod),0) AS pod
    FROM (
      SELECT s.shipmentCode, MAX(CASE WHEN UPPER(COALESCE(s.state,''))='POD' THEN 1 ELSE 0 END) AS pod
      FROM shipment_current_state s
      INNER JOIN unified_import_rows u
        ON u.shipmentCode=s.shipmentCode AND u.snapshotId=? AND u.businessType=?
      WHERE s.snapshotId=?
      GROUP BY s.shipmentCode
    )
  `).get(batch.snapshotId, type, batch.snapshotId) || { count: 0, pod: 0 };
}

if (!fs.existsSync(dbFile)) {
  console.error(`GO_LIVE_RESULT: BLOCKED_DATABASE_NOT_FOUND`);
  console.error(`Database: ${dbFile}`);
  process.exit(20);
}

const before = fs.statSync(dbFile);
const db = new DatabaseSync(dbFile, { readOnly: true });
let exitCode = 20;
try {
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1500;');
  const dbSizeGb = before.size / 1024 / 1024 / 1024;
  console.log('\nCE QC FIRST-DAY GO-LIVE VERIFY - FAST STRICT READ ONLY');
  console.log(`Database: ${dbFile}`);
  console.log(`Database size: ${dbSizeGb.toFixed(2)} GB`);
  console.log('Live integrity mode: READ-ONLY OPEN + NORMALIZED CONSISTENCY (full PRAGMA integrity_check intentionally skipped on live multi-GB DB)');

  const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : String(db.prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get()?.reportDate || '');
  console.log(`Report date: ${reportDate || 'NONE'}`);

  const batch = reportDate ? timed('load valid batch', () => db.prepare(`
    SELECT b.batchId,b.snapshotId,b.reportDate,b.createdAt,s.status AS snapshotStatus
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND b.reportDate=?
    ORDER BY b.createdAt DESC LIMIT 1
  `).get(reportDate) || null).value : null;

  if (!batch) {
    console.log('GO_LIVE_RESULT: BLOCKED_NO_VALID_IMPORT');
    exitCode = 20;
  } else {
    console.log(`Batch: ${batch.batchId}`);
    console.log(`Snapshot: ${batch.snapshotId}`);
    console.log(`Snapshot status: ${batch.snapshotStatus || 'MISSING'}`);

    const source = timed('source membership counts', () => groupedSourceCounts(db, batch.snapshotId)).value;
    source.WHPP = timed('WHPP source count', () => whppSourceCount(db, reportDate)).value;

    const normalizedCount = zeros();
    const normalizedPod = zeros();
    const currentCount = zeros();
    const currentPod = zeros();
    let slowestMs = 0;

    for (const type of TYPES) {
      const norm = timed(`${type} normalized`, () => normalizedStats(db, batch, type));
      normalizedCount[type] = Number(norm.value.count || 0);
      normalizedPod[type] = Number(norm.value.pod || 0);
      slowestMs = Math.max(slowestMs, norm.elapsed);

      const current = timed(`${type} current-state`, () => currentStats(db, batch, type));
      currentCount[type] = Number(current.value.count || 0);
      currentPod[type] = Number(current.value.pod || 0);
      slowestMs = Math.max(slowestMs, current.elapsed);
    }

    console.log('\nBUSINESS      SOURCE  NORMAL  NORM_POD  CURRENT  CUR_POD  RESULT');
    console.log('------------  ------  ------  --------  -------  -------  ----------------');
    let allPass = batch.snapshotStatus === 'COMPLETED';
    for (const type of TYPES) {
      const pass = source[type] === normalizedCount[type]
        && source[type] === currentCount[type]
        && normalizedPod[type] === currentPod[type];
      if (!pass) allPass = false;
      console.log(`${pad(type,12)}  ${pad(source[type],6)}  ${pad(normalizedCount[type],6)}  ${pad(normalizedPod[type],8)}  ${pad(currentCount[type],7)}  ${pad(currentPod[type],7)}  ${pass ? 'PASS' : 'BLOCKED'}`);
    }

    const sourceTotal = Object.values(source).reduce((a,b) => a + Number(b || 0), 0);
    const normalizedTotal = Object.values(normalizedCount).reduce((a,b) => a + Number(b || 0), 0);
    const currentTotal = Object.values(currentCount).reduce((a,b) => a + Number(b || 0), 0);
    console.log(`\nTOTAL source=${sourceTotal} normalized=${normalizedTotal} current=${currentTotal}`);
    console.log(`SLOWEST_DB_CHECK_MS: ${slowestMs.toFixed(1)}`);
    if (slowestMs > 3000) {
      console.log('PERFORMANCE_RESULT: BLOCKED_SLOW_DB_QUERY');
      allPass = false;
    } else if (slowestMs > 1000) {
      console.log('PERFORMANCE_RESULT: WARN_QUERY_OVER_1S');
    } else {
      console.log('PERFORMANCE_RESULT: PASS');
    }

    console.log(`GO_LIVE_RESULT: ${allPass ? 'READY' : 'BLOCKED'}`);
    exitCode = allPass ? 0 : 10;
  }
} catch (error) {
  console.error('GO_LIVE_RESULT: BLOCKED_AUDIT_ERROR');
  console.error(error?.stack || error);
  exitCode = 30;
} finally {
  db.close();
}

const after = fs.statSync(dbFile);
console.log('READ-ONLY CONFIRMED');
console.log(`DATABASE MODIFIED: ${before.size === after.size && before.mtimeMs === after.mtimeMs ? 'NO' : 'YES'}`);
process.exitCode = exitCode;
