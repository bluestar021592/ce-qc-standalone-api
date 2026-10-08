import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createShopeeTemplateWorkbook } from '../src/shopeeTemplateExporter.js';

// V650 is the approved active master: 1 daily dashboard + 9 detail sheets.
const EXPECTED = ['每日看板', '全部明细', '金边明细', '外省明细', '门店明细', 'POD明细', '未POD明细', '分配派送中明细', 'Pending明细', '退回明细'];

test('SHOPEE daily weekly and monthly exports preserve the active locked 10-sheet master', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shopee-master-'));
  const snapshots = [
    { snapshotId: 's1', reportDate: '2026-08-01', payload: { finalRows: [{ shipmentCode: 'SPE1', businessType: 'SHOPEECN', regionCode: 'PP', currentState: 'POD', orderStatus: 85 }] } },
    { snapshotId: 's2', reportDate: '2026-08-02', payload: { finalRows: [{ shipmentCode: 'SPE2', businessType: 'SHOPEECN', regionCode: 'PV', currentState: 'RETURN_COMPLETED', pendingUniqueDayCount: 2 }] } }
  ];
  for (const periodType of ['daily', 'weekly', 'monthly']) {
    const result = await createShopeeTemplateWorkbook({ type: 'SHOPEECN', periodType, range: { from: '2026-08-01', to: '2026-08-02' }, snapshots, outputDir });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.file);
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), EXPECTED);
    assert.deepEqual(result.audit.sheetNames, EXPECTED, 'export audit must match actual worksheet order');
    const dashboard=workbook.getWorksheet('每日看板');
    assert.equal(dashboard.getCell('A5').value.result, 2, 'all source shipments must remain counted');
    const returnLinks=[];
    dashboard.getRow(5).eachCell(cell=>{
      if (typeof cell.value?.formula === 'string' && cell.value.formula.includes('退回明细!A1')) {
        returnLinks.push(cell.value);
      }
    });
    assert.ok(returnLinks.length>0, 'returned dashboard card must link to the correct detail sheet');
    assert.ok(returnLinks.some(link=>Number(link.result)===1), 'returned detail link must display the actual one returned waybill');
    assert.equal(workbook.getWorksheet('退回明细').getCell('B2').value.text, 'SPE2', 'returned waybill must appear with clickable detail link');
    assert.match(workbook.getWorksheet('退回明细').getCell('B2').value.hyperlink, /shipmentCode=SPE2/);
    assert.equal(workbook.getWorksheet('全部明细').getCell('B3').value.text, 'SPE2', 'complete ledger must link second day member');
    assert.equal(dashboard.getCell('A11').value, '2026-08-01', 'daily trend must preserve first source date');
    assert.equal(dashboard.getCell('A12').value, '2026-08-02', 'daily trend must preserve second source date');
    let brokenLinks = 0;
    workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => {
      if (cell.value?.formula?.includes('R退回明细')) brokenLinks += 1;
    })));
    assert.equal(brokenLinks, 0, 'broken return hyperlinks must be repaired');
  }
});

