import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { getDb } from './db.js';
import { createShopeeSlimPeriodWorkbook } from './v181ShopeeSlimPeriodExporter.js';

const VERSION = '2026-08-17-v183-shopee-current-status-overlay-export-v1';
const FONT_NAME = 'Microsoft YaHei';
const DETAIL_HEADERS = [
  '日期', '运单编号', '下单时间', '状态标识', '状态说明', '收件省份', '区域分类', '当前门店', '当前省份',
  '收件人', '收件人手机', '收件地址', '派件时间', '派件门店', '派件省份', '派件快递员', '异常编码', '异常描述', '备注'
];
const DETAIL_WIDTHS = [14, 24, 21, 11, 16, 16, 12, 20, 16, 18, 17, 42, 21, 20, 16, 18, 12, 28, 34];
const SUBSET_SHEETS = ['金边明细','外省明细','门店明细','POD明细','未POD明细','分配派送中明细','Pending明细','退回明细'];

function normalizeBill(value = '') { return String(value || '').trim().toUpperCase(); }
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (value.richText) return value.richText.map(item => item.text || '').join('');
  }
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
  return String(value);
}
function dateKey(value = '') {
  const text = cellText(value).trim();
  const match = text.match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : '';
}
function dayNumber(value = '') {
  const key = dateKey(value); if (!key) return null;
  const [y,m,d] = key.split('-').map(Number); return Date.UTC(y,m-1,d);
}
function naturalDays(from, to) {
  const a = dayNumber(from), b = dayNumber(to);
  if (a === null || b === null || b < a) return '';
  return Math.floor((b-a)/86400000)+1;
}
function rate(a,b){return b?Number(a||0)/Number(b):0;}
function avg(values=[]){const nums=values.map(Number).filter(v=>Number.isFinite(v)&&v>0);return nums.length?Number((nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(2)):0;}
function pendingCountOf(state={}) {
  const direct=[state.Pending当前次数,state.Pending次数,state.pendingDistinctDayCount,state.pendingCount,state.pendingTimes,state.pendingDays,state.pendingDayCount]
    .map(Number).find(v=>Number.isFinite(v)&&v>=0);
  if(Number.isFinite(direct))return direct;
  if(Array.isArray(state.pendingDates))return new Set(state.pendingDates.map(v=>String(v||'').slice(0,10)).filter(Boolean)).size;
  return 0;
}
function stateEvidence(row={}) {
  const parsed=safeJson(row.stateJson,{});
  const stateName=String(row.state||parsed.currentState||parsed.state||parsed.primaryCategory||parsed.主分类||parsed.异常分类||'').trim();
  const category=String(parsed.primaryCategory||parsed.主分类||parsed.异常分类||stateName||'').trim();
  const eventTime=String(parsed.POD时间||parsed.退回完成时间||parsed.退回时间||parsed.latestEventTime||parsed.最后节点时间||row.lastEventTime||'').trim();
  const eventDesc=String(parsed.latestEventDesc||parsed.最后节点||parsed.QC判断||category||'').trim();
  const eventNode=String(parsed.latestNode||parsed.currentHub||parsed.currentShop||parsed.当前门店||'').trim();
  const evidence=`${stateName} ${category} ${eventDesc} ${eventNode}`;
  const pod=String(row.state||'').toUpperCase()==='POD'||parsed.是否POD==='是'||String(parsed.orderStatus||'')==='85'||/\bPOD\b|签收|妥投/i.test(evidence);
  const returned=!pod&&(['RETURNED','RETURN_COMPLETED'].includes(String(row.state||'').toUpperCase())||parsed.退回状态==='已退回'||/RETURN_COMPLETED|RETURNED|已退回|退回完成|R退回/i.test(evidence));
  const pending=!pod&&!returned&&(String(parsed.currentState||'').toUpperCase()==='PENDING'||/Pending\d*次|PENDING/i.test(category)||/PENDING/i.test(evidence));
  const delivering=!pod&&!returned&&!pending&&(/DELIVERY|派送|派件|ASSIGN/i.test(evidence));
  return {parsed,stateName,category,eventTime,eventDesc,eventNode,pod,returned,pending,delivering,pendingCount:pendingCountOf(parsed),updatedAt:String(row.updatedAt||'')};
}
function loadCurrentStates(db,businessType,bills,onProgress=()=>{}) {
  const map=new Map(); const chunkSize=350;
  for(let offset=0;offset<bills.length;offset+=chunkSize){
    const chunk=bills.slice(offset,offset+chunkSize); const marks=chunk.map(()=>'?').join(',');
    const rows=db.prepare(`SELECT shipmentCode,businessType,state,apiStatus,lastEventTime,stateJson,updatedAt
      FROM shipment_current_state WHERE businessType=? AND shipmentCode IN (${marks})`).all(businessType,...chunk);
    for(const row of rows){const bill=normalizeBill(row.shipmentCode);if(bill)map.set(bill,stateEvidence(row));}
    onProgress({phase:'currentStates',completed:Math.min(offset+chunk.length,bills.length),total:Math.max(1,bills.length),entries:map.size});
  }
  return map;
}
function appendRemark(base, pieces=[]) {
  const current=String(base||'').trim(); const extras=pieces.filter(Boolean);
  return [current,...extras].filter(Boolean).join('；');
}
function applyCurrent(values,state) {
  const row=[...values];
  const oldStatus=String(row[3]||'').trim().toUpperCase();
  const oldDesc=String(row[4]||'').trim();
  const oldPod=oldStatus==='Y'||/\bPOD\b|签收|妥投/i.test(oldDesc);
  const oldReturned=!oldPod&&(oldStatus==='R'||/RETURN|退回|退件/i.test(oldDesc));
  if(!state)return classify(row);
  if(state.pod||oldPod){
    row[3]='Y'; row[4]='POD';
    if(state.pod&&state.eventTime)row[12]=state.eventTime;
  }else if(state.returned||oldReturned){
    row[3]='R'; row[4]='R退回';
  }else if(state.pending){
    row[3]='P'; row[4]=state.pendingCount>0?`Pending（${state.pendingCount}次）`:'Pending';
  }else if(state.delivering){
    row[3]='W'; row[4]='分配派送中';
  }
  if(state.category&&!String(row[17]||'').trim())row[17]=state.category;
  const notes=[];
  if(state.pending&&state.pendingCount>0)notes.push(`Pending次数:${state.pendingCount}`);
  if(state.updatedAt)notes.push(`当前状态更新:${state.updatedAt}`);
  row[18]=appendRemark(row[18],notes);
  return classify(row,state);
}
function isStoreValues(values) {
  const text=`${values[7]||''} ${values[13]||''}`.trim();
  if(!text||/\bWHPP\b|\bWHJT\d*\b/i.test(text))return false;
  return /(?:^|\b)(?:CP|FS)[A-Z0-9_-]*/i.test(text)||/\bSHOP\b|CO[-\s]?SHOP|PT[-\s]?SHOP/i.test(text);
}
function classify(values,state=null) {
  const status=String(values[3]||'').trim().toUpperCase(); const desc=String(values[4]||'').trim();
  const pod=status==='Y'||/\bPOD\b|签收|妥投/i.test(desc);
  const returned=!pod&&(status==='R'||/RETURN|退回|退件/i.test(desc));
  const pending=!pod&&!returned&&(status==='P'||/PENDING/i.test(desc));
  const delivering=!pod&&!returned&&!pending&&(status==='W'||/派件|派送|DELIVER/i.test(desc));
  const area=isStoreValues(values)?'门店':String(values[6]||'').trim()==='金边'?'金边':String(values[6]||'').trim()==='门店'?'门店':'外省';
  const reportDate=dateKey(values[0]); const podDate=pod?dateKey(values[12]):''; const deliveryDays=podDate?naturalDays(reportDate,podDate):'';
  return {values,shipmentCode:normalizeBill(values[1]),reportDate,pod,returned,pending,delivering,area,podDate,deliveryDays,pendingCount:Number(state?.pendingCount||0)};
}
function emptyDay(date){return{date,total:0,pp:0,pv:0,store:0,pod:0,notPod:0,delivering:0,pending:0,returned:0,podDays:[],missingPodTime:0,t1:0,t2:0,t3:0};}
function listDates(from,to){const a=dayNumber(from),b=dayNumber(to);if(a===null||b===null||b<a)return[];const out=[];for(let t=a;t<=b;t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out;}
function buildStats(records,range){
  const days=new Map(listDates(range.from,range.to).map(date=>[date,emptyDay(date)])); const overall=emptyDay('TOTAL');
  for(const row of records){if(!days.has(row.reportDate))days.set(row.reportDate,emptyDay(row.reportDate));for(const stat of[days.get(row.reportDate),overall]){
    stat.total++; if(row.area==='金边')stat.pp++; else if(row.area==='门店')stat.store++; else stat.pv++;
    if(row.pod){stat.pod++;const d=Number(row.deliveryDays||0);if(d>0){stat.podDays.push(d);if(d===1)stat.t1++;else if(d===2)stat.t2++;else stat.t3++;}else stat.missingPodTime++;}
    if(row.delivering)stat.delivering++; if(row.pending)stat.pending++; if(row.returned)stat.returned++;
  }}
  for(const stat of[...days.values(),overall])stat.notPod=Math.max(0,stat.total-stat.pod);
  return{daily:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)),overall};
}
function styleHeader(row){row.height=24;row.eachCell(cell=>{cell.font={name:FONT_NAME,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF195A8D'}};cell.alignment={vertical:'middle',horizontal:'center'};cell.border={bottom:{style:'thin',color:{argb:'FFD8E3EC'}}};});}
function createDetailSheet(workbook,name){const sheet=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]});sheet.columns=DETAIL_HEADERS.map((header,index)=>({header,width:DETAIL_WIDTHS[index]}));styleHeader(sheet.getRow(1));sheet.autoFilter={from:'A1',to:'S1'};return sheet;}
function addDetail(sheet,values){const row=sheet.addRow(values);row.eachCell((cell,column)=>{cell.font={name:FONT_NAME,size:10};cell.alignment={vertical:'middle',horizontal:column<=7?'center':'left',wrapText:column>=12};});}
function rebuildSubsets(workbook,records){
  for(const name of SUBSET_SHEETS){const old=workbook.getWorksheet(name);if(old)workbook.removeWorksheet(old.id);}
  const sheets={pp:createDetailSheet(workbook,'金边明细'),pv:createDetailSheet(workbook,'外省明细'),store:createDetailSheet(workbook,'门店明细'),pod:createDetailSheet(workbook,'POD明细'),notPod:createDetailSheet(workbook,'未POD明细'),delivering:createDetailSheet(workbook,'分配派送中明细'),pending:createDetailSheet(workbook,'Pending明细'),returned:createDetailSheet(workbook,'退回明细')};
  for(const row of records){if(row.area==='金边')addDetail(sheets.pp,row.values);else if(row.area==='门店')addDetail(sheets.store,row.values);else addDetail(sheets.pv,row.values);if(row.pod)addDetail(sheets.pod,row.values);else addDetail(sheets.notPod,row.values);if(row.delivering)addDetail(sheets.delivering,row.values);if(row.pending)addDetail(sheets.pending,row.values);if(row.returned)addDetail(sheets.returned,row.values);}
}
function updateDashboard(sheet,stats,range,lastRefreshAt=''){
  if(!sheet)return;const o=stats.overall;
  const cards=[['A5',o.total,'A6',1],['C5',o.pp,'C6',rate(o.pp,o.total)],['E5',o.pv,'E6',rate(o.pv,o.total)],['G5',o.store,'G6',rate(o.store,o.total)],['I5',o.pod,'I6',rate(o.pod,o.total)],['K5',o.notPod,'K6',rate(o.notPod,o.total)],['M5',o.delivering,'M6',rate(o.delivering,o.total)],['O5',o.returned,'O6',rate(o.returned,o.total)]];
  for(const[valueCell,value,rateCell,ratio]of cards){sheet.getCell(valueCell).value=value;sheet.getCell(rateCell).value=ratio;sheet.getCell(rateCell).numFmt='0.00%';}
  sheet.getCell('Q5').value=avg(o.podDays);sheet.getCell('Q6').value=o.podDays.length?`有效POD时间 ${o.podDays.length}票`:'无有效POD时间';sheet.getCell('S5').value=o.missingPodTime;
  let r=11;for(const s of stats.daily){const a=[s.date,s.total,s.pp,s.pv,s.store];const b=[s.date,s.pod,s.delivering,s.pending,s.returned,s.notPod,rate(s.pod,s.total),rate(s.delivering,s.total),rate(s.pending,s.total),rate(s.returned,s.total),s.podDays.length?avg(s.podDays):'',s.t1,s.t2,s.t3];a.forEach((v,i)=>sheet.getCell(r,i+1).value=v);b.forEach((v,i)=>sheet.getCell(r,i+7).value=v);['M','N','O','P'].forEach(col=>sheet.getCell(`${col}${r}`).numFmt='0.00%');r++;}
  sheet.getCell(`A${r+1}`).value=`日期范围：${range.from} 至 ${range.to}`;
  sheet.getCell(`A${r+2}`).value='状态口径：首日报归属不变；POD/退回/Pending/派送中使用 shipment_current_state 最近一次成功刷新结果。';
  sheet.getCell(`A${r+3}`).value='派件天数口径：首日报日期 → 实际POD/签收时间，自然日计算，同日=1天；POD时间缺失不强制算1天。';
  sheet.getCell(`A${r+4}`).value=`当前状态最后更新时间：${lastRefreshAt||'无'}；导出引擎：${VERSION}`;
}

export async function createShopeeRefreshedPeriodWorkbook(options={}){
  const result=await createShopeeSlimPeriodWorkbook(options);
  const file=result?.file;if(!file||!fs.existsSync(file))throw new Error('V183基础旧版完整表未生成。');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(file);
  const all=workbook.getWorksheet('全部明细');if(!all)throw new Error('V183找不到“全部明细”工作表。');
  const rawRecords=[];const bills=[];
  all.eachRow((row,rowNumber)=>{if(rowNumber===1)return;const values=DETAIL_HEADERS.map((_,index)=>cellText(row.getCell(index+1).value));const bill=normalizeBill(values[1]);if(!bill)return;rawRecords.push({row,rowNumber,values,bill});bills.push(bill);});
  const businessType=String(options.type||'').trim().toUpperCase();
  const currentStates=loadCurrentStates(getDb(),businessType,[...new Set(bills)],options.onProgress||(()=>{}));
  let lastRefreshAt='';const records=[];let completed=0;
  for(const item of rawRecords){const state=currentStates.get(item.bill)||null;const classified=applyCurrent(item.values,state);records.push(classified);for(let c=1;c<=DETAIL_HEADERS.length;c++)item.row.getCell(c).value=classified.values[c-1];if(state?.updatedAt&&state.updatedAt>lastRefreshAt)lastRefreshAt=state.updatedAt;completed++;if(completed%500===0||completed===rawRecords.length)(options.onProgress||(()=>{}))({phase:'overlayWriting',completed,total:rawRecords.length,entries:records.length});}
  rebuildSubsets(workbook,records);
  const stats=buildStats(records,options.range||{from:'',to:''});updateDashboard(workbook.getWorksheet('每日看板'),stats,options.range||{},lastRefreshAt);
  const temp=`${file}.v183.tmp.xlsx`;await workbook.xlsx.writeFile(temp);fs.rmSync(file,{force:true});fs.renameSync(temp,file);
  return{file,summary:{...(result.summary||{}),total:stats.overall.total,pod:stats.overall.pod,notPod:stats.overall.notPod,podRate:Number((rate(stats.overall.pod,stats.overall.total)*100).toFixed(2)),averageDeliveryDays:avg(stats.overall.podDays),validDeliveryDaySamples:stats.overall.podDays.length,missingPodTime:stats.overall.missingPodTime,t1:stats.overall.t1,t2:stats.overall.t2,t3:stats.overall.t3,pp:stats.overall.pp,pv:stats.overall.pv,store:stats.overall.store,returned:stats.overall.returned,pending:stats.overall.pending,delivering:stats.overall.delivering,lastCurrentStatusAt:lastRefreshAt,engine:VERSION,statusSource:'SHIPMENT_CURRENT_STATE_OVERLAY',outputContract:'LEGACY_10_SHEETS_ONE_WORKBOOK'}};
}

export const V183_SHOPEE_REFRESHED_EXPORT_VERSION=VERSION;
