import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {createShopeeTemplateWorkbook} from '../src/shopeeTemplateExporter.js';

// Actual Excel workbook generation/readback. Assert export members rather
// than relying solely on a source-array length or SQL row-count estimate.
const types=['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'];
const day1=types.map((businessType,i)=>({
  businessType,reportDate:'2026-07-01',shipmentCode:'V788EXPORT'+String(i+1).padStart(5,'0'),
  isPod:1,是否POD:'是',currentState:'POD',regionCode:i%2===0?'PP':'PV',
  signingDays:2,podDate:'2026-07-02'
}));
const day2=[
  {...day1[0],reportDate:'2026-07-02',isPod:0,是否POD:'否',currentState:'PENDING_SCAN',podDate:'',signingDays:null},
  {...day1[6],reportDate:'2026-07-02',podDate:'2026-07-03',signingDays:2}
];
const snapshots=[
  {snapshotId:'S-2026-07-01',reportDate:'2026-07-01',payload:{finalRows:day1}},
  {snapshotId:'S-2026-07-02',reportDate:'2026-07-02',payload:{finalRows:day2}}
];
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'v788-excel-members-'));
const range={from:'2026-07-01',to:'2026-07-02'};
function getSheetBills(workbook,name){
  const sheet=workbook.getWorksheet(name);
  assert.ok(sheet,'missing '+name);
  const rows=[];
  for(let i=2;i<=sheet.rowCount;i++){
    const day=String(sheet.getRow(i).getCell(1).value||'');
    const value=sheet.getRow(i).getCell(2).value;
    const bill=typeof value==='object'?String(value?.text||value?.result||''):String(value||'');
    if(day&&bill)rows.push({date:day,bill});
  }
  return rows;
}
try{
  const out=await createShopeeTemplateWorkbook({
    type:'ALL',periodType:'custom',range,snapshots,outputDir:temp
  });
  assert.equal(out.audit.rows,9,'seven groups on first day plus two repeated-source members on second day');
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.readFile(out.file);
  const all=getSheetBills(workbook,'全部明细');
  assert.equal(all.length,9,'actual generated Excel must preserve 9 date-scoped members');
  assert.equal(all.filter(x=>x.date==='2026-07-01').length,7);
  assert.equal(all.filter(x=>x.date==='2026-07-02').length,2);
  const firstBill=day1[0].shipmentCode;
  assert.equal(all.filter(x=>x.bill===firstBill).length,2,
    'same CE shipment in two source dates must remain two Excel detail rows');
  const pod=getSheetBills(workbook,'POD明细');
  assert.equal(pod.length,8,'POD detail must retain all seven first-day and one second-day completed member');
  assert.equal(getSheetBills(workbook,'退回明细').length,0);
  const ce=await createShopeeTemplateWorkbook({
    type:'CE',periodType:'custom',range,snapshots,outputDir:temp
  });
  const ceBook=new ExcelJS.Workbook();
  await ceBook.xlsx.readFile(ce.file);
  assert.equal(getSheetBills(ceBook,'全部明细').length,2,
    'per-business export must preserve selected daily source ownership');
  assert.equal(getSheetBills(ceBook,'POD明细').length,1);
  const collision=[
    {...day1[0]},
    {...day1[0],businessType:'SHOPEECN'}
  ];
  await assert.rejects(
    ()=>createShopeeTemplateWorkbook({
      type:'ALL',periodType:'daily',
      range:{from:'2026-07-01',to:'2026-07-01'},
      snapshots:[{snapshotId:'COLLISION',reportDate:'2026-07-01',payload:{finalRows:collision}}],
      outputDir:temp
    }),
    /七业务导出冲突/,
    'same-day cross-business duplicate must fail instead of silently discarding a shipment'
  );
  console.log('[V788 XLSX] seven businesses, 2 daily sources, same bill across dates and conflicting owner fail-closed PASS');
}finally{await fs.rm(temp,{recursive:true,force:true});}
