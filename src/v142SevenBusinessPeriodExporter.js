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

export const V142_SEVEN_EXPORT_ID='2026-09-12-v142-seven-business-sheet-reconciliation-v3';
export const V457_AUDITED_WHPP_EXPORT_ID='2026-09-08-v457-direct-export-consumes-audited-whpp-authority-v1';
export const V511_SEVEN_BUSINESS_COUNT_RECONCILIATION_ID='2026-09-13-v511-seven-business-per-type-conservation-v1';
const CORE_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const ALL_TYPES=[...CORE_TYPES,'WHPP'];
const REQUIRED_DETAIL_SHEETS=['全部明细','金边明细','外省明细','门店明细','POD明细','未POD明细','分配派送中明细','Pending明细','退回明细'];
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
function terminalFlags(row={}){
  const state=String(row.currentState||row.scanNormalizedState||row.state||'').trim().toUpperCase();
  const orderStatus=String(row.orderStatus||'').trim();
  const text=`${state} ${row.primaryCategory||''} ${row.主分类||''} ${row.异常分类||''} ${row.退回状态||''}`.toUpperCase();
  const pod=state==='POD'||orderStatus==='85'||row.是否POD==='是'||Number(row.isPod||0)===1;
  const returned=!pod&&(orderStatus==='86'||row.是否退回==='是'||row.退回状态==='已退回'||/RETURN_COMPLETED|RETURNED|退回完成|已退回/.test(text));
  return{pod,returned};
}
function normalizeLatestExportRow(row,businessType,reportDate){
  const out={...row,businessType,reportDate:row.reportDate||reportDate};
  const {pod,returned}=terminalFlags(out);
  if(pod){out.currentState='POD';out.scanNormalizedState='POD';out.是否POD='是';out.isPod=1;}
  if(returned){out.currentState='RETURN_COMPLETED';out.scanNormalizedState='RETURN_COMPLETED';out.是否POD='否';out.isPod=0;out.是否退回='是';out.退回状态='已退回';}
  if(pod||returned){
    out.currentStore='';out.当前门店='';out.storeCode='';
    out.pendingUniqueDayCount=0;out.pendingDays=0;out.Pending天数=0;
  }else if(String(out.shopState||'').toUpperCase()==='SHOP_ARRIVED_CURRENT'&&!out.currentStore&&!out.当前门店&&!out.storeCode){
    out.currentStore=out.currentShopCode||out.门店编码||out.shopName||out.门店名称||'';
  }
  return out;
}

function latestStateMap(snapshotId,businessType){
  const db=getDb();
  const rows=db.prepare(`SELECT c.shipmentCode,c.state,c.apiStatus,c.lastEventTime,c.stateJson,c.updatedAt
    FROM shipment_current_state c
    INNER JOIN unified_import_rows u ON u.shipmentCode=c.shipmentCode AND u.snapshotId=? AND u.businessType=?
    ORDER BY c.shipmentCode`).all(snapshotId,businessType);
  return new Map(rows.map(item=>{
    const code=String(item.shipmentCode||'').trim().toUpperCase();
    const dynamic=safeJson(item.stateJson,{});
    const state=String(item.state||dynamic.currentState||dynamic.scanNormalizedState||'').toUpperCase();
    const pod=state==='POD'||dynamic.是否POD==='是'||String(dynamic.orderStatus||'')==='85';
    return [code,{
      ...dynamic,
      shipmentCode:code,运单号:code,businessType,
      currentState:item.state||dynamic.currentState||'',scanNormalizedState:item.state||dynamic.scanNormalizedState||'',
      apiStatus:item.apiStatus||dynamic.apiStatus||'',API状态:item.apiStatus||dynamic.API状态||dynamic.查询状态||'',
      latestEventTime:item.lastEventTime||dynamic.latestEventTime||dynamic.最后节点时间||'',
      最后节点时间:item.lastEventTime||dynamic.最后节点时间||dynamic.latestEventTime||'',
      是否POD:pod?'是':'否',isPod:pod?1:0,
      latestStateUpdatedAt:item.updatedAt||''
    }];
  }).filter(([code])=>code));
}
function overlayLatestState(rows,snapshotId,businessType,reportDate){
  const current=latestStateMap(snapshotId,businessType);
  return (rows||[]).map(row=>{
    const code=bill(row);const dynamic=current.get(code);
    const merged=dynamic?{...row,...dynamic,shipmentCode:code,运单号:code,businessType,reportDate}:{...row,businessType,reportDate:row.reportDate||reportDate};
    return normalizeLatestExportRow(merged,businessType,reportDate);
  });
}

