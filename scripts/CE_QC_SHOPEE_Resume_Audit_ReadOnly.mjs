import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = 'D:\\CE CCSL金边数据库';
const resolvePath = value => path.isAbsolute(value) ? path.normalize(value) : path.resolve(root, value);
const dataDir = resolvePath(process.env.DATA_DIR || DEFAULT_DATA_DIR);
const dbFile = resolvePath(process.env.DB_FILE || path.join(dataDir, 'ce_qc_monitor.db'));
const LEGACY = /^(?:scan-status|track-event|exception-item):\d{6}$/i;

if (!fs.existsSync(dbFile)) {
  console.error(`RESULT: BLOCKED_DATABASE_NOT_FOUND ${dbFile}`);
  process.exit(3);
}

const before = fs.statSync(dbFile);
const db = new DatabaseSync(dbFile, { readOnly: true });
let blocked = false;
try {
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1500;');
  const report = db.prepare("SELECT reportDate,totalCount,sourceFile FROM business_daily_reports WHERE businessType='SHOPEE' ORDER BY reportDate DESC LIMIT 1").get() || {};
  const date = String(report.reportDate || '');
  const lock = date ? db.prepare("SELECT runId,status,currentStage,batchIndex,totalBatches,errorMessage,updatedAt FROM business_run_locks WHERE businessType='SHOPEE' AND reportDate=?").get(date) : null;
  const batches = date ? db.prepare("SELECT runId,apiName,batchKey,status,attemptCount,resultCount,errorMessage,payloadHash,shipmentCount FROM business_api_batches WHERE businessType='SHOPEE' AND reportDate=? ORDER BY apiName,batchKey").all(date) : [];
  const legacy = batches.filter(row => LEGACY.test(String(row.batchKey || '')));
  const scoped = batches.filter(row => /:p[a-f0-9]{12}$/i.test(String(row.batchKey || '')));
  const finalCount = date ? Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_final_rows WHERE businessType='SHOPEE' AND reportDate=?").get(date)?.count || 0) : 0;
  const scanCount = date ? Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_scan_results WHERE businessType='SHOPEE' AND reportDate=?").get(date)?.count || 0) : 0;
  const eventBills = date ? Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_track_events WHERE businessType='SHOPEE' AND reportDate=?").get(date)?.count || 0) : 0;
  const eventRows = date ? Number(db.prepare("SELECT COUNT(*) count FROM business_track_events WHERE businessType='SHOPEE' AND reportDate=?").get(date)?.count || 0) : 0;

  console.log('CE QC SHOPEE RESUME AUDIT - STRICT READ ONLY');
  console.log(`Database: ${dbFile}`);
  console.log(`Report date: ${date || 'NONE'}`);
  console.log(`Daily total: ${Number(report.totalCount || 0)}`);
  console.log(`Scan waybills persisted: ${scanCount}`);
  console.log(`Track waybills persisted: ${eventBills}`);
  console.log(`Track event rows persisted: ${eventRows}`);
  console.log(`Final rows currently persisted: ${finalCount}`);
  console.log(`API audit rows: ${batches.length}`);
  console.log(`Payload-scoped audit rows: ${scoped.length}`);
  console.log(`Legacy numeric-only audit keys: ${legacy.length}`);
  console.log(`Run status: ${lock?.status || 'NONE'} | stage=${lock?.currentStage || ''} | batch=${Number(lock?.batchIndex || 0)}/${Number(lock?.totalBatches || 0)}`);
  console.log(`Run error: ${String(lock?.errorMessage || '') || 'NONE'}`);

  if (!date) blocked = true;
  if (legacy.length) blocked = true;
  if (/批次.*(?:运单内容|保存内容).*不一致|BATCH_KEY_PAYLOAD_MISMATCH/i.test(String(lock?.errorMessage || ''))) blocked = true;

  console.log(`RESULT: ${blocked ? 'BLOCKED' : 'READY_TO_RESUME'}`);
  if (legacy.length) {
    for (const row of legacy.slice(0, 20)) console.log(`  LEGACY ${row.apiName} ${row.batchKey} ${row.status}`);
  }
  process.exitCode = blocked ? 10 : 0;
} catch (error) {
  console.error('RESULT: BLOCKED_AUDIT_ERROR');
  console.error(error?.stack || error);
  process.exitCode = 20;
} finally {
  db.close();
}
const after = fs.statSync(dbFile);
console.log('READ-ONLY CONFIRMED');
console.log(`DATABASE MODIFIED: ${before.size === after.size && before.mtimeMs === after.mtimeMs ? 'NO' : 'YES'}`);
