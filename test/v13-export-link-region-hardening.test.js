import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';

import { classifyShopeeRegion } from '../src/shopeeAnalyzer.js';
import { createShopeeTemplateWorkbook } from '../src/shopeeTemplateExporter.js';

test('V13 named non-Phnom-Penh province classifies as PV while blank province stays UNKNOWN', () => {
  assert.deepEqual(
    classifyShopeeRegion({ dailyRow: { raw: { 收件省份: 'Kandal' } } }),
    { regionType: 'PROVINCE', regionCode: 'PV', regionSource: 'destProvince' }
  );
  assert.deepEqual(
    classifyShopeeRegion({ dailyRow: { raw: { 收件省份: '' } } }),
    { regionType: 'UNKNOWN', regionCode: 'UNKNOWN', regionSource: 'unresolved' }
  );
});

test('V13 locked Shopee export does not count UNKNOWN as PV and waybill cells open scoped app detail', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-qc-v13-export-'));
  const oldBase = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:5177';
  try {
    const snapshots = [{
      snapshotId: 'v13-s1',
      reportDate: '2026-08-07',
      payload: { finalRows: [
        { shipmentCode: 'CNPP00000001', businessType: 'SHOPEECN', regionCode: 'PP', currentState: 'POD', orderStatus: 85 },
        { shipmentCode: 'CNPV00000001', businessType: 'SHOPEECN', regionCode: 'PV', currentState: 'DELIVERY' },
        { shipmentCode: 'CNUN00000001', businessType: 'SHOPEECN', regionCode: 'UNKNOWN', currentState: 'OPEN_TRACK_REQUIRED' }
      ] }
    }];
    const result = await createShopeeTemplateWorkbook({
      type: 'SHOPEECN', periodType: 'daily', range: { from: '2026-08-07', to: '2026-08-07' }, snapshots, outputDir
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.file);
    const dashboard = workbook.getWorksheet('看板首页');
    assert.equal(dashboard.getCell('A5').value.result, 3);
    assert.equal(dashboard.getCell('C5').value.result, 1);
    assert.equal(dashboard.getCell('E5').value.result, 1);

    const detail = workbook.getWorksheet('全部明细');
    const rows = [];
    detail.eachRow(row => {
      const value = row.getCell(2).value;
      if (value?.text) rows.push(row);
    });
    assert.equal(rows.length, 3);
    const pp = rows.find(row => row.getCell(2).value.text === 'CNPP00000001');
    const pv = rows.find(row => row.getCell(2).value.text === 'CNPV00000001');
    const unknown = rows.find(row => row.getCell(2).value.text === 'CNUN00000001');
    assert.equal(pp.getCell(8).value, '金边');
    assert.equal(pv.getCell(8).value, '外省');
    assert.equal(unknown.getCell(8).value, '未识别');
    assert.match(pp.getCell(2).value.hyperlink, /^http:\/\/127\.0\.0\.1:5177\/detail\?/);
    assert.match(pp.getCell(2).value.hyperlink, /shipmentCode=CNPP00000001/);
    assert.match(pp.getCell(2).value.hyperlink, /businessType=SHOPEECN/);
  } finally {
    if (oldBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldBase;
  }
});
