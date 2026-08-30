import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import XLSX from 'xlsx';
import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

const tempPath = path.join(os.tmpdir(), `ce-qc-v373-${crypto.randomUUID()}.xls`);
try {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['运单号', '日报日期', '收件人', '省份标识', '客户名称'],
    ['CC260816373001', '2026-08-16', 'GENERAL', 'PP', 'GENERAL'],
    ['CC260816373002', '2026-08-16', 'GENERAL', 'PP', 'CCAF'],
    ['TBKH260816373003', '2026-08-16', 'GENERAL', 'PV', 'GENERAL'],
    ['CC260816373004', '2026-08-16', 'ALI1688', 'PV', 'GENERAL'],
    ['CC260816373005', '2026-08-16', 'SHOPEECN', 'PP', 'GENERAL'],
    ['CC260816373006', '2026-08-16', 'SHOPEEVN', 'PV', 'GENERAL'],
    ['CE260816373007', '2026-08-16', 'GENERAL', 'PP', 'GENERAL']
  ]);

  // Reproduce legacy Excel metadata inflation while keeping only eight real rows.
  // The BIFF8 writer must persist a real OLE .xls container; the live parser must
  // ignore the inflated tail and materialize only populated cells.
  sheet['!ref'] = 'A1:AZ5000';
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '日报');
  XLSX.writeFile(book, tempPath, { bookType: 'biff8' });

  const signature = fs.readFileSync(tempPath).subarray(0, 8).toString('hex').toUpperCase();
  assert.ok(signature.startsWith('D0CF11E0'), `fixture must be a real OLE/BIFF8 .xls, signature=${signature}`);

  const startedAt = Date.now();
  const parsed = parseUnifiedDailyExcel(tempPath, {
    reportDate: '2026-08-16',
    originalName: '8-16.xls'
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(parsed.containerFormat, 'OLE_XLS', 'live parser must recognize the real BIFF8/OLE container');
  assert.equal(parsed.reportDate, '2026-08-16');
  assert.equal(parsed.summary?.validUniqueWaybills, 7);
  assert.equal(parsed.sourceReconciliation?.balanced, true);
  assert.equal(parsed.sourceReconciliation?.difference, 0);
  assert.deepEqual(parsed.classificationCounts, {
    CE: 1,
    CEAF: 1,
    TBKH: 1,
    ALI1688: 1,
    SHOPEECN: 1,
    SHOPEEVN: 1,
    WHPP: 1
  });
  assert.equal(parsed.sheetDiagnostics?.[0]?.rangeClamped, true, 'inflated BIFF8 UsedRange must be clamped');
  assert.equal(parsed.sheetDiagnostics?.[0]?.effectiveRange, 'A1:E8', 'only the populated BIFF8 cells may be materialized');
  assert.ok(elapsedMs < 5000, `real legacy .xls parse must fail-fast instead of freezing, elapsed=${elapsedMs}ms`);

  console.log(`[V373] real BIFF8 .xls import smoke passed · OLE signature ${signature.slice(0,8)} · inflated UsedRange clamped to A1:E8 · seven businesses exact · elapsed=${elapsedMs}ms`);
} finally {
  try { fs.rmSync(tempPath, { force: true }); } catch {}
}
