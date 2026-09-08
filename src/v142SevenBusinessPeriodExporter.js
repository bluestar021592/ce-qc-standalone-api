import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import archiver from 'archiver';
import ExcelJS from 'exceljs';
import { getDb, getRuntimeConfig } from './db.js';
import { loadLightweightUnifiedBusinessState } from './lightweightDashboardStore.js';
import { createShopeeTemplateWorkbook } from './shopeeTemplateExporter.js';
import { fileHash, recordExport } from './backup.js';
import { auditSevenBusinessHistory } from './v142SevenBusinessHistoryAudit.js';

export const V142_SEVEN_EXPORT_ID='2026-08-16-v142-seven-business-strict-period-export-v1';
export const V457_AUDITED_WHPP_EXPORT_ID='2026-09-08-v457-direct-export-consumes-audited-whpp-authority-v1';
const CORE_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const ALL_TYPES=[...CORE_TYPES,'WHPP'];
function safeJson(v,f={}){try{return v&&typeof v==='object'?v:(JSON.parse(String(v||''))||f);}catch{return f;}}
function iso(v=''){const t=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(t)?t:'';}
function dateList(from,to){const out=[];const d=new Date(`${from}T00:00:00Z`),e=new Date(`${to}T00:00:00Z`);while(d<=e){out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1);}return out;}
function stamp(){return new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);}
function normalizeType(v){const t=String(v||'ALL').toUpperCase().replace(/\s+/g,'');if(t==='ALL')return 'ALL';if(!ALL_TYPES.includes(t))throw new Error(`不支持的业务类型：${v}`);return t;}
function rangeOf({periodType='daily',date='',fromDate='',toDate=''}){
  if(periodType==='custom'){const from=iso(fromDate),to=iso(toDate);if(!from||!to||from>to)throw new Error('请选择有效的开始日期和结束日期。');return {from,to,key:`${from}_${to}`,days:dateList(from,to).length};}
  const anchor=iso(date);if(!anchor)throw new Error('请选择有效日期。');const d=new Date(`${anchor}T00:00:00Z`);let from=anchor,to=anchor;
  if(periodType==='weekly'){const offset=(d.getUTCDay()+6)%7;const s=new Date(d);s.setUTCDate(s.getUTCDate()-offset);const e=new Date(s);e.setUTCDate(e.getUTCDate()+6);from=s.toISOString().slice(0,10);to=e.toISOString().slice(0,10);}
  else if(periodType==='monthly'){from=`${anchor.slice(0,7)}-01`;const e=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0));to=e.toISOString().slice(0,10);}
  return {from,to,key:`${from}_${to}`,days:dateList(from,to).length};
}
function latestBatch(db,reportDate){return db.prepare(`SELECT b.snapshotId,b.batchId,b.reportDate,b.createdAt,s.status snapshotStatus FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.status='VALID' AND b.reportDate=? ORDER BY b.createdAt DESC LIMIT 1`).get(reportDate)||null;}
function bill(row={}){return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase();}
function loadWhppRows(reportDate){
  const db=getDb();
  const sources=db.prepare("SELECT shipmentCode,rowJson FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode").all(reportDate);
  const finals=db.prepare("SELECT shipmentCode,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,rawJson FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode").all(reportDate);
  const finalMap=new Map(finals.map(row=>[String(row.shipmentCode||'').toUpperCase(),row]));
  return sources.map(source=>{const code=String(source.shipmentCode||'').toUpperCase();const s=safeJson(source.rowJson,{});const f=finalMap.get(code)||{};const raw=safeJson(f.rawJson,{});const pod=Number(f.isPod||0)===1||raw.是否POD==='是'||String(raw.currentState||'').toUpperCase()==='POD';return {...s,...raw,shipmentCode:code,运单号:code,businessType:'WHPP',reportDate,isPod:pod?1:0,是否POD:pod?'是':'否',primaryCategory:f.primaryCategory||raw.primaryCategory||raw.主分类||'',API状态:f.apiStatus||raw.API状态||raw.查询状态||'',apiStatus:f.apiStatus||raw.apiStatus||'',carry状态:f.carryStatus||raw.carry状态||'',latestEventTime:f.latestEventTime||raw.latestEventTime||'',latestEventDesc:f.latestEventDesc||raw.latestEventDesc||raw.最后节点||'',latestNode:f.latestNode||raw.latestNode||''};});
}
function buildSnapshots(range,audit){
  const db=getDb(),snapshots=[],auditByDate=new Map((audit?.days||[]).map(day=>[String(day.reportDate||''),day]));
  for(const reportDate of dateList(range.from,range.to)){
    const dayAudit=auditByDate.get(reportDate)||null;
    if(!dayAudit||dayAudit.status!=='OK')throw new Error(`${reportDate} 七业务安全审计未通过，已阻止静默缺日导出。`);
    const batch=latestBatch(db,reportDate);if(!batch)throw new Error(`${reportDate} 当日有效统一导入不存在，已阻止静默缺日导出。`);
    const rows=[];for(const type of CORE_TYPES){const state=loadLightweightUnifiedBusinessState(type,batch.snapshotId,{includeHistory:false});rows.push(...(state.finalRows||[]).map(row=>({...row,businessType:type,reportDate:row.reportDate||reportDate})));}
    const whppRows=loadWhppRows(reportDate);rows.push(...whppRows);
    const whppSnapshotId=String(dayAudit.whpp?.snapshotId||'').trim()||(Number(dayAudit.whpp?.reported||0)===0?'ZERO_TICKET':'NONE');
    if(Number(dayAudit.whpp?.reported||0)>0&&whppSnapshotId==='NONE')throw new Error(`${reportDate} WHPP已通过前置审计但缺少审计锁定快照，已停止导出。`);
    snapshots.push({snapshotId:`${batch.snapshotId}|WHPP:${whppSnapshotId}`,reportDate,createdAt:batch.createdAt,payload:{finalRows:rows},v457AuditedWhppSnapshotId:whppSnapshotId,v457AuditAuthority:dayAudit.whpp?.authorityReason||''});
  }
  return snapshots;
}
async function patchSevenWorkbook(file,audit,range){
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(file);
  wb.eachSheet(sheet=>sheet.eachRow(row=>row.eachCell(cell=>{if(typeof cell.value==='string'&&cell.value.includes('五业务'))cell.value=cell.value.replaceAll('五业务','七业务');})));
  let sheet=wb.getWorksheet('数据完整性校验');if(sheet)wb.removeWorksheet(sheet.id);sheet=wb.addWorksheet('数据完整性校验');
  sheet.columns=[{header:'日期',key:'date',width:14},{header:'状态',key:'status',width:18},{header:'CE',key:'ce',width:10},{header:'CEAF',key:'ceaf',width:10},{header:'TBKH',key:'tbkh',width:10},{header:'ALI1688',key:'ali',width:10},{header:'SHOPEE CN',key:'cn',width:14},{header:'SHOPEE VN',key:'vn',width:14},{header:'WHPP',key:'whpp',width:10},{header:'WHPP待重试',key:'retry',width:14},{header:'问题',key:'issues',width:42}];
  for(const d of audit.days){const c=d.coreCounts||{};sheet.addRow({date:d.reportDate,status:d.status,ce:c.CE||0,ceaf:c.CEAF||0,tbkh:c.TBKH||0,ali:c.ALI1688||0,cn:c.SHOPEECN||0,vn:c.SHOPEEVN||0,whpp:d.whpp?.reported||0,retry:d.whpp?.retryPending||0,issues:(d.issues||[]).join('；')});}
  sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
  let carry=wb.getWorksheet('跨日当前未闭环');if(carry)wb.removeWorksheet(carry.id);carry=wb.addWorksheet('跨日当前未闭环');
  carry.columns=[{header:'来源日期',key:'sourceDate',width:14},{header:'最近日期',key:'lastDate',width:14},{header:'业务',key:'business',width:14},{header:'运单号',key:'bill',width:24},{header:'API状态',key:'api',width:18},{header:'当前分类',key:'category',width:24},{header:'最后节点',key:'node',width:38},{header:'更新时间',key:'updated',width:22}];
  const rows=getDb().prepare("SELECT shipmentCode,businessType,sourceReportDate,lastReportDate,apiStatus,stateJson,updatedAt FROM carryover_open_items WHERE status='OPEN' AND sourceReportDate BETWEEN ? AND ? ORDER BY sourceReportDate,businessType,shipmentCode").all(range.from,range.to);
  for(const r of rows){const s=safeJson(r.stateJson,{});carry.addRow({sourceDate:r.sourceReportDate,lastDate:r.lastReportDate,business:r.businessType,bill:r.shipmentCode,api:r.apiStatus,category:s.primaryCategory||s.主分类||s.异常分类||'',node:s.latestEventDesc||s.lastEventDesc||s.最后节点||'',updated:r.updatedAt});}
  carry.getRow(1).font={bold:true};carry.views=[{state:'frozen',ySplit:1}];
  const patched=file.replace('五业务综合','七业务综合');await wb.xlsx.writeFile(patched);if(patched!==file)await fs.unlink(file).catch(()=>{});return patched;
}
async function zipFiles(files,target){await new Promise((resolve,reject)=>{const output=createWriteStream(target);const archive=archiver('zip',{zlib:{level:6}});output.on('close',resolve);output.on('error',reject);archive.on('error',reject);archive.pipe(output);for(const file of files)archive.file(file,{name:path.basename(file)});archive.finalize();});}

