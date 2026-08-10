import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import XLSX from 'xlsx';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-ceaf-routing-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'ceaf-routing.db');

const { closeDb } = await import('../src/db.js');
const { parseUnifiedDailyExcel } = await import('../src/unifiedExcelParser.js');
const { saveUnifiedImport } = await import('../src/unifiedImportStore.js');
const {
  loadLightweightUnifiedBusinessState,
  loadLightweightAggregateState
} = await import('../src/lightweightDashboardStore.js');

function writeFixture() {
  const file = path.join(tempRoot, '日报表_2026-08-09.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['日报表'],
    ['运单编号', '收件人', '客户名称', '省份标识'],
    ['CC0001', 'CE10001', 'CCSL', 'PP'],
    ['AIR0001', 'CE10002', 'CCAF', 'PP'],
    ['TBKH0001', 'CE10003', 'CCSL', 'PV'],
    ['ALI0001', 'ALI1688', 'CCSL', 'PP'],
    ['CN0001', 'SHOPEECN', 'Shopee', 'PP'],
    ['VN0001', 'SHOPEEVN', 'Shopee', 'PV']
  ]), 'sheet');
  XLSX.writeFile(workbook, file);
  return file;
}

test('CEAF is independently readable while included in the CCSL processing/dashboard scope', () => {
  const parsed = parseUnifiedDailyExcel(writeFixture(), { reportDate: '2026-08-09' });
  const saved = saveUnifiedImport(parsed, '日报表_2026-08-09.xlsx');

  const ceaf = loadLightweightUnifiedBusinessState('CEAF', saved.snapshotId, { includeHistory: false });
  assert.equal(ceaf.businessType, 'CEAF');
  assert.deepEqual(ceaf.pnhBills, ['AIR0001']);
  assert.equal(ceaf.dailyParseSummary.totalRecognized, 1);

  const ccsl = loadLightweightAggregateState('CCSL', saved.snapshotId);
  assert.equal(ccsl.dailyParseSummary.totalRecognized, 4, 'CCSL scope contains CE + CEAF + TBKH + ALI1688');
  assert.deepEqual(new Set(ccsl.pnhBills), new Set(['CC0001', 'AIR0001', 'TBKH0001', 'ALI0001']));
});

test('server unified import explicitly routes CEAF through the generic CCSL run pool', () => {
  const source = fs.readFileSync(path.resolve('server.js'), 'utf8');
  assert.match(source, /const ccslRows = parsed\.rows\.filter\(row => \['CE', 'CEAF', 'TBKH', 'ALI1688'\]\.includes\(row\.businessType\)\);/);
  assert.match(source, /const historicalCcsl = processingQueue\.rows\.filter\(row => row\.sourceType === 'HISTORICAL_CARRY' && \['CE', 'CEAF', 'TBKH', 'ALI1688'\]\.includes\(row\.businessType\)\);/);
  assert.match(source, /\['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'\]/);
});

test.after(() => {
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
