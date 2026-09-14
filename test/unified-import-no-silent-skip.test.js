import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import XLSX from 'xlsx';

import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

function withWorkbook(name, build, run) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-no-silent-skip-'));
  const file=path.join(dir,name);
  try {
    const workbook=XLSX.utils.book_new();
    build(workbook);
    XLSX.writeFile(workbook,file);
    return run(file);
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
}

test('visible sheet with shipment-like rows but unrecognized waybill header fails closed instead of losing tickets',()=>{
  withWorkbook('日报表_2026-09-13.xlsx',workbook=>{
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
      ['运单编号','收件人','客户名称','省份标识'],
      ['CC1000001','CE10001','CCSL','PP']
    ]),'正常数据');
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
      ['包裹ID','收件标识','备注'],
      ['CE9999001','','应属于WHPP'],
      ['CC9999002','','应属于CE']
    ]),'漏票风险');
  },file=>{
    assert.throws(
      ()=>parseUnifiedDailyExcel(file,{reportDate:'2026-09-13'}),
      error=>error?.code==='UNRECOGNIZED_WAYBILL_SHEET'
        && error?.sheetName==='漏票风险'
        && Number(error?.suspectedCount||0)>=2
        && Array.isArray(error?.suspectedWaybills)
        && error.suspectedWaybills.includes('CE9999001')
        && error.suspectedWaybills.includes('CC9999002')
    );
  });
});

test('plain notes sheet without shipment evidence remains safely skippable',()=>{
  withWorkbook('日报表_2026-09-13.xlsx',workbook=>{
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
      ['运单编号','收件人','客户名称','省份标识'],
      ['CC1000001','CE10001','CCSL','PP'],
      ['CE1000002','','CCSL','PV']
    ]),'正常数据');
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
      ['说明'],['本页仅用于日报备注'],['负责人：QC']
    ]),'说明');
  },file=>{
    const parsed=parseUnifiedDailyExcel(file,{reportDate:'2026-09-13'});
    assert.equal(parsed.summary.validUniqueWaybills,2);
    assert.equal(parsed.classificationCounts.CE,1);
    assert.equal(parsed.classificationCounts.WHPP,1);
    assert.equal(parsed.sourceReconciliation.balanced,true);
    assert.equal(parsed.sheetDiagnostics.find(item=>item.sheetName==='说明')?.status,'SKIPPED');
  });
});

test('waybill header after row 30 is still discovered and its tickets are classified',()=>{
  withWorkbook('日报表_2026-09-13.xlsx',workbook=>{
    const rows=Array.from({length:35},(_,index)=>[`报表前置说明 ${index+1}`]);
    rows.push(['运单编号','收件人','客户名称','省份标识']);
    rows.push(['CC2000001','','CCSL','PP']);
    rows.push(['CE2000002','','CCSL','PV']);
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'长表头');
  },file=>{
    const parsed=parseUnifiedDailyExcel(file,{reportDate:'2026-09-13'});
    assert.equal(parsed.summary.validUniqueWaybills,2);
    assert.equal(parsed.classificationCounts.CE,1);
    assert.equal(parsed.classificationCounts.WHPP,1);
    assert.equal(parsed.sheetDiagnostics.find(item=>item.sheetName==='长表头')?.headerRow,36);
  });
});
