import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { writeV200ReferenceWorkbook } from '../src/v200ReferenceWorkbook.js';
import { statsOf, bucketRows, anchorMaps, completeSigningAverage } from '../src/v200Metrics.js';

function must(condition,message){if(!condition)throw new Error(message);}
const row={firstReportDate:'2026-08-01',dispatchStartDate:'2026-08-02',firstDispatchDate:'2026-08-02',shipmentCode:'TEST001',orderTime:'2026-08-01 08:00:00',statusCode:'Y',statusDesc:'POD',recipientProvince:'Phnom Penh',area:'金边',currentShop:'',currentProvince:'Phnom Penh',recipient:'测试',recipientPhone:'',recipientAddress:'',pod:true,podTime:'2026-08-03 10:00:00',podDate:'2026-08-03',rawDeliveryTime:'2026-08-03 10:00:00',deliveryShop:'',deliveryProvince:'',courier:'',exceptionCode:'',exceptionDesc:'',remark:'',store:false,returned:false,pending:false,delivering:false,attemptNo:1,signingDays:2,deliveryDays:2};
const rows=[row],range={from:'2026-08-01',to:'2026-08-01'};
const stats=statsOf(rows,range),bucket=bucketRows(rows),anchors=anchorMaps(bucket);
const file=path.join(os.tmpdir(),`ce-qc-v200-${process.pid}.xlsx`);
try{
  await writeV200ReferenceWorkbook({file,type:'SHOPEECN',range,rows,stats,bucket,anchors});
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(file);
  const names=wb.worksheets.map(s=>s.name);
  must(names.join('|')==='每日看板|全部明细|金边明细|外省明细|门店明细|POD明细|未POD明细|分配派送中明细|Pending明细|退回明细','V200 must keep exact 10-sheet reference structure');
  const dash=wb.getWorksheet('每日看板');
  must(Math.abs(Number(dash.getColumn(1).width||0)-13)<0.5 && Math.abs(Number(dash.getColumn(6).width||0)-3)<0.5,'reference dashboard column widths changed');
  must(String(dash.getCell('A1').value).includes('中国虾皮每日数据看板'),'reference title missing');
  must(String(dash.getCell('B11').value?.formula||'').startsWith('HYPERLINK("#\'全部明细\'!A2",'),'WPS internal hyperlink formula missing');
  must(dash.getCell('A13').value==='派次与平均签收天数','attempt section must stay on dashboard');
  must(!names.some(name=>/^[123]派|金边[123]派|外省[123]派/.test(name)),'attempt detail sheets must not be created');
  must(stats.overall.days[0]===3,'average days must use first report lock 08-01 to actual POD 08-03 inclusive, not dispatch start 08-02');
  must(completeSigningAverage(stats.overall.days,stats.overall.pod)===3,'exact average denominator must equal completed POD count');
  must(completeSigningAverage([],1)===null,'missing POD signing date must keep exact average unknown');
  console.log('[V200/V329] generated reference workbook structure/style/link + first-report-lock-to-POD exact average smoke passed');
}finally{try{fs.rmSync(file,{force:true});}catch{}}