export async function exportSevenBusinessPeriodReports(args={}){
  const periodType=args.periodType||'daily';const range=rangeOf(args);if(range.days>180)throw new Error('单次日期范围最多180天。');const selected=normalizeType(args.businessType||'ALL');
  const audit=auditSevenBusinessHistory({fromDate:range.from,toDate:range.to});
  if(!audit.exportReady){const missing=audit.missingDates.join(',');const incomplete=audit.incompleteDates.slice(0,8).map(x=>`${x.reportDate}:${x.issues.join('+')}`).join('；');throw new Error(`历史完整性校验未通过，已阻止缺数据导出。${missing?` 缺少日期：${missing}。`:''}${incomplete?` 待修复：${incomplete}。`:''}`);}
  const snapshots=buildSnapshots(range,audit);const outputDir=getRuntimeConfig().exportsDir;await fs.mkdir(outputDir,{recursive:true});
  const types=selected==='ALL'?ALL_TYPES:[selected];const files=[];
  if(selected==='ALL'){
    let management=(await createShopeeTemplateWorkbook({type:'ALL',periodType,range,snapshots,outputDir})).file;management=await patchSevenWorkbook(management,audit,range);files.push(management);
  }
  for(const type of types){files.push((await createShopeeTemplateWorkbook({type,periodType,range,snapshots,outputDir})).file);}
  let file=files[0];
  if(selected==='ALL'){file=path.join(outputDir,`CE_QC_${periodType}_${range.key}_七业务_${stamp()}.zip`);await zipFiles(files,file);}
  const ids=snapshots.map(s=>s.snapshotId);for(const f of [...files,...(file&&!files.includes(file)?[file]:[])]){recordExport({reportDate:range.to,exportType:`${periodType}:seven-business`,fileName:path.basename(f),fileHash:fileHash(f),rowCount:snapshots.reduce((n,s)=>n+(s.payload?.finalRows?.length||0),0),summary:{periodType,range,snapshotIds:ids,audit:{expectedDays:audit.expectedDays,totalImported:audit.totalImported,totalRetryPending:audit.totalRetryPending}},consistency:{status:'PASSED',validationStatus:'VALID',reconciliationStatus:audit.totalRetryPending?'COMPLETED_WITH_RETRY':'COMPLETED'}});}
  return {file,files,range,snapshots:ids,audit,v457AuditedWhppExportId:V457_AUDITED_WHPP_EXPORT_ID};
}