function loadWhppRows(reportDate,snapshotId){
  const db=getDb();
  const sources=db.prepare("SELECT shipmentCode,rowJson FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode").all(reportDate);
  const finals=db.prepare("SELECT shipmentCode,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,rawJson FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode").all(reportDate);
  const finalMap=new Map(finals.map(row=>[String(row.shipmentCode||'').toUpperCase(),row]));
  const base=sources.map(source=>{const code=String(source.shipmentCode||'').toUpperCase();const s=safeJson(source.rowJson,{});const f=finalMap.get(code)||{};const raw=safeJson(f.rawJson,{});const pod=Number(f.isPod||0)===1||raw.是否POD==='是'||String(raw.currentState||'').toUpperCase()==='POD';return {...s,...raw,shipmentCode:code,运单号:code,businessType:'WHPP',reportDate,isPod:pod?1:0,是否POD:pod?'是':'否',primaryCategory:f.primaryCategory||raw.primaryCategory||raw.主分类||'',API状态:f.apiStatus||raw.API状态||raw.查询状态||'',apiStatus:f.apiStatus||raw.apiStatus||'',carry状态:f.carryStatus||raw.carry状态||'',latestEventTime:f.latestEventTime||raw.latestEventTime||'',latestEventDesc:f.latestEventDesc||raw.latestEventDesc||raw.最后节点||'',latestNode:f.latestNode||raw.latestNode||''};});
  return overlayLatestState(base,snapshotId,'WHPP',reportDate);
}

export function reconcileSevenBusinessSnapshotCounts(rows=[],dayAudit={}){
  const coreCounts=dayAudit?.coreCounts||{};
  const expectedCounts=Object.fromEntries(ALL_TYPES.map(type=>[type,type==='WHPP'?Number(dayAudit?.whpp?.reported||0):Number(coreCounts[type]||0)]));
  const actualCounts=Object.fromEntries(ALL_TYPES.map(type=>[type,0]));
  const unknownRows=[];
  for(const row of rows||[]){
    const type=String(row?.businessType||'').trim().toUpperCase();
    if(!ALL_TYPES.includes(type)){unknownRows.push({shipmentCode:bill(row),businessType:type||'UNCLASSIFIED'});continue;}
    actualCounts[type]+=1;
  }
  const mismatchedTypes=ALL_TYPES.filter(type=>actualCounts[type]!==expectedCounts[type]);
  const expectedTotal=ALL_TYPES.reduce((sum,type)=>sum+expectedCounts[type],0);
  const uniqueBills=new Set((rows||[]).map(bill).filter(Boolean));
  const duplicateRows=Math.max(0,(rows||[]).length-uniqueBills.size);
  const passed=unknownRows.length===0&&mismatchedTypes.length===0&&(rows||[]).length===expectedTotal&&uniqueBills.size===expectedTotal;
  return{
    id:V511_SEVEN_BUSINESS_COUNT_RECONCILIATION_ID,
    expectedCounts,actualCounts,expectedTotal,rows:(rows||[]).length,uniqueBills:uniqueBills.size,
    duplicateRows,unknownRows:unknownRows.slice(0,20),mismatchedTypes,passed
  };
}

