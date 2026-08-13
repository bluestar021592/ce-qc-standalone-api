import { getDb } from '../src/db.js';
import { loadStrictShopeeWhppRetentionRows } from '../src/shopeeWhppRetentionTruth.js';
import { inspectV90FastDashboard } from '../src/v90FastDashboardReadPatch.js';

const requestedDate = String(process.argv[2] || '').trim().slice(0, 10);
const db = getDb();
const batch = requestedDate
  ? db.prepare("SELECT batchId,snapshotId,reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC LIMIT 1").get(requestedDate)
  : db.prepare("SELECT batchId,snapshotId,reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get();

if (!batch?.snapshotId) {
  console.error('V94_AUDIT_RESULT: BLOCKED_NO_VALID_UNIFIED_BATCH');
  process.exit(10);
}

const strict = {};
for (const type of ['SHOPEECN','SHOPEEVN']) {
  strict[type] = loadStrictShopeeWhppRetentionRows({
    db,
    snapshotId: batch.snapshotId,
    reportDate: batch.reportDate,
    businessType: type
  });
}

const forbidden = [];
for (const [type, rows] of Object.entries(strict)) {
  for (const row of rows) {
    const code = String(row.latestEventCode || '').trim();
    const text = String(row.最后节点 || row.latestEventDesc || '');
    if (['80','84','86'].includes(code) || /退回|RETURN/i.test(text)) forbidden.push({ type, shipmentCode: row.shipmentCode, code, text });
  }
}

const rawCounts = Object.fromEntries(db.prepare(`
  SELECT businessType,COUNT(*) count
  FROM unified_import_rows
  WHERE snapshotId=?
  GROUP BY businessType
`).all(batch.snapshotId).map(row => [row.businessType, Number(row.count || 0)]));

const canonical = inspectV90FastDashboard(batch.reportDate);
const canonicalCounts = canonical?.counts || {};
const canonicalTotal = Number(canonical?.total || 0);
const countSum = Object.values(canonicalCounts).reduce((sum, value) => sum + Number(value || 0), 0);

console.log('CE QC V94 SHOPEE WHPP SOURCE TRUTH AUDIT - STRICT READ ONLY');
console.log(`reportDate=${batch.reportDate} snapshotId=${batch.snapshotId}`);
console.log(`SHOPEECN_WHPP_STRICT=${strict.SHOPEECN.length}`);
console.log(`SHOPEEVN_WHPP_STRICT=${strict.SHOPEEVN.length}`);
console.log(`FORBIDDEN_TERMINAL_OR_RETURN_IN_STRICT=${forbidden.length}`);
console.log(`RAW_CEAF=${Number(rawCounts.CEAF || 0)} RAW_WHPP=${Number(rawCounts.WHPP || 0)}`);
console.log(`CANONICAL_CEAF=${Number(canonicalCounts.CEAF || 0)} CANONICAL_WHPP=${Number(canonicalCounts.WHPP || 0)}`);
console.log(`CANONICAL_TOTAL=${canonicalTotal} CANONICAL_SUM=${countSum}`);
console.log(`CEAF_DISPLAY_CORRECTION=${Number(canonicalCounts.CEAF || 0) - Number(rawCounts.CEAF || 0)}`);

if (forbidden.length) {
  console.error('V94_AUDIT_RESULT: BLOCKED_FORBIDDEN_WHPP_ROWS');
  console.error(JSON.stringify(forbidden.slice(0, 10), null, 2));
  process.exit(11);
}
if (canonicalTotal !== countSum || canonicalTotal <= 0) {
  console.error('V94_AUDIT_RESULT: BLOCKED_CANONICAL_CLASSIFICATION_RECONCILIATION');
  process.exit(12);
}

console.log('V94_AUDIT_RESULT: READY');
