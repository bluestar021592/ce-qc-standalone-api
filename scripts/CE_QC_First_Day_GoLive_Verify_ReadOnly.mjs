import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = 'D:\\CE CCSL金边数据库';
const TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const SHOPEE = new Set(['SHOPEECN','SHOPEEVN']);

const resolvePath = value => path.isAbsolute(value) ? path.normalize(value) : path.resolve(root, value);
const dataDir = resolvePath(process.env.DATA_DIR || DEFAULT_DATA_DIR);
const dbFile = resolvePath(process.env.DB_FILE || path.join(dataDir, 'ce_qc_monitor.db'));
const requestedDate = String(process.argv[2] || '').trim();

function safeJson(text, fallback = {}) { try { return JSON.parse(text || ''); } catch { return fallback; } }
function billOf(row = {}) { return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase(); }
function isPod(row = {}) {
  return Number(row.isPod || 0) === 1
    || String(row.是否POD || '').trim() === '是'
    || String(row.orderStatus || '').trim() === '85'
    || String(row.currentState || row.state || '').trim().toUpperCase() === 'POD'
    || String(row.异常分类 || row.primaryCategory || row.category || '').trim().toUpperCase() === 'POD闭环';
}
function zeros() { return Object.fromEntries(TYPES.map(t => [t, 0])); }
function pad(v, n) { return String(v).padEnd(n); }

if (!fs.existsSync(dbFile)) {
  console.error(`BLOCKED: database not found: ${dbFile}`);
  process.exit(20);
}

const before = fs.statSync(dbFile);
const db = new DatabaseSync(dbFile, { readOnly: true });
let exitCode = 20;
try {
  const integrity = String(db.prepare('PRAGMA integrity_check').get()?.integrity_check || 'unknown');
  const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : String(db.prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get()?.reportDate || '');
  const batch = reportDate ? db.prepare(`
    SELECT b.*,s.status snapshotStatus,s.payloadJson
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND b.reportDate=?
    ORDER BY b.createdAt DESC LIMIT 1
  `).get(reportDate) : null;

  console.log('\nCE QC FIRST-DAY GO-LIVE VERIFY - STRICT READ ONLY');
  console.log(`Database: ${dbFile}`);
  console.log(`SQLite integrity: ${integrity}`);
  console.log(`Report date: ${reportDate || 'NONE'}`);
  if (!batch) {
    console.log('GO_LIVE_RESULT: BLOCKED_NO_VALID_IMPORT');
    exitCode = 20;
  } else {
    console.log(`Snapshot status: ${batch.snapshotStatus || 'MISSING'}`);
    const expected = zeros();
    for (const row of db.prepare('SELECT businessType,COUNT(*) count FROM unified_import_rows WHERE snapshotId=? GROUP BY businessType').all(batch.snapshotId)) {
      if (TYPES.includes(row.businessType)) expected[row.businessType] = Number(row.count || 0);
    }

    const payload = safeJson(batch.payloadJson, {});
    const payloadRows = Array.isArray(payload.finalRows) ? payload.finalRows : [];
    const payloadCount = zeros();
    const payloadPod = zeros();
    for (const row of payloadRows) {
      const type = String(row.businessType || '').toUpperCase();
      if (!TYPES.includes(type)) continue;
      payloadCount[type] += 1;
      if (isPod(row)) payloadPod[type] += 1;
    }

    const normalizedCount = zeros();
    const normalizedPod = zeros();
    const currentCount = zeros();
    const currentPod = zeros();

    for (const type of TYPES) {
      if (SHOPEE.has(type)) {
        const r = db.prepare(`
          SELECT COUNT(f.shipmentCode) count,COALESCE(SUM(CASE WHEN f.isPod=1 THEN 1 ELSE 0 END),0) pod
          FROM unified_import_rows u
          LEFT JOIN business_final_rows f
            ON f.shipmentCode=u.shipmentCode AND f.businessType='SHOPEE' AND f.reportDate=?
          WHERE u.snapshotId=? AND u.businessType=?
        `).get(reportDate, batch.snapshotId, type) || {};
        normalizedCount[type] = Number(r.count || 0);
        normalizedPod[type] = Number(r.pod || 0);
      } else {
        const r = db.prepare(`
          SELECT COUNT(f.shipmentCode) count,COALESCE(SUM(CASE WHEN f.isPod=1 THEN 1 ELSE 0 END),0) pod
          FROM unified_import_rows u
          LEFT JOIN final_rows f
            ON f.shipmentCode=u.shipmentCode AND f.reportDate=?
          WHERE u.snapshotId=? AND u.businessType=?
        `).get(reportDate, batch.snapshotId, type) || {};
        normalizedCount[type] = Number(r.count || 0);
        normalizedPod[type] = Number(r.pod || 0);
      }
      const c = db.prepare(`
        SELECT COUNT(s.shipmentCode) count,COALESCE(SUM(CASE WHEN UPPER(COALESCE(s.state,''))='POD' THEN 1 ELSE 0 END),0) pod
        FROM unified_import_rows u
        LEFT JOIN shipment_current_state s
          ON s.shipmentCode=u.shipmentCode AND s.snapshotId=?
        WHERE u.snapshotId=? AND u.businessType=?
      `).get(batch.snapshotId, batch.snapshotId, type) || {};
      currentCount[type] = Number(c.count || 0);
      currentPod[type] = Number(c.pod || 0);
    }

    console.log('\nBUSINESS      SRC    PAY    PAY_POD  NORM   NORM_POD  CUR    CUR_POD  RESULT');
    console.log('------------  -----  -----  -------  -----  --------  -----  -------  ----------------');
    let allPass = integrity === 'ok' && batch.snapshotStatus === 'COMPLETED';
    for (const type of TYPES) {
      const pass = expected[type] === payloadCount[type]
        && expected[type] === normalizedCount[type]
        && expected[type] === currentCount[type]
        && payloadPod[type] === normalizedPod[type]
        && payloadPod[type] === currentPod[type];
      if (!pass) allPass = false;
      console.log(`${pad(type,12)}  ${pad(expected[type],5)}  ${pad(payloadCount[type],5)}  ${pad(payloadPod[type],7)}  ${pad(normalizedCount[type],5)}  ${pad(normalizedPod[type],8)}  ${pad(currentCount[type],5)}  ${pad(currentPod[type],7)}  ${pass ? 'PASS' : 'BLOCKED'}`);
    }

    const sourceTotal = Object.values(expected).reduce((a,b) => a+b,0);
    const payloadTotal = Object.values(payloadCount).reduce((a,b) => a+b,0);
    const normalizedTotal = Object.values(normalizedCount).reduce((a,b) => a+b,0);
    const currentTotal = Object.values(currentCount).reduce((a,b) => a+b,0);
    console.log(`\nTOTAL source=${sourceTotal} payload=${payloadTotal} normalized=${normalizedTotal} current=${currentTotal}`);
    console.log(`GO_LIVE_RESULT: ${allPass ? 'READY' : 'BLOCKED'}`);
    if (!allPass) console.log('Do not declare the fresh-start day live until every non-zero business row is PASS.');
    exitCode = allPass ? 0 : 10;
  }
} finally {
  db.close();
}
const after = fs.statSync(dbFile);
console.log('READ-ONLY CONFIRMED');
console.log(`DATABASE MODIFIED: ${before.size === after.size && before.mtimeMs === after.mtimeMs ? 'NO' : 'YES'}`);
process.exitCode = exitCode;
