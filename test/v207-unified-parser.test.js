import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';
import { __test as safetyTest } from '../src/v102UnifiedImportSafetyGatePatch.js';

function workbookFile(sheets){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v207-parser-'));
  const file=path.join(dir,'daily.xlsx');
  const wb=XLSX.utils.book_new();
  for(const [name,rows] of Object.entries(sheets))XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);
  XLSX.writeFile(wb,file);
  return{file,dir};
}
function parse(sheets){const t=workbookFile(sheets);try{return parseUnifiedDailyExcel(t.file,{reportDate:'2026-08-16',originalName:'2026-08-16.xlsx'});}finally{fs.rmSync(t.dir,{recursive:true,force:true});}}

test('V207 accepts a waybill sheet without recipient header when prefix ownership is exact',()=>{
  const result=parse({Data:[['运单编号','收件省份'],['TBKH000803140','金边市'],['CE260816000001','西哈努克省']]});
  assert.equal(result.rows.length,2);
  assert.equal(result.rows.find(r=>r.shipmentCode==='TBKH000803140').businessType,'TBKH');
  assert.equal(result.rows.find(r=>r.shipmentCode==='CE260816000001').businessType,'WHPP');
});

test('V207 TBKH ownership accepts recipient rule even when waybill uses CC prefix',()=>{
  const result=parse({Data:[['运单编号','收件人','收件省份'],['CC260816000001','TBKH 客户','金边市']]});
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].businessType,'TBKH');
  assert.equal(result.rows[0].classificationSource,'RECIPIENT');
});

test('V207 merges same-business duplicate rows and counts one shipment',()=>{
  const result=parse({Data:[['运单编号','收件人','收件省份','备注'],['TBKH000803140','TBKH','金边市','A'],['TBKH000803140','TBKH','金边市','B']]});
  assert.equal(result.rows.length,1);
  assert.equal(result.summary.duplicateRows,1);
  assert.equal(result.summary.duplicateMergedRows,1);
  assert.deepEqual(result.rows[0].duplicateSourceRows,['Data:2','Data:3']);
});

test('V207 blocks one waybill being classified into two businesses',()=>{
  assert.throws(()=>parse({Data:[['运单编号','收件人','收件省份'],['CC260816000001','SHOPEECN','金边市'],['CC260816000001','SHOPEEVN','金边市']]}),error=>error?.code==='DUPLICATE_BUSINESS_CONFLICT');
});

test('V207 blocks a sheet that contains waybills but has no recognizable waybill header',()=>{
  assert.throws(()=>parse({Broken:[['编号X','说明'],['TBKH000803140','some row']]}),error=>error?.code==='UNRECOGNIZED_WAYBILL_SHEET');
});

test('V207 does not block a pure summary sheet with no waybill-like data',()=>{
  const result=parse({Summary:[['指标','数值'],['总量','10']],Data:[['运单编号','收件人','收件省份'],['TBKH000803140','TBKH','金边市']]});
  assert.equal(result.rows.length,1);
  assert.ok(result.sheetDiagnostics.some(s=>s.sheetName==='Summary'&&s.status==='SKIPPED'));
});

test('V207 blocks Shopee when PP/PV region cannot be established',()=>{
  assert.throws(()=>parse({Data:[['运单编号','收件人'],['SPE260816000001','SHOPEECN']]}),error=>error?.code==='SHOPEE_REGION_MISSING');
});

test('V208 source-cell conservation blocks a shipment code parked outside the parsed waybill column',()=>{
  const t=workbookFile({Data:[['运单编号','收件人','收件省份','备注'],['TBKH000803140','TBKH','金边市',''],['','普通客户','金边市','CC260816999999']]});
  try{
    const parsed=parseUnifiedDailyExcel(t.file,{reportDate:'2026-08-16',originalName:'2026-08-16.xlsx'});
    assert.equal(parsed.rows.length,1);
    assert.throws(()=>safetyTest.assertSourceWaybillConservation(t.file,parsed),error=>error?.code==='SOURCE_WAYBILL_NOT_PRESERVED'&&error?.missingCount===1);
  }finally{fs.rmSync(t.dir,{recursive:true,force:true});}
});
