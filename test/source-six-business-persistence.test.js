import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import XLSX from 'xlsx';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-seven-persist-'));
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
    ['CC0001', 'CE10001', 'CCSL', 'PP'],
    ['AIR0001', 'CE10002', 'CCAF', 'PP'],
    ['TBKH0001', 'CE10003', 'CCSL', 'PV'],
    ['CC0004', 'ALI1688', 'CCSL', 'PP'],
    ['CC0005', 'SHOPEECN', 'Shopee', 'PP'],
    ['CC0006', 'SHOPEEVN', 'Shopee', 'PV'],
    ['CE0007', '', 'CCSL', 'PV']
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'sheet');
  XLSX.writeFile(workbook, file);
  return file;
}

test('seven-business source membership survives database persistence', () => {
  const parsed = parseUnifiedDailyExcel(writeFixture(), { reportDate: '2026-08-09' });
  const saved = saveUnifiedImport(parsed, '日报表_2026-08-09.xlsx');

  assert.deepEqual(saved.classificationCounts, {
    CE: 1,
    CEAF: 1,
    TBKH: 1,
    ALI1688: 1,
    SHOPEECN: 1,
    SHOPEEVN: 1,
    WHPP: 1
  });
  assert.equal(saved.sourceReconciliation.balanced, true);
  assert.equal(saved.sourceReconciliation.validUniqueWaybills, 7);

  const latest = getLatestUnifiedImport();
  assert.deepEqual(latest.classificationCounts, saved.classificationCounts);
  assert.equal(latest.sourceReconciliation.classifiedWaybills, 7);
  assert.equal(latest.sourceReconciliation.difference, 0);
  assert.equal(latest.sourceReconciliation.balanced, true);

  const stored = getDb().prepare('SELECT businessType,shipmentCode FROM unified_import_rows WHERE snapshotId=? ORDER BY businessType,shipmentCode').all(saved.snapshotId);
  assert.equal(stored.length, 7);
  assert.deepEqual(stored.map(row => row.businessType).sort(), ['ALI1688', 'CE', 'CEAF', 'SHOPEECN', 'SHOPEEVN', 'TBKH', 'WHPP']);

  const queue = getUnifiedProcessingQueue(saved.batchId);
  assert.equal(queue.rows.length, 7);
  assert.equal(queue.rows.find(row => row.shipmentCode === 'AIR0001')?.businessType, 'CEAF');
  assert.equal(queue.rows.find(row => row.shipmentCode === 'CE0007')?.businessType, 'WHPP');

  const ceaf = loadUnifiedBusinessState('CEAF', saved.snapshotId);
  assert.equal(ceaf.businessType, 'CEAF');
  assert.deepEqual(ceaf.pnhBills, ['AIR0001']);
  assert.equal(ceaf.dailyParseRows[0]?.customerNameNormalized, 'CCAF');
});

test('persistence refuses an unbalanced seven-business source object before any write', () => {
  assert.throws(
    () => saveUnifiedImport({
      reportDate: '2026-08-10',
      fileHash: 'broken',
      classificationCounts: { CE: 1, CEAF: 0, TBKH: 0, ALI1688: 0, SHOPEECN: 0, SHOPEEVN: 0, WHPP: 0 },
      sourceReconciliation: {
        businessTypes: ['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN', 'WHPP'],
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
