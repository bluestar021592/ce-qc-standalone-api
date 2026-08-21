import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('QC Next ALL export creates management plus seven independent business sheets including WHPP',{timeout:30000},async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-next-export-'));
  process.env.CE_QC_NEXT_DATA_DIR=temp;
  process.env.CE_QC_LEGACY_DB_FILE=path.join(temp,'missing.db');
  const file=path.join(temp,'日报_2026-08-21.xlsx');
  const rows=[['运单号','收件人','客户名称','区域','日报日期'],['CC100001','普通客户','','金边','2026-08-21'],['CE100001','普通客户','','外省','2026-08-21'],['TBKH100001','普通客户','','外省','2026-08-21'],['CCAF100001','普通客户','CCAF','金边','2026-08-21'],['CC100002','SHOPEECN','','金边','2026-08-21'],['CC100003','SHOPEEVN','','外省','2026-08-21'],['CC100004','ALI1688','','外省','2026-08-21']];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'日报');XLSX.writeFile(wb,file);
  const {importDaily}=await import('../store.js');const {startExport,exportStatus,exportFile}=await import('../exporter.js');const {closeNextDbs}=await import('../db.js');
  try{
    importDaily(file,{originalName:path.basename(file)});
    const job=startExport({reportDate:'2026-08-21',businessType:'ALL'});
    let state=null;for(let i=0;i<100;i++){state=exportStatus(job.jobId);if(['COMPLETED','FAILED'].includes(state?.status))break;await sleep(50);}
    assert.equal(state?.status,'COMPLETED',state?.errorMessage||'');
    const output=exportFile(job.jobId);assert.ok(output&&fs.existsSync(output));
    const out=XLSX.readFile(output);const expected=['管理汇总','CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
    for(const name of expected)assert.ok(out.SheetNames.includes(name),name);
    const summary=XLSX.utils.sheet_to_json(out.Sheets['管理汇总'],{defval:''});assert.equal(summary.length,7);assert.equal(summary.find(r=>r['业务板块']==='WHPP')?.['总票数'],1);
  }finally{closeNextDbs();fs.rmSync(temp,{recursive:true,force:true});}
});
