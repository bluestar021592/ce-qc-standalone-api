import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import XLSX from 'xlsx';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-six-persist-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'source-foundation.db');

const { parseUnifiedDailyExcel } = await import('../src/unifiedExcelParser.js');
const { closeDb, getDb } = await import('../src/db.js');
const {
  saveUnifiedImport,
  getLatestUnifiedImport,
  getUnifiedProcessingQueue,
  loadUnifiedBusinessState
} = await import('../src/unifiedImportStore.js');

function writeFixture() {
  const file = path.join(tempRoot, '日报表_2026-08-09.xlsx');
  const rows = [
    ['日报表'],
    ['运单编号', '收件人', '客户名称', '省份标识'],
    ['CE0001', 'CE10001', 'CCSL', 'PP'],
    ['AIR0001', 'CE10002', 'CCAF', 'PP'],
    ['TBKH0001', 'CE10003', 'CCSL', 'PV'],
    ['ALI0001', 'ALI1688', 'CCSL', 'PP'],
    ['CN0001', 'SHOPEECN', 'Shopee', 'PP'],
    ['VN0001', 'SHOPEEVN', 'Shopee', 'PV']
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'sheet');
  XLSX.writeFile(workbook, file);
  return file;
}

test('six-business source membership survives database persistence', () => {
  const parsed = parseUnifiedDailyExcel(writeFixture(), { reportDate: '2026-08-09' });
  const saved = saveUnifiedImport(parsed, '日报表_2026-08-09.xlsx');

  assert.deepEqual(saved.classificationCounts, {
    CE: 1,
    CEAF: 1,
    TBKH: 1,
    ALI1688: 1,
    SHOPEECN: 1,
    SHOPEEVN: 1
  });
  assert.equal(saved.sourceReconciliation.balanced, true);
  assert.equal(saved.sourceReconciliation.validUniqueWaybills, 6);

  const latest = getLatestUnifiedImport();
  assert.deepEqual(latest.classificationCounts, saved.classificationCounts);
  assert.equal(latest.sourceReconciliation.classifiedWaybills, 6);
  assert.equal(latest.sourceReconciliation.difference, 0);
  assert.equal(latest.sourceReconciliation.balanced, true);

  const stored = getDb().prepare('SELECT businessType,shipmentCode FROM unified_import_rows WHERE snapshotId=? ORDER BY businessType,shipmentCode').all(saved.snapshotId);
  assert.equal(stored.length, 6);
  assert.deepEqual(stored.map(row => row.businessType).sort(), ['ALI1688', 'CE', 'CEAF', 'SHOPEECN', 'SHOPEEVN', 'TBKH']);

  const queue = getUnifiedProcessingQueue(saved.batchId);
  assert.equal(queue.rows.length, 6);
  assert.equal(queue.rows.find(row => row.shipmentCode === 'AIR0001')?.businessType, 'CEAF');

  const ceaf = loadUnifiedBusinessState('CEAF', saved.snapshotId);
  assert.equal(ceaf.businessType, 'CEAF');
  assert.deepEqual(ceaf.pnhBills, ['AIR0001']);
  assert.equal(ceaf.dailyParseRows[0]?.customerNameNormalized, 'CCAF');
});

test('persistence refuses an unbalanced source object before any write', () => {
  assert.throws(
    () => saveUnifiedImport({
      reportDate: '2026-08-10',
      fileHash: 'broken',
      classificationCounts: { CE: 1, CEAF: 0, TBKH: 0, ALI1688: 0, SHOPEECN: 0, SHOPEEVN: 0 },
      sourceReconciliation: {
        businessTypes: ['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'],
        validUniqueWaybills: 2,
        classifiedWaybills: 1,
        difference: -1,
        balanced: false
      },
      summary: { validUniqueWaybills: 2 },
      rows: []
    }, 'broken.xlsx'),
    error => error?.code === 'SOURCE_CLASSIFICATION_RECONCILIATION_FAILED'
  );
});

test.after(() => {
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
