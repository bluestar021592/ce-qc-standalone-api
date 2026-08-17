import path from 'node:path';
import ExcelJS from 'exceljs';
import { getDb } from './db.js';
import { loadLightweightUnifiedBusinessState } from './lightweightDashboardStore.js';

const BUSINESS_TYPES=Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN']);
const SHOPEE_TYPES=new Set(['SHOPEECN','SHOPEEVN']);
const VERSION='2026-08-17-v177-one-business-one-workbook-v1';
const FONT_NAME='Microsoft YaHei';

function dateKey(value=''){
  const match=String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match?`${match[1]}-${match[2]}-${match[3]}`:'';
}
function dayNumber(value=''){
  const key=dateKey(value);if(!key)return null;
  const [y,m,d]=key.split('-').map(Number);return Date.UTC(y,m-1,d);
}
function naturalDays(from,to){
  const a=dayNumber(from),b=dayNumber(to);if(a===null||b===null||b<a)return '';
  return Math.floor((b-a)/86400000)+1;
}
function rate(a,b){return b?Number((Number(a||0)*100/Number(b)).toFixed(2)):0;}
function avg(values=[]){const nums=values.map(Number).filter(Number.isFinite);return nums.length?Number((nums.reduce((s,n)=>s+n,0)/nums.length).toFixed(2)):0;}
function billOf(row={}){return String(row.shipmentCode||row.运单号||row.waybill||row.billNo||'').trim().toUpperCase();}
function isPod(row={}){return row.是否POD==='是'||Number(row.isPod||0)===1||String(row.orderStatus||'')==='85'||String(row.currentState||row.scanNormalizedState||'').toUpperCase()==='POD';}
function regionOf(row={}){
  const raw=String(row.region_code||row.regionCode||row.region_type||row.区域分类||row.区域||'').trim().toUpperCase();
  if(raw==='PP'||/金边|PHNOM\s*PENH/.test(raw))return 'PP';
  if(raw==='PV'||/外省/.test(raw))return 'PV';
  return raw||'';
}
function regionLabel(code=''){return code==='PP'?'金边 PP':code==='PV'?'外省 PV':code||'未识别';}
function firstValue(row={},keys=[]){for(const key of keys){const value=row?.[key];if(value!==undefined&&value!==null&&String(value).trim()!=='')return value;}return '';}
function currentStatus(row={}){
  if(isPod(row))return 'POD';
  return String(firstValue(row,['currentState','scanNormalizedState','currentMainCategory','primaryCategory','主分类','异常分类','category','状态说明','状态标识'])||'未闭环');
}
function safeFileName(value=''){return String(value||'').replace(/[\\/:*?"<>|]/g,'_').replace(/\s+/g,' ').trim();}
function displayType(type){return type==='SHOPEECN'?'SHOPEE CN':type==='SHOPEEVN'?'SHOPEE VN':type;}
function periodLabel(periodType='custom'){return ({daily:'日报',weekly:'周报',monthly:'月报',custom:'自定义日期'})[periodType]||'区间报表';}

function latestCompletedBatches(from,to){
  const rows=getDb().prepare(`
    SELECT b.snapshotId,b.reportDate,b.createdAt,b.sourceName
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND s.status='COMPLETED' AND b.reportDate BETWEEN ? AND ?
    ORDER BY b.reportDate ASC,b.createdAt DESC
  `).all(from,to);
  const byDate=new Map();for(const row of rows)if(!byDate.has(row.reportDate))byDate.set(row.reportDate,row);
  return [...byDate.values()];
}

function mergeAnalysisRow(entry,row,reportDate,type){
  const pod=isPod(row);
  const region=regionOf(row);
  const attempt=Number(row.podAttemptNo||0);
  const currentAttempt=Number(row.currentAttemptNo||0);
  if(!entry){
    entry={
      shipmentCode:billOf(row),businessType:type,firstReportDate:reportDate,lastReportDate:reportDate,
      pod:false,podSnapshotDate:'',region:'',recipient:'',province:'',orderTime:'',deliveryTime:'',
      currentStatus:'',category:'',latestEventTime:'',latestNode:'',shopCode:'',shopName:'',
      firstAttemptAt:'',podAttemptNo:0,currentAttemptNo:0,apiStatus:'',sourceRowNumber:0
    };
  }
  if(!entry.firstReportDate||reportDate<entry.firstReportDate)entry.firstReportDate=reportDate;
  if(!entry.lastReportDate||reportDate>=entry.lastReportDate){
    entry.lastReportDate=reportDate;
    entry.region=region||entry.region;
    entry.recipient=String(firstValue(row,['recipient_normalized','recipientNormalized','recipient_raw','recipientRaw','收件人'])||entry.recipient||'');
    entry.province=String(firstValue(row,['recipientProvince','province','收件省份','省份','收件省'])||entry.province||'');
    entry.orderTime=String(firstValue(row,['orderTime','下单时间','createTime','createdTime'])||entry.orderTime||'');
    entry.deliveryTime=String(firstValue(row,['deliveryTime','派件时间','assignTime'])||entry.deliveryTime||'');
    entry.currentStatus=currentStatus(row)||entry.currentStatus;
    entry.category=String(firstValue(row,['currentMainCategory','primaryCategory','主分类','异常分类','category'])||entry.category||'');
    entry.latestEventTime=String(firstValue(row,['latestEventTime','lastEventTime','最后节点时间'])||entry.latestEventTime||'');
    entry.latestNode=String(firstValue(row,['latestEventDesc','lastEventDesc','最后节点','latestNode','lastEvent'])||entry.latestNode||'');
    entry.shopCode=String(firstValue(row,['currentShopCode','targetShopCode','门店编码','matchedShopCode'])||entry.shopCode||'');
    entry.shopName=String(firstValue(row,['shopName','门店名称','matchedShopName'])||entry.shopName||'');
    entry.firstAttemptAt=String(firstValue(row,['firstAttemptAt'])||entry.firstAttemptAt||'');
    entry.currentAttemptNo=Math.max(entry.currentAttemptNo,currentAttempt);
    entry.apiStatus=String(firstValue(row,['apiStatus','API状态'])||entry.apiStatus||'');
    entry.sourceRowNumber=Number(firstValue(row,['source_row_number','rowNumber'])||entry.sourceRowNumber||0);
  }
  if(pod){
    entry.pod=true;
    if(!entry.podSnapshotDate||reportDate<entry.podSnapshotDate)entry.podSnapshotDate=reportDate;
    if(attempt>0)entry.podAttemptNo=entry.podAttemptNo>0?Math.min(entry.podAttemptNo,attempt):attempt;
    if(!entry.latestEventTime)entry.latestEventTime=String(firstValue(row,['latestEventTime','lastEventTime','最后节点时间'])||'');
  }
  return entry;
}

function fillPodTimes(entries,type){
  const podEntries=[...entries.values()].filter(row=>row.pod);
  if(!podEntries.length)return;
  const db=getDb();const chunkSize=500;
  for(let offset=0;offset<podEntries.length;offset+=chunkSize){
    const chunk=podEntries.slice(offset,offset+chunkSize);const codes=chunk.map(row=>row.shipmentCode);
    const marks=codes.map(()=>'?').join(',');
    const rows=SHOPEE_TYPES.has(type)
      ? db.prepare(`SELECT shipmentCode,podTime,source FROM business_pod_locks WHERE businessType='SHOPEE' AND shipmentCode IN (${marks})`).all(...codes)
      : db.prepare(`SELECT shipmentCode,podTime,source FROM pod_locks WHERE shipmentCode IN (${marks})`).all(...codes);
    const map=new Map(rows.map(row=>[String(row.shipmentCode||'').toUpperCase(),row]));
    for(const entry of chunk){
      const lock=map.get(entry.shipmentCode);
      const fallback=entry.latestEventTime||entry.podSnapshotDate;
      entry.podTime=String(lock?.podTime||fallback||'');
      entry.podTimeSource=lock?.podTime?'POD锁':entry.latestEventTime?'POD最后节点':'POD日报快照';
      entry.podDate=dateKey(entry.podTime)||entry.podSnapshotDate;
      entry.deliveryNaturalDays=naturalDays(entry.firstReportDate,entry.podDate);
    }
  }
}

function styleHeader(row){
  row.height=24;
  row.eachCell(cell=>{
    cell.font={name:FONT_NAME,bold:true,color:{argb:'FFFFFFFF'}};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF195A8D'}};
    cell.alignment={vertical:'middle',horizontal:'center'};
    cell.border={bottom:{style:'thin',color:{argb:'FFB7C9DB'}}};
  });
}
function styleSummaryKey(cell){cell.font={name:FONT_NAME,bold:true,color:{argb:'FF18324F'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEAF3FA'}};}
function addSummaryRow(sheet,label,value,note=''){
  const row=sheet.addRow([label,value,note]);styleSummaryKey(row.getCell(1));row.eachCell(cell=>{cell.font={...(cell.font||{}),name:FONT_NAME};cell.alignment={vertical:'middle'};});return row;
}
function makeColumns(sheet,columns){sheet.columns=columns.map(([header,key,width])=>({header,key,width}));styleHeader(sheet.getRow(1));sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:`${sheet.getColumn(columns.length).letter}1`};}

function buildDailyStats(entries){
  const byDate=new Map();
  for(const entry of entries.values()){
    const date=entry.firstReportDate;if(!date)continue;
    if(!byDate.has(date))byDate.set(date,{date,total:0,pod:0,pp:0,pv:0,returned:0,days:[],a1:0,a2:0,a3:0});
    const stat=byDate.get(date);stat.total+=1;if(entry.region==='PP')stat.pp+=1;if(entry.region==='PV')stat.pv+=1;
    if(entry.pod){stat.pod+=1;if(Number(entry.deliveryNaturalDays)>0)stat.days.push(Number(entry.deliveryNaturalDays));if(entry.podAttemptNo===1)stat.a1+=1;else if(entry.podAttemptNo===2)stat.a2+=1;else if(entry.podAttemptNo>=3)stat.a3+=1;}
    if(/RETURN|退回|退件/.test(String(entry.currentStatus||entry.category||'').toUpperCase()))stat.returned+=1;
  }
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

export async function createCompactPeriodBusinessWorkbook({type,periodType='custom',range,outputDir}){
  const businessType=String(type||'').toUpperCase();
  if(!BUSINESS_TYPES.includes(businessType))throw new Error(`V177不支持业务类型：${businessType}`);
  const batches=latestCompletedBatches(range.from,range.to);
  if(!batches.length)throw new Error(`${range.from} 至 ${range.to} 没有 VALID + COMPLETED 日快照。`);

  const entries=new Map();
  for(const batch of batches){
    const state=loadLightweightUnifiedBusinessState(businessType,batch.snapshotId,{includeHistory:false});
    for(const row of state.finalRows||[]){
      const code=billOf(row);if(!code)continue;
      entries.set(code,mergeAnalysisRow(entries.get(code),row,batch.reportDate,businessType));
    }
  }
  if(!entries.size)throw new Error(`${displayType(businessType)} 在 ${range.from} 至 ${range.to} 没有可导出的业务数据。`);
  fillPodTimes(entries,businessType);

  const values=[...entries.values()].sort((a,b)=>a.firstReportDate.localeCompare(b.firstReportDate)||a.shipmentCode.localeCompare(b.shipmentCode));
  const daily=buildDailyStats(entries);
  const podRows=values.filter(row=>row.pod);
  const validDays=podRows.map(row=>Number(row.deliveryNaturalDays)).filter(n=>Number.isFinite(n)&&n>0);
  const total=values.length,pod=podRows.length,notPod=Math.max(0,total-pod);
  const pp=values.filter(row=>row.region==='PP').length,pv=values.filter(row=>row.region==='PV').length;
  const returned=values.filter(row=>/RETURN|退回|退件/.test(String(row.currentStatus||row.category||'').toUpperCase())).length;
  const t1=validDays.filter(n=>n===1).length,t2=validDays.filter(n=>n===2).length,t3=validDays.filter(n=>n>=3).length;
  const a1=podRows.filter(row=>row.podAttemptNo===1).length,a2=podRows.filter(row=>row.podAttemptNo===2).length,a3=podRows.filter(row=>row.podAttemptNo>=3).length;

  const fileName=safeFileName(`${displayType(businessType)}_${periodLabel(periodType)}_完整统计表_${range.from}_至_${range.to}.xlsx`);
  const filePath=path.join(outputDir,fileName);
  const workbook=new ExcelJS.stream.xlsx.WorkbookWriter({filename:filePath,useStyles:true,useSharedStrings:false});
  workbook.creator='CE Express QC';workbook.created=new Date();

  const summary=workbook.addWorksheet('看板汇总');
  summary.columns=[{width:24},{width:22},{width:72}];
  const title=summary.addRow([`${displayType(businessType)} ${range.from} 至 ${range.to} 完整统计看板`]);
  title.getCell(1).font={name:FONT_NAME,size:16,bold:true,color:{argb:'FF0B3558'}};title.height=30;
  addSummaryRow(summary,'业务板块',displayType(businessType));
  addSummaryRow(summary,'日期范围',`${range.from} 至 ${range.to}`,'只读取 VALID + COMPLETED 日快照；同一运单跨日期只统计一次。');
  addSummaryRow(summary,'唯一票数',total);
  addSummaryRow(summary,'已POD票数',pod);
  addSummaryRow(summary,'未POD票数',notPod);
  addSummaryRow(summary,'POD派件完成率',`${rate(pod,total)}%`,'已POD唯一票数 ÷ 区间唯一票数。');
  addSummaryRow(summary,'平均派件天数',validDays.length?`${avg(validDays)} 天`:'—','首次日报日期 → POD日期，按自然日计算，同日POD=1天。');
  addSummaryRow(summary,'派件天数有效样本',validDays.length,'POD时间优先读取POD锁；缺失时回退POD最后节点时间。');
  addSummaryRow(summary,'T1签收',t1,`${rate(t1,pod)}% / 已POD`);
  addSummaryRow(summary,'T2签收',t2,`${rate(t2,pod)}% / 已POD`);
  addSummaryRow(summary,'T3+签收',t3,`${rate(t3,pod)}% / 已POD`);
  addSummaryRow(summary,'金边 PP',pp,`${rate(pp,total)}%`);
  addSummaryRow(summary,'外省 PV',pv,`${rate(pv,total)}%`);
  addSummaryRow(summary,'退回/退件',returned,`${rate(returned,total)}%`);
  if(SHOPEE_TYPES.has(businessType)){
    addSummaryRow(summary,'1派POD',a1,`${rate(a1,pod)}% / 已POD`);
    addSummaryRow(summary,'2派POD',a2,`${rate(a2,pod)}% / 已POD`);
    addSummaryRow(summary,'3派+POD',a3,`${rate(a3,pod)}% / 已POD`);
  }
  addSummaryRow(summary,'计算口径说明','','“派件率”在本表明确指 POD派件完成率，不使用“当前派送中率”代替。');
  summary.eachRow(row=>row.eachCell(cell=>{cell.font={...(cell.font||{}),name:FONT_NAME};cell.alignment={vertical:'middle',wrapText:true};}));
  summary.commit();

  const dailySheet=workbook.addWorksheet('每日汇总');
  const dailyColumns=[['日期','date',14],['唯一票数','total',14],['已POD','pod',14],['未POD','notPod',14],['POD派件完成率','podRate',18],['平均派件天数','avgDays',18],['金边PP','pp',14],['外省PV','pv',14],['退回/退件','returned',14]];
  if(SHOPEE_TYPES.has(businessType))dailyColumns.push(['1派POD','a1',14],['2派POD','a2',14],['3派+POD','a3',14]);
  makeColumns(dailySheet,dailyColumns);
  for(const stat of daily){
    const data={date:stat.date,total:stat.total,pod:stat.pod,notPod:stat.total-stat.pod,podRate:`${rate(stat.pod,stat.total)}%`,avgDays:stat.days.length?avg(stat.days):'',pp:stat.pp,pv:stat.pv,returned:stat.returned,a1:stat.a1,a2:stat.a2,a3:stat.a3};
    const row=dailySheet.addRow(data);row.eachCell(cell=>{cell.font={name:FONT_NAME};cell.alignment={vertical:'middle',horizontal:'center'};});row.commit();
  }
  dailySheet.commit();

  const detail=workbook.addWorksheet('运单统计明细');
  makeColumns(detail,[
    ['业务板块','businessType',16],['运单编号','shipmentCode',24],['首次日报日期','firstReportDate',16],['最后日报日期','lastReportDate',16],
    ['区域','regionLabel',14],['收件省份','province',18],['是否POD','podLabel',12],['POD时间','podTime',22],['POD日期','podDate',16],
    ['派件耗时自然日','deliveryNaturalDays',18],['POD时间来源','podTimeSource',16],['POD派次','podAttemptNo',12],['当前派次','currentAttemptNo',12],
    ['首次派件时间','firstAttemptAt',22],['当前/最终状态','currentStatus',24],['主分类','category',24],['最后节点','latestNode',42],['最后节点时间','latestEventTime',22],
    ['门店编码','shopCode',18],['门店名称','shopName',24],['API状态','apiStatus',16],['收件人/来源','recipient',28],['下单时间','orderTime',22],['派件时间','deliveryTime',22],['源行号','sourceRowNumber',12]
  ]);
  for(const item of values){
    const row=detail.addRow({...item,regionLabel:regionLabel(item.region),podLabel:item.pod?'是':'否'});
    row.eachCell(cell=>{cell.font={name:FONT_NAME};cell.alignment={vertical:'middle',wrapText:true};});row.commit();
  }
  detail.commit();
  await workbook.commit();
  return {file:filePath,rowCount:values.length,summary:{total,pod,podRate:rate(pod,total),averageDeliveryDays:avg(validDays),validDeliveryDaySamples:validDays.length,pp,pv,returned,t1,t2,t3,a1,a2,a3},version:VERSION};
}

export const V177_COMPACT_PERIOD_EXPORTER_VERSION=VERSION;
