import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';

test('QC Next imports one exact row into each of seven businesses and keeps WHPP first-class',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-next-import-'));
  process.env.CE_QC_NEXT_DATA_DIR=temp;
  process.env.CE_QC_LEGACY_DB_FILE=path.join(temp,'missing-legacy.db');
  const file=path.join(temp,'日报_2026-08-21.xlsx');
  const rows=[
    ['运单号','收件人','客户名称','区域','日报日期'],
    ['CC100001','普通客户','','金边','2026-08-21'],
    ['CE100001','普通客户','','外省','2026-08-21'],
    ['TBKH100001','普通客户','','外省','2026-08-21'],
    ['CCAF100001','普通客户','CCAF','金边','2026-08-21'],
    ['CC100002','SHOPEECN','','金边','2026-08-21'],
    ['CC100003','SHOPEEVN','','外省','2026-08-21'],
    ['CC100004','ALI1688','','外省','2026-08-21']
  ];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'日报');XLSX.writeFile(wb,file);
  const {importDaily,boardSummary,BUSINESSES}=await import('../store.js');
  const {closeNextDbs}=await import('../db.js');
  try{
    const result=importDaily(file,{originalName:path.basename(file)});
    assert.equal(result.reportDate,'2026-08-21');
    assert.equal(result.total,7);
    for(const business of BUSINESSES)assert.equal(result.classificationCounts[business],1,business);
    const summary=boardSummary('2026-08-21');
    assert.equal(summary.hasData,true);
    assert.equal(summary.boards.WHPP.total,1);
    assert.equal(summary.boards.CE.total,1);
    assert.equal(Object.values(summary.boards).reduce((sum,row)=>sum+row.total,0),7);
  }finally{closeNextDbs();fs.rmSync(temp,{recursive:true,force:true});}
});