function buildSnapshots(range,audit){
  const db=getDb(),snapshots=[],auditByDate=new Map((audit?.days||[]).map(day=>[String(day.reportDate||''),day]));
  for(const reportDate of dateList(range.from,range.to)){
    const dayAudit=auditByDate.get(reportDate)||null;
    if(!dayAudit||dayAudit.status!=='OK')throw new Error(`${reportDate} 七业务安全审计未通过，已阻止静默缺日导出。`);
    const batch=latestBatch(db,reportDate);if(!batch)throw new Error(`${reportDate} 当日有效统一导入不存在，已阻止静默缺日导出。`);
    const rows=[];
    for(const type of CORE_TYPES){
      const state=loadLightweightUnifiedBusinessState(type,batch.snapshotId,{includeHistory:false});
      rows.push(...overlayLatestState(state.finalRows||[],batch.snapshotId,type,reportDate));
    }
    const whppRows=loadWhppRows(reportDate,batch.snapshotId);rows.push(...whppRows);
    const conservation=reconcileSevenBusinessSnapshotCounts(rows,dayAudit);
    if(!conservation.passed){
      const perType=ALL_TYPES.map(type=>`${type}:${conservation.actualCounts[type]}/${conservation.expectedCounts[type]}`).join('，');
      const unknown=conservation.unknownRows.length?`；未知业务示例：${conservation.unknownRows.map(row=>`${row.shipmentCode}:${row.businessType}`).join('、')}`:'';
      throw new Error(`${reportDate} 导出前七板块逐板守恒失败：${perType}；应有${conservation.expectedTotal}票，导出行${conservation.rows}票，唯一运单${conservation.uniqueBills}票${unknown}。已停止导出，避免跨板错票/漏票/重复票。`);
    }
    const whppSnapshotId=String(dayAudit.whpp?.snapshotId||'').trim()||(Number(dayAudit.whpp?.reported||0)===0?'ZERO_TICKET':'NONE');
    if(Number(dayAudit.whpp?.reported||0)>0&&whppSnapshotId==='NONE')throw new Error(`${reportDate} WHPP已通过前置审计但缺少审计锁定快照，已停止导出。`);
    snapshots.push({snapshotId:`${batch.snapshotId}|WHPP:${whppSnapshotId}`,reportDate,createdAt:batch.createdAt,payload:{finalRows:rows},v457AuditedWhppSnapshotId:whppSnapshotId,v457AuditAuthority:dayAudit.whpp?.authorityReason||'',latestManualStateApplied:true,conservation:{...conservation,status:'PASSED'}});
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
function cellText(value){
  if(value===null||value===undefined)return'';
  if(typeof value==='object')return String(value.text??value.result??'').trim();
  return String(value).trim();
}
function detailSheetStats(wb,name){
  const sheet=wb.getWorksheet(name);if(!sheet)throw new Error(`导出母版缺少${name}，已停止导出。`);
  const keys=[];
  sheet.eachRow(row=>{
    const code=cellText(row.getCell(2).value).toUpperCase();
    if(!code||code==='运单编号')return;
    const date=cellText(row.getCell(1).value).slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
    keys.push(`${date}|${code}`);
  });
  return{rows:keys.length,set:new Set(keys)};
}
function subset(left,right){for(const value of left)if(!right.has(value))return false;return true;}
function disjoint(left,right){for(const value of left)if(right.has(value))return false;return true;}
function unionSize(...sets){const union=new Set();for(const set of sets)for(const value of set)union.add(value);return union.size;}
function expectedWorkbookRows(snapshots,type){
  return snapshots.reduce((sum,snapshot)=>sum+(snapshot.payload?.finalRows||[]).filter(row=>type==='ALL'||String(row.businessType||'').toUpperCase()===type).length,0);
}
async function validateGeneratedWorkbook(file,{type,expected}){
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(file);
  for(const name of REQUIRED_DETAIL_SHEETS)if(!wb.getWorksheet(name))throw new Error(`${type} 导出缺少 ${name} Sheet，已停止交付。`);
  const all=detailSheetStats(wb,'全部明细'),pp=detailSheetStats(wb,'金边明细'),pv=detailSheetStats(wb,'外省明细'),store=detailSheetStats(wb,'门店明细');
  const pod=detailSheetStats(wb,'POD明细'),notPod=detailSheetStats(wb,'未POD明细'),delivery=detailSheetStats(wb,'分配派送中明细'),pending=detailSheetStats(wb,'Pending明细'),returned=detailSheetStats(wb,'退回明细');
  const stats={all:all.rows,pp:pp.rows,pv:pv.rows,store:store.rows,pod:pod.rows,notPod:notPod.rows,delivery:delivery.rows,pending:pending.rows,returned:returned.rows};
  if(all.rows!==expected||all.set.size!==expected)throw new Error(`${type} Excel全部明细守恒失败：应有${expected}票，明细${all.rows}行，唯一日期+运单${all.set.size}票。`);
  if(!subset(pod.set,all.set)||!subset(notPod.set,all.set)||!disjoint(pod.set,notPod.set)||unionSize(pod.set,notPod.set)!==all.set.size){
    throw new Error(`${type} Excel POD/未POD守恒失败：全部${all.rows}，POD${pod.rows}，未POD${notPod.rows}。`);
  }
  if(!subset(returned.set,notPod.set))throw new Error(`${type} Excel退回明细出现POD或非全部明细成员：退回${returned.rows}票。`);
  for(const [label,item] of [['门店',store],['派送中',delivery],['Pending',pending]]){
    if(!subset(item.set,notPod.set))throw new Error(`${type} Excel${label}明细包含已POD/终态票，已停止导出。`);
  }
  const regionUnion=unionSize(pp.set,pv.set);
  const regionOverlap=!disjoint(pp.set,pv.set);
  const regionUnresolved=Math.max(0,all.set.size-regionUnion);
  if((type==='SHOPEECN'||type==='SHOPEEVN')&&(!subset(pp.set,all.set)||!subset(pv.set,all.set)||regionOverlap||regionUnion!==all.set.size)){
    throw new Error(`${type} Excel PP/PV守恒失败：全部${all.rows}，PP${pp.rows}，PV${pv.rows}，未识别${regionUnresolved}。`);
  }
  return{type,expected,...stats,regionUnresolved,status:'PASSED'};
}
async function zipFiles(files,target){await new Promise((resolve,reject)=>{const output=createWriteStream(target);const archive=archiver('zip',{zlib:{level:6}});output.on('close',resolve);output.on('error',reject);archive.on('error',reject);archive.pipe(output);for(const file of files)archive.file(file,{name:path.basename(file)});archive.finalize();});}

export async function exportSevenBusinessPeriodReports(args={}){
  const periodType=args.periodType||'daily';const range=rangeOf(args);if(range.days>180)throw new Error('单次日期范围最多180天。');const selected=normalizeType(args.businessType||'ALL');
  const audit=auditSevenBusinessHistory({fromDate:range.from,toDate:range.to});
  if(!audit.exportReady){const missing=audit.missingDates.join(',');const incomplete=audit.incompleteDates.slice(0,8).map(x=>`${x.reportDate}:${x.issues.join('+')}`).join('；');throw new Error(`历史完整性校验未通过，已阻止缺数据导出。${missing?` 缺少日期：${missing}。`:''}${incomplete?` 待修复：${incomplete}。`:''}`);}
  const snapshots=buildSnapshots(range,audit);const outputDir=getRuntimeConfig().exportsDir;await fs.mkdir(outputDir,{recursive:true});
  const types=selected==='ALL'?ALL_TYPES:[selected];const files=[];const workbookChecks=[];
  if(selected==='ALL'){
    let management=(await createShopeeTemplateWorkbook({type:'ALL',periodType,range,snapshots,outputDir})).file;
    management=await patchSevenWorkbook(management,audit,range);
    workbookChecks.push(await validateGeneratedWorkbook(management,{type:'ALL',expected:expectedWorkbookRows(snapshots,'ALL')}));
    files.push(management);
  }
  for(const type of types){
    const generated=(await createShopeeTemplateWorkbook({type,periodType,range,snapshots,outputDir})).file;
    workbookChecks.push(await validateGeneratedWorkbook(generated,{type,expected:expectedWorkbookRows(snapshots,type)}));
    files.push(generated);
  }
  const sourceExpectedCounts=Object.fromEntries(ALL_TYPES.map(type=>[type,snapshots.reduce((sum,snapshot)=>sum+Number(snapshot.conservation?.expectedCounts?.[type]||0),0)]));
  const sourceExpectedTotal=ALL_TYPES.reduce((sum,type)=>sum+sourceExpectedCounts[type],0);
  const snapshotActualCounts=Object.fromEntries(ALL_TYPES.map(type=>[type,expectedWorkbookRows(snapshots,type)]));
  const finalMismatches=ALL_TYPES.filter(type=>snapshotActualCounts[type]!==sourceExpectedCounts[type]);
  if(finalMismatches.length||expectedWorkbookRows(snapshots,'ALL')!==sourceExpectedTotal){
    throw new Error(`导出交付前七板块最终守恒失败：${ALL_TYPES.map(type=>`${type}:${snapshotActualCounts[type]}/${sourceExpectedCounts[type]}`).join('，')}；总计${expectedWorkbookRows(snapshots,'ALL')}/${sourceExpectedTotal}。已停止交付。`);
  }
  const finalReconciliation={id:V511_SEVEN_BUSINESS_COUNT_RECONCILIATION_ID,sourceExpectedCounts,snapshotActualCounts,sourceExpectedTotal,actualTotal:expectedWorkbookRows(snapshots,'ALL'),mismatchedTypes:finalMismatches,status:'PASSED'};
  let file=files[0];
  if(selected==='ALL'){file=path.join(outputDir,`CE_QC_${periodType}_${range.key}_七业务_${stamp()}.zip`);await zipFiles(files,file);}
  const ids=snapshots.map(s=>s.snapshotId);for(const f of [...files,...(file&&!files.includes(file)?[file]:[])]){recordExport({reportDate:range.to,exportType:`${periodType}:seven-business`,fileName:path.basename(f),fileHash:fileHash(f),rowCount:snapshots.reduce((n,s)=>n+(s.payload?.finalRows?.length||0),0),summary:{periodType,range,snapshotIds:ids,audit:{expectedDays:audit.expectedDays,totalImported:audit.totalImported,totalRetryPending:audit.totalRetryPending},latestManualStateApplied:true,workbookChecks,finalReconciliation},consistency:{status:'PASSED',validationStatus:'VALID',reconciliationStatus:audit.totalRetryPending?'COMPLETED_WITH_RETRY':'COMPLETED'}});}
  return {file,files,range,snapshots:ids,audit,workbookChecks,finalReconciliation,latestManualStateApplied:true,v457AuditedWhppExportId:V457_AUDITED_WHPP_EXPORT_ID};
}