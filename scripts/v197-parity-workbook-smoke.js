import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v197-'));
const file=path.join(dir,'v197-parity-smoke.xlsx');
try{
  const wb=new ExcelJS.stream.xlsx.WorkbookWriter({filename:file,useStyles:true,useSharedStrings:false});
  const dashboard=wb.addWorksheet('每日看板',{views:[{state:'frozen',ySplit:9,xSplit:1}]});
  dashboard.columns=Array.from({length:16},()=>({width:14}));
  dashboard.mergeCells('A1:P1');dashboard.getCell('A1').value='V197 一比一看板回归测试';
  dashboard.mergeCells('A3:B3');dashboard.mergeCells('A4:B4');dashboard.mergeCells('A5:B5');
  dashboard.getCell('A3').value='1派POD';dashboard.getCell('A4').value={text:'1',hyperlink:"#'1派明细'!A2"};dashboard.getCell('A5').value='100.00% / POD';
  const headers=['日期','总票数','金边','外省','POD','POD率','1派POD','1派占POD','2派POD','2派占POD','3派+POD','3派+占POD','总平均天数','金边平均天数','外省平均天数','未POD'];
  headers.forEach((h,i)=>dashboard.getRow(9).getCell(i+1).value=h);
  const row=dashboard.getRow(10);row.values=['2026-08-18',3,1,2,3,1,1,1/3,1,1/3,1,1/3,2,1,2.5,0];
  for(const c of[6,8,10,12])row.getCell(c).numFmt='0.00%';
  dashboard.commit();

  const detail=wb.addWorksheet('1派明细',{views:[{state:'frozen',ySplit:1}]});
  detail.columns=[{header:'首次日报日期',width:14},{header:'运单编号',width:24},{header:'签收天数',width:10},{header:'派次',width:10},{header:'派次证据',width:28}];
  detail.autoFilter={from:'A1',to:'E1'};
  detail.addRow(['2026-08-18','SMOKE001',1,'1派','2026-08-18→2026-08-18=1天']).commit();
  detail.commit();
  await wb.commit();

  assert.ok(fs.existsSync(file) && fs.statSync(file).size>0,'streaming workbook not created');
  const read=new ExcelJS.Workbook();await read.xlsx.readFile(file);
  assert.deepEqual(read.worksheets.map(s=>s.name),['每日看板','1派明细']);
  assert.equal(read.getWorksheet('每日看板').getCell('A4').value.text,'1');
  assert.equal(read.getWorksheet('每日看板').getCell('A4').value.hyperlink,"#'1派明细'!A2");
  assert.equal(read.getWorksheet('1派明细').getCell('D2').value,'1派');
  assert.equal(read.getWorksheet('1派明细').getCell('E2').value,'2026-08-18→2026-08-18=1天');
  console.log('[V197] streaming parity workbook + future-sheet hyperlink smoke passed');
} finally {
  try{fs.rmSync(dir,{recursive:true,force:true});}catch{}
}
