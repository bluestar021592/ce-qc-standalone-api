import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import XLSX from 'xlsx';

import '../src/v73CeafSourceMarkerPatch.js';
import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

test('CCAF source marker keeps 80 air parcels in CEAF instead of WHPP fallback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v73-ceaf-'));
  const file = path.join(dir, '日报表_2026-08-01.xlsx');
  try {
    const rows = [
      ['日报表'],
      ['运单编号', '收件人', '业务客户标识', '省份标识']
    ];

    for (let index = 1; index <= 80; index += 1) {
      rows.push([`CEAIR${String(index).padStart(4, '0')}`, `AIR-${index}`, 'CCAF', 'PP']);
    }
    for (let index = 1; index <= 196; index += 1) {
      rows.push([`CELOCAL${String(index).padStart(4, '0')}`, `LOCAL-${index}`, 'CCSL', 'PP']);
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'sheet');
    XLSX.writeFile(workbook, file);

    const parsed = parseUnifiedDailyExcel(file, { reportDate: '2026-08-01' });

    assert.equal(parsed.summary.validUniqueWaybills, 276);
    assert.equal(parsed.classificationCounts.CEAF, 80);
    assert.equal(parsed.classificationCounts.WHPP, 196);
    assert.equal(parsed.classificationCounts.CE, 0);
    assert.equal(parsed.sourceReconciliation.classifiedWaybills, 276);
    assert.equal(parsed.sourceReconciliation.balanced, true);

    const air = parsed.rows.find(row => row.shipmentCode === 'CEAIR0001');
    const local = parsed.rows.find(row => row.shipmentCode === 'CELOCAL0001');
    assert.equal(air?.businessType, 'CEAF');
    assert.equal(air?.customerNameNormalized, 'CCAF');
    assert.equal(air?.classificationMatchedValue, 'CCAF');
    assert.equal(local?.businessType, 'WHPP');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('V73 source marker patch is loaded before server bootstrap', () => {
  const bootstrap = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
  assert.match(bootstrap, /v73CeafSourceMarkerPatch/);
  assert.ok(bootstrap.indexOf('v73CeafSourceMarkerPatch') < bootstrap.indexOf("importPhase('server'"));
});
