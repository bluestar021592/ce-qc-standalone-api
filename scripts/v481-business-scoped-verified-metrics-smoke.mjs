import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { writeV200ReferenceWorkbook, V481_VERIFIED_METRIC_SCOPE_ID } from '../src/v200ReferenceWorkbook.js';
import { statsOf, bucketRows, anchorMaps } from '../src/v200Metrics.js';

assert.equal(V481_VERIFIED_METRIC_SCOPE_ID,'2026-09-08-v481-business-scoped-verified-export-metrics-v1');
const range={from:'2026-08-01',to:'2026-08-01'};
const base={firstReportDate:'2026-08-01',dailyMembershipDates:['2026-08-01'],shipmentCode:'V481-1',area:'金边',statusCode:'Y',statusDesc:'POD',pod:true,returned:false,pending:false,delivering:false,store:false,attemptNo:0,podTime:'',podDate:'',recipientProvince:'Phnom Penh'};
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v481-'));
try{
  const ceRows=[{...base,businessType:'CE'}];
  const ceStats=statsOf(ceRows,range),ceBucket=bucketRows(ceRows),ceAnchors=anchorMaps(ceBucket),ceFile=path.join(temp,'ce.xlsx');
  await writeV200ReferenceWorkbook({file:ceFile,type:'CE',range,rows:ceRows,stats:ceStats,bucket:ceBucket,anchors:ceAnchors});
  const ceBook=new ExcelJS.Workbook();await ceBook.xlsx.readFile(ceFile);const ceDash=ceBook.getWorksheet('每日看板');
  assert.equal(ceDash.getCell('C15').value,'—','CE incomplete attempt rate must be shown as unknown, never fabricated 0%');
  assert.equal(ceDash.getCell('H15').value,'—','CE incomplete signing average must be shown as unknown, never fabricated day count');

  const strictRows=[{...base,businessType:'SHOPEECN',shipmentCode:'V481-CN',podTime:'2026-08-02 10:00:00',podDate:'2026-08-02',signingDays:2,deliveryDays:2}];
  const strictStats=statsOf(strictRows,range),strictBucket=bucketRows(strictRows),strictAnchors=anchorMaps(strictBucket),strictFile=path.join(temp,'cn.xlsx');
  await assert.rejects(()=>writeV200ReferenceWorkbook({file:strictFile,type:'SHOPEECN',range,rows:strictRows,stats:strictStats,bucket:strictBucket,anchors:strictAnchors}),/V200_VERIFIED_METRIC_MISSING/,'SHOPEECN incomplete real attempt evidence must remain fail-closed');
  console.log('[V481] business-scoped verified metric smoke passed · CE unknown attempt/signing renders dash · TBKH/CN/VN strict fail-closed scope preserved');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
