import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';

process.env.NODE_ENV = 'test';
const {
  readV273SourceWaybillCensus,
  compareV273ParsedToCensus,
  compareV273Membership
} = await import('../src/v273ImportCompletenessGuard.js');
const {
  parseUnifiedDailyExcel,
  getUnifiedEffectiveSheetRange
} = await import('../src/unifiedExcelParser.js');

const file = path.join(os.tmpdir(), `ce-qc-v294-zero-loss-${process.pid}-${Date.now()}.xlsx`);
const bloatedFile = path.join(os.tmpdir(), `ce-qc-v294-bloated-range-${process.pid}-${Date.now()}.xlsx`);
try {
  const ws = XLSX.utils.aoa_to_sheet([
    ['运单号', '备注'],
    ['CC1234567890', 'CE1234567890'],
    ['SPE1234567890', '普通备注']
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '日报');
  XLSX.writeFile(wb, file);

  const census = readV273SourceWaybillCensus(file);
  assert.equal(census.count, 2, 'only the bound shipment column is authoritative');
  assert.equal(census.diagnosticCount, 3, 'off-column waybill-like text remains diagnostic');
  assert.equal(census.ignoredOffColumnCount, 1);

  const missingOne = compareV273ParsedToCensus(['CC1234567890'], census.bills, census.locations);
  assert.equal(missingOne.ok, false, 'one missing source shipment must fail closed');
  assert.equal(missingOne.missingCount, 1);
  assert.deepEqual(missingOne.missingBills, ['SPE1234567890']);

  const exact = compareV273ParsedToCensus(['CC1234567890', 'SPE1234567890'], census.bills, census.locations);
  assert.equal(exact.ok, true);
  assert.equal(exact.missingCount, 0);

  const replacedMember = compareV273Membership(['CC1234567890', 'SPE9999999999'], ['CC1234567890', 'SPE1234567890']);
  assert.equal(replacedMember.ok, false, 'same/higher count cannot replace an old member silently');
  assert.equal(replacedMember.missingPreviousCount, 1);

  const rangeOnlySheet = XLSX.utils.aoa_to_sheet([
    ['标题'],
    ['运单编号', '下单时间', '收件人', '省份标识', '客户名称'],
    ['CC260810000001', '2026-08-10', '', 'PP1', '']
  ]);
  rangeOnlySheet['!ref'] = 'A1:XFD1048576';
  assert.equal(
    XLSX.utils.encode_range(getUnifiedEffectiveSheetRange(rangeOnlySheet)),
    'A1:E3',
    'inflated worksheet metadata must clamp to populated cells before materialization'
  );

  const bloatedSheet = XLSX.utils.aoa_to_sheet([
    ['2026-08-10 综合日报'],
    ['运单编号', '下单时间', '收件人', '省份标识', '客户名称'],
    ['CC260810000001', '2026-08-10', '', 'PP1', ''],
    ['CE260810000002', '2026-08-10', '', 'PV1', ''],
    ['TBKH000000001', '2026-08-10', '', 'PP', ''],
    ['SPE260810000001', '2026-08-10', 'ShopeeCN', 'PV', ''],
    ['SPE260810000002', '2026-08-10', 'ShopeeVN', 'PV', ''],
    ['CC260810000003', '2026-08-10', '', 'PP', 'CCAF Customer'],
    ['CC260810000004', '2026-08-10', 'ALI1688', 'PV', '']
  ]);
  bloatedSheet['!ref'] = 'A1:AZ5000';
  const bloatedBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(bloatedBook, bloatedSheet, '日报');
  XLSX.writeFile(bloatedBook, bloatedFile);

  const parseStartedAt = Date.now();
  const parsed = parseUnifiedDailyExcel(bloatedFile, { reportDate: '2026-08-10', originalName: '8-10.xls' });
  const parseElapsedMs = Date.now() - parseStartedAt;
  assert.equal(parsed.summary.validUniqueWaybills, 7);
  assert.equal(parsed.sourceReconciliation.balanced, true);
  for (const type of ['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN', 'WHPP']) {
    assert.equal(parsed.classificationCounts[type], 1, `${type} classification must survive range clamp`);
  }
  assert.equal(parsed.sheetDiagnostics[0]?.rangeClamped, true);
  assert.equal(parsed.sheetDiagnostics[0]?.effectiveRange, 'A1:E9');
  assert.ok(parseElapsedMs < 5000, `inflated worksheet range must parse quickly, got ${parseElapsedMs}ms`);

  const reuseStartedAt = Date.now();
  const reused = parseUnifiedDailyExcel(bloatedFile, { reportDate: '2026-08-10', originalName: '8-10.xls' });
  const reuseElapsedMs = Date.now() - reuseStartedAt;
  assert.equal(reused, parsed, 'guard parse and real import parse must reuse the exact same parsed object once');
  assert.ok(reuseElapsedMs < 1000, `second parse of the same upload must be a cache reuse, got ${reuseElapsedMs}ms`);

  const source = fs.readFileSync(new URL('../src/v273ImportCompletenessGuard.js', import.meta.url), 'utf8');
  assert.match(source, /V273_SOURCE_WAYBILL_CENSUS_MISMATCH/);
  assert.match(source, /V273_SAME_DATE_MEMBERSHIP_LOSS_BLOCKED/);
  assert.match(source, /已阻止入库，禁止静默漏单/);
  assert.match(source, /withSparseSheetToJson\(\(\)\s*=>\s*parseUnifiedDailyExcel/, 'zero-loss guard must keep its independent sparse safety net');

  const parserSource = fs.readFileSync(new URL('../src/unifiedExcelParser.js', import.meta.url), 'utf8');
  assert.match(parserSource, /getUnifiedEffectiveSheetRange\(sheet\)/, 'live parser must derive the populated range');
  assert.match(parserSource, /sheet_to_json\(sheet,\s*\{[^}]*range:\s*effectiveRangeObject/, 'live parser must materialize only the effective range');
  assert.match(parserSource, /parse_cache_hit/, 'live parser must reuse the guarded parse for the real write stage');
  assert.match(parserSource, /\[CE-QC\]\[UNIFIED_IMPORT_STAGE\].*sheet_matrix/, 'live parser must expose import-stage timing diagnostics');

  const storeSource = fs.readFileSync(new URL('../src/unifiedImportStore.js', import.meta.url), 'utf8');
  assert.match(storeSource, /\[CE-QC\]\[UNIFIED_IMPORT_STAGE\]\s*sqlite_write/, 'SQLite write stage must be timed');
  assert.match(storeSource, /\[CE-QC\]\[UNIFIED_IMPORT_STAGE\]\s*carryover_queue/, 'carryover queue stage must be timed');
  assert.match(storeSource, /COALESCE\(SUM\(CASE WHEN status='OPEN' AND sourceReportDate=\? THEN 1 ELSE 0 END\),0\) todayOpen/, 'carryover summary must aggregate in one SQL scan');
  assert.doesNotMatch(storeSource, /const one = \(sql, \.\.\.params\)/, 'carryover summary must not regress to four repeated count queries');

  console.log(`[V294] zero-loss import smoke passed · inflated UsedRange clamped · duplicate parse reused · seven-business classification unchanged · parse=${parseElapsedMs}ms reuse=${reuseElapsedMs}ms`);
} finally {
  try { fs.rmSync(file, { force: true }); } catch {}
  try { fs.rmSync(bloatedFile, { force: true }); } catch {}
}
