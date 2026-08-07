import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createShopeeTemplateWorkbook } from '../src/shopeeTemplateExporter.js';

const EXPECTED = ['看板首页', '每日汇总', '全部明细', '金边明细', '外省明细', '门店明细', 'POD明细', '未POD明细', '分配派送中明细', 'Pending明细', '退回明细'];

test('SHOPEE daily weekly and monthly exports copy the locked 11-sheet master', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shopee-master-'));
  const snapshots = [
    { snapshotId: 's1', reportDate: '2026-08-01', payload: { finalRows: [{ shipmentCode: 'SPE1', businessType: 'SHOPEECN', regionCode: 'PP', currentState: 'POD', orderStatus: 85 }] } },
    { snapshotId: 's2', reportDate: '2026-08-02', payload: { finalRows: [{ shipmentCode: 'SPE2', businessType: 'SHOPEECN', regionCode: 'PV', currentState: 'RETURN_COMPLETED', pendingUniqueDayCount: 2 }] } }
  ];
  for (const periodType of ['daily', 'weekly', 'monthly']) {
    const result = await createShopeeTemplateWorkbook({ type: 'SHOPEECN', periodType, range: { from: '2026-08-01', to: '2026-08-02' }, snapshots, outputDir });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.file);
    assert.deepEqual(workbook.worksheets.slice(0, 11).map(sheet => sheet.name), EXPECTED);
    assert.equal(workbook.worksheets[0].getCell('A5').value.result, 2);
    assert.equal(workbook.worksheets[0].getCell('O5').value.result, 1);
    let brokenLinks = 0;
    workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => {
      if (cell.value?.formula?.includes('R退回明细')) brokenLinks += 1;
    })));
    assert.equal(brokenLinks, 0);
    assert.match(workbook.getWorksheet('退回明细').getCell('O1').value.formula, /看板首页/);
  }
});

