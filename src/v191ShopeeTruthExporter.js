import path from 'node:path';
import ExcelJS from 'exceljs';
import { getDb } from './db.js';
import { collectShopeeShipmentTruth, V191_SHOPEE_TRUTH_VERSION } from './v191ShopeeTruth.js';

const VERSION = '2026-08-17-v191-shopee-truth-export-v1';
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const FONT_NAME = 'Microsoft YaHei';
const DETAIL_HEADERS = [
  '首次日报日期','运单编号','下单时间','状态标识','状态说明','收件省份','区域分类','当前门店','当前省份',
  '收件人','收件人手机','收件地址','POD/签收时间','派次','派次依据','数据证据','派件门店','派件省份','派件快递员','异常编码','异常描述','备注'
];
const DETAIL_WIDTHS = [14,24,21,11,18,16,12,22,16,18,17,42,21,9,22,28,20,16,18,12,28,42];

function safeJson(value, fallback = {}) { try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); } catch { return fallback; } }
function normalizeBill(value = '') { return String(value || '').trim().toUpperCase(); }
function normalizeHeader(value = '') { return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]+/g, ''); }
function dateKey(value = '') { const m=String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/); return m?`${m[1]}-${m[2]}-${m[3]}`:''; }
function dayNumber(value = '') { const k=dateKey(value); if(!k)return null; const [y,m,d]=k.split('-').map(Number); return Date.UTC(y,m-1,d); }
function naturalDays(from,to){const a=dayNumber(from),b=dayNumber(to);if(a===null||b===null||b<a)return '';return Math.floor((b-a)/86400000)+1;}
function rate(a,b){return b?Number(a||0)/Number(b):0;}
function avg(values=[]){const nums=values.map(Number).filter(v=>Number.isFinite(v)&&v>0);return nums.length?Number((nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(2)):0;}
function safeFileName(value=''){return String(value||'').replace(/[\\/:*?"<>|]/g,'_').replace(/\s+/g,' ').trim();}
function displayType(type){return type==='SHOPEECN'?'SHOPEE CN':type==='SHOPEEVN'?'SHOPEE VN':type;}
function periodLabel(periodType='custom'){return ({daily:'日报',weekly:'周报',monthly:'月报',custom:'自定义日期'})[periodType]||'区间报表';}
function listDates(from,to){const a=dayNumber(from),b=dayNumber(to);if(a===null||b===null||b<a)return[];const out=[];for(let t=a;t<=b;t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out;}
function rawMap(rowJson){const parsed=safeJson(rowJson,{});const raw=parsed?.raw&&typeof parsed.raw==='object'?parsed.raw:{};const map=new Map();for(const[k,v]of Object.entries(raw))map.set(normalizeHeader(k),v);return{parsed,map};}
function valueByAliases(map,aliases=[]){for(const alias of aliases){const k=normalizeHeader(alias);if(!map.has(k))continue;const v=map.get(k);if(v!==undefined&&v!==null&&String(v).trim()!=='')return String(v).trim();}return'';}

function latestValidBatches(db,from,to){
  const rows=db.prepare(`SELECT snapshotId,reportDate,createdAt,batchId FROM unified_import_batches
    WHERE status='VALID' AND reportDate BETWEEN ? AND ? ORDER BY reportDate ASC,createdAt DESC,batchId DESC`).all(from,to);
  const byDate=new Map();for(const row of rows)if(row.reportDate&&!byDate.has(row.reportDate))byDate.set(row.reportDate,row);
  return[...byDate.values()].sort((a,b)=>String(a.reportDate).localeCompare(String(b.reportDate)));
}
function firstReportRows(db,businessType,batches,onProgress=()=>{}){
  const stmt=db.prepare(`SELECT shipmentCode,regionCode,rowNumber,rowJson FROM unified_import_rows
    WHERE snapshotId=? AND businessType=? ORDER BY rowNumber,shipmentCode`);
  const byBill=new Map();
  for(let index=0;index<batches.length;index++){
    const batch=batches[index],reportDate=String(batch.reportDate||'');
    for(const row of stmt.iterate(batch.snapshotId,businessType)){
      const bill=normalizeBill(row.shipmentCode);if(!bill||byBill.has(bill))continue;
      const {parsed,map}=rawMap(row.rowJson);
      byBill.set(bill,{
        firstReportDate:reportDate,shipmentCode:bill,regionCode:String(row.regionCode||parsed.regionCode||'').trim().toUpperCase(),rowNumber:Number(row.rowNumber||parsed.rowNumber||0),
        orderTime:valueByAliases(map,['下单时间','下单日期','订单时间','订单日期','ordertime','orderdate']),
        rawStatus:valueByAliases(map,['状态标识','状态代码','status','statuscode']),rawStatusDesc:valueByAliases(map,['状态说明','状态描述','statusdesc','statusdescription','statusname']),
        recipientProvince:valueByAliases(map,['收件省份','目的省份','目的地省份','收货省份','receiverprovince','destinationprovince']),
        currentShop:valueByAliases(map,['当前门店','当前网点','当前站点','currentshop','currentsite']),currentProvince:valueByAliases(map,['当前省份','所在省份','currentprovince']),
        recipient:valueByAliases(map,['收件人','收件人姓名','收货人','收货人姓名','recipient','receiver','consignee'])||String(parsed.recipientRaw||''),
        recipientPhone:valueByAliases(map,['收件人手机','收件人电话','收货人手机','收货人电话','手机号','手机号码','recipientphone','receiverphone']),recipientAddress:valueByAliases(map,['收件地址','收货地址','详细地址','地址','recipientaddress','receiveraddress']),
        rawDeliveryTime:valueByAliases(map,['派件时间','签收时间','POD时间','podtime','deliverytime']),deliveryShop:valueByAliases(map,['派件门店','派送门店','deliveryshop']),deliveryProvince:valueByAliases(map,['派件省份','派送省份','deliveryprovince']),courier:valueByAliases(map,['派件快递员','派送快递员','快递员','deliverycourier','courier']),
        exceptionCode:valueByAliases(map,['异常编码','异常代码','exceptioncode']),exceptionDesc:valueByAliases(map,['异常描述','异常说明','exceptiondesc','exceptiondescription']),remark:valueByAliases(map,['备注','remark','remarks','note'])
      });
    }
    onProgress({phase:'sourceRows',completed:index+1,total:Math.max(1,batches.length),entries:byBill.size});
  }
  return[...byBill.values()].sort((a,b)=>a.firstReportDate.localeCompare(b.firstReportDate)||a.rowNumber-b.rowNumber||a.shipmentCode.localeCompare(b.shipmentCode));
}
function appendRemark(base,pieces=[]){return[String(base||'').trim(),...pieces.filter(Boolean)].filter(Boolean).join('；');}
function isStore(row){const text=`${row.currentShop||''} ${row.deliveryShop||''}`.trim();if(!text||/\bWHPP\b|\bWHJT\d*\b/i.test(text))return false;return/(?:^|\b)(?:CP|FS)[A-Z0-9_-]*/i.test(text)||/\bSHOP\b|CO[-\s]?SHOP|PT[-\s]?SHOP/i.test(text);}
function regionClass(row){if(isStore(row))return'门店';const raw=String(row.regionCode||'').toUpperCase();if(raw==='PP')return'金边';if(raw==='PV')return'外省';return/PHNOM\s*PENH|金边/i.test(String(row.recipientProvince||''))?'金边':'外省';}
function applyTruth(row,truth={}){
  let status=String(row.rawStatus||'').trim().toUpperCase(),statusDesc=String(row.rawStatusDesc||'').trim(),deliveryTime=String(row.rawDeliveryTime||'').trim();
  const next={...row};if(truth.eventNode)next.currentShop=truth.eventNode;
  if(truth.pod){status='Y';statusDesc='POD';if(truth.eventTime)deliveryTime=truth.eventTime;}
  else if(truth.returned){status='R';statusDesc='R退回';}
  else if(truth.cancelled){status='N';statusDesc='订单取消';}
  else if(truth.pending){status='P';statusDesc=Number(truth.pendingCount||0)>0?`Pending（${Number(truth.pendingCount)}次）`:'Pending';}
  else if(truth.delivering){status='W';statusDesc='分配派送中';}
  const pod=Boolean(truth.pod)||status==='Y'||/\bPOD\b|签收|妥投/i.test(statusDesc);
  const returned=!pod&&(Boolean(truth.returned)||status==='R'||/RETURN|退回|退件/i.test(statusDesc));
  const cancelled=!pod&&!returned&&(Boolean(truth.cancelled)||status==='N'||/取消|CANCEL/i.test(statusDesc));
  const pending=!pod&&!returned&&!cancelled&&(Boolean(truth.pending)||status==='P'||/PENDING/i.test(statusDesc));
  const delivering=!pod&&!returned&&!cancelled&&!pending&&(Boolean(truth.delivering)||status==='W'||/派件|派送|DELIVER/i.test(statusDesc));
  const podDate=pod?dateKey(deliveryTime):'',deliveryDays=podDate?naturalDays(next.firstReportDate,podDate):'';
  const attemptNo=pod?Number(truth.attemptNo||0):0;
  const evidence=(truth.evidenceSources||[]).join('+')||(truth.hasEvidence?'已识别':'待刷新');
  next.remark=appendRemark(next.remark,[truth.attemptUnknown?'POD已识别但派次证据不足':'',truth.updatedAt?`当前状态更新:${truth.updatedAt}`:'',!truth.hasEvidence?'状态证据:待刷新':'']);
  return{...next,status,statusDesc,deliveryTime,pod,returned,cancelled,pending,delivering,podDate,deliveryDays,attemptNo,attemptSource:String(truth.attemptSource||''),attemptUnknown:Boolean(truth.attemptUnknown),evidence,hasEvidence:Boolean(truth.hasEvidence),pendingCount:Number(truth.pendingCount||0),finalCategory:String(truth.category||''),area:regionClass(next)};
}
function outputRow(row){const province=row.area==='门店'?'门店':(row.recipientProvince||(row.area==='金边'?'金边市':''));return[row.firstReportDate,row.shipmentCode,row.orderTime,row.status,row.statusDesc,province,row.area,row.currentShop,row.currentProvince,row.recipient,row.recipientPhone,row.recipientAddress,row.deliveryTime,row.attemptNo||'',row.attemptSource||'',row.evidence,row.deliveryShop,row.deliveryProvince,row.courier,row.exceptionCode,row.exceptionDesc||row.finalCategory,row.remark];}
function emptyDay(date){return{date,total:0,pp:0,pv:0,store:0,pod:0,notPod:0,delivering:0,pending:0,returned:0,cancelled:0,podDays:[],attempt1:0,attempt2:0,attempt3:0,attemptUnknown:0,evidence:0};}
function buildStats(rows,range){const days=new Map(listDates(range.from,range.to).map(d=>[d,emptyDay(d)])),overall=emptyDay('TOTAL');for(const row of rows){if(!days.has(row.firstReportDate))days.set(row.firstReportDate,emptyDay(row.firstReportDate));for(const stat of[days.get(row.firstReportDate),overall]){stat.total++;if(row.hasEvidence)stat.evidence++;if(row.area==='金边')stat.pp++;else if(row.area==='门店')stat.store++;else stat.pv++;if(row.pod){stat.pod++;const d=Number(row.deliveryDays||0);if(d>0)stat.podDays.push(d);if(row.attemptNo===1)stat.attempt1++;else if(row.attemptNo===2)stat.attempt2++;else if(row.attemptNo>=3)stat.attempt3++;else stat.attemptUnknown++;}if(row.returned)stat.returned++;if(row.cancelled)stat.cancelled++;if(row.pending)stat.pending++;if(row.delivering)stat.delivering++;}}for(const s of[...days.values(),overall])s.notPod=Math.max(0,s.total-s.pod);return{daily:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)),overall};}
function styleHeader(row){row.height=24;row.eachCell(cell=>{cell.font={name:FONT_NAME,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF195A8D'}};cell.alignment={horizontal:'center',vertical:'middle'};cell.border={bottom:{style:'thin',color:{argb:'FFD8E3EC'}}};});}
function addDetailSheet(workbook,name){const sheet=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]});sheet.columns=DETAIL_HEADERS.map((header,i)=>({header,width:DETAIL_WIDTHS[i]}));styleHeader(sheet.getRow(1));sheet.autoFilter={from:'A1',to:'V1'};return sheet;}
function writeDetailRow(sheet,values){const row=sheet.addRow(values);row.eachCell((cell,col)=>{cell.font={name:FONT_NAME,size:10};cell.alignment={vertical:'middle',horizontal:col<=7?'center':'left',wrapText:col>=12};});row.commit?.();}
function setLink(cell,text,target){cell.value={text,hyperlink:`#'${target}'!A1`};cell.font={name:FONT_NAME,color:{argb:'FF0563C1'},underline:true};cell.alignment={horizontal:'center',vertical:'middle'};}
function writeCard(sheet,col,label,value,ratio,target){for(const [r,v]of[[4,label],[5,value],[6,ratio]])sheet.getCell(`${col}${r}`).value=v;sheet.getCell(`${col}6`).numFmt='0.00%';setLink(sheet.getCell(`${col}7`),'点击查看明细',target);sheet.getCell(`${col}4`).font={name:FONT_NAME,bold:true,color:{argb:'FF17365D'}};sheet.getCell(`${col}5`).font={name:FONT_NAME,bold:true,size:16,color:{argb:'FF17365D'}};sheet.getCell(`${col}6`).font={name:FONT_NAME,color:{argb:'FF657B95'}};for(const r of[4,5,6,7])sheet.getCell(`${col}${r}`).alignment={horizontal:'center',vertical:'middle'};}
function writeDashboard(sheet,businessType,range,stats,lastRefreshAt){const{overall,daily}=stats;sheet.columns=Array.from({length:22},(_,i)=>({width:i%2===0?15:12}));sheet.mergeCells('A1:V1');sheet.getCell('A1').value=`${displayType(businessType)}每日数据看板`;sheet.getCell('A1').font={name:FONT_NAME,bold:true,size:18,color:{argb:'FF17365D'}};sheet.getCell('A1').alignment={horizontal:'center'};writeCard(sheet,'A','总票数',overall.total,1,'全部明细');writeCard(sheet,'C','已POD',overall.pod,rate(overall.pod,overall.total),'POD明细');writeCard(sheet,'E','1派签收',overall.attempt1,rate(overall.attempt1,overall.pod),'POD明细');writeCard(sheet,'G','2派签收',overall.attempt2,rate(overall.attempt2,overall.pod),'POD明细');writeCard(sheet,'I','3派+签收',overall.attempt3,rate(overall.attempt3,overall.pod),'POD明细');writeCard(sheet,'K','未POD',overall.notPod,rate(overall.notPod,overall.total),'未POD明细');writeCard(sheet,'M','Pending',overall.pending,rate(overall.pending,overall.total),'Pending明细');writeCard(sheet,'O','派送中',overall.delivering,rate(overall.delivering,overall.total),'分配派送中明细');writeCard(sheet,'Q','已退回',overall.returned,rate(overall.returned,overall.total),'退回明细');writeCard(sheet,'S','状态覆盖',overall.evidence,rate(overall.evidence,overall.total),'全部明细');sheet.getCell('U4').value='首派成功率';sheet.getCell('U5').value=rate(overall.attempt1,overall.total);sheet.getCell('U5').numFmt='0.00%';sheet.getCell('U6').value=`派次未识别 ${overall.attemptUnknown}票`;sheet.getCell('U4').font={name:FONT_NAME,bold:true,color:{argb:'FF17365D'}};sheet.getCell('U5').font={name:FONT_NAME,bold:true,size:16,color:{argb:'FF17365D'}};
  const headers=['首次日报日期','唯一票数','已POD','POD率','1派签收','1派占POD','2派签收','2派占POD','3派+签收','3派+占POD','派次未识别','首派成功率','金边PP','外省PV','门店','Pending','派送中','退回/退件','取消','状态已识别','状态覆盖率','平均妥投天数'];const hr=sheet.getRow(10);headers.forEach((h,i)=>hr.getCell(i+1).value=h);styleHeader(hr);let r=11;for(const d of daily){const vals=[d.date,d.total,d.pod,rate(d.pod,d.total),d.attempt1,rate(d.attempt1,d.pod),d.attempt2,rate(d.attempt2,d.pod),d.attempt3,rate(d.attempt3,d.pod),d.attemptUnknown,rate(d.attempt1,d.total),d.pp,d.pv,d.store,d.pending,d.delivering,d.returned,d.cancelled,d.evidence,rate(d.evidence,d.total),avg(d.podDays)];vals.forEach((v,i)=>sheet.getCell(r,i+1).value=v);for(const c of[4,6,8,10,12,21])sheet.getCell(r,c).numFmt='0.00%';r++;}
  const notes=[`日期范围：${range.from} 至 ${range.to}`,'日期来源：最新VALID日报成员；不再因为分析快照未完成而静默丢掉8月16日等已导入日期。','状态口径：POD锁/当前状态 > 跨日business_final_rows > 扫描结果 > 持久化轨迹；后续POD可回补原始日报日期。','派次口径：优先podAttemptNo/currentAttemptNo；缺失时按持久化“派件分配/派送中”不同自然日重建。POD但无派次证据单列“派次未识别”，不伪造0。',`当前状态最后更新时间：${lastRefreshAt||'无'}；导出引擎：${VERSION} / ${V191_SHOPEE_TRUTH_VERSION}`];notes.forEach((n,i)=>{sheet.getCell(`A${r+1+i}`).value=n;sheet.getCell(`A${r+1+i}`).font={name:FONT_NAME,color:{argb:'FF657B95'}};});sheet.views=[{state:'frozen',ySplit:10}];}

export async function createShopeeTruthWorkbook({type,periodType='custom',range,outputDir,onProgress=()=>{}}){const businessType=String(type||'').trim().toUpperCase();if(!SHOPEE_TYPES.has(businessType))throw new Error(`V191仅支持SHOPEECN/SHOPEEVN：${businessType}`);const db=getDb();const batches=latestValidBatches(db,range.from,range.to);if(!batches.length)throw new Error(`${range.from} 至 ${range.to} 没有 VALID 日报。`);onProgress({phase:'start',completed:0,total:batches.length,entries:0});const source=firstReportRows(db,businessType,batches,onProgress);if(!source.length)throw new Error(`${displayType(businessType)} 在 ${range.from} 至 ${range.to} 没有可导出的业务数据。`);const truth=collectShopeeShipmentTruth({db,businessType,bills:source.map(r=>r.shipmentCode)});let lastRefreshAt='';const rows=source.map(row=>{const t=truth.get(row.shipmentCode)||{};if(t.updatedAt&&t.updatedAt>lastRefreshAt)lastRefreshAt=t.updatedAt;return applyTruth(row,t);});onProgress({phase:'truth',completed:rows.length,total:rows.length,entries:rows.filter(r=>r.hasEvidence).length});const stats=buildStats(rows,range);const fileName=safeFileName(`${displayType(businessType)}_${periodLabel(periodType)}_每日数据看板_${range.from}_至_${range.to}_V191.xlsx`),filePath=path.join(outputDir,fileName);const workbook=new ExcelJS.stream.xlsx.WorkbookWriter({filename:filePath,useStyles:true,useSharedStrings:false});workbook.creator='CE Express QC';workbook.created=new Date();const dashboard=workbook.addWorksheet('每日看板');const sheets={all:addDetailSheet(workbook,'全部明细'),pp:addDetailSheet(workbook,'金边明细'),pv:addDetailSheet(workbook,'外省明细'),store:addDetailSheet(workbook,'门店明细'),pod:addDetailSheet(workbook,'POD明细'),notPod:addDetailSheet(workbook,'未POD明细'),delivering:addDetailSheet(workbook,'分配派送中明细'),pending:addDetailSheet(workbook,'Pending明细'),returned:addDetailSheet(workbook,'退回明细')};writeDashboard(dashboard,businessType,range,stats,lastRefreshAt);dashboard.commit();let completed=0;for(const row of rows){const values=outputRow(row);writeDetailRow(sheets.all,values);if(row.area==='金边')writeDetailRow(sheets.pp,values);else if(row.area==='门店')writeDetailRow(sheets.store,values);else writeDetailRow(sheets.pv,values);if(row.pod)writeDetailRow(sheets.pod,values);else writeDetailRow(sheets.notPod,values);if(row.delivering)writeDetailRow(sheets.delivering,values);if(row.pending)writeDetailRow(sheets.pending,values);if(row.returned)writeDetailRow(sheets.returned,values);completed++;if(completed%500===0||completed===rows.length)onProgress({phase:'writing',completed,total:rows.length,entries:rows.length});}Object.values(sheets).forEach(s=>s.commit());await workbook.commit();return{file:filePath,summary:{type:businessType,total:stats.overall.total,pod:stats.overall.pod,notPod:stats.overall.notPod,podRate:Number((rate(stats.overall.pod,stats.overall.total)*100).toFixed(2)),attempt1:stats.overall.attempt1,attempt2:stats.overall.attempt2,attempt3:stats.overall.attempt3,attemptUnknown:stats.overall.attemptUnknown,firstAttemptRate:Number((rate(stats.overall.attempt1,stats.overall.total)*100).toFixed(2)),evidenceCoverage:Number((rate(stats.overall.evidence,stats.overall.total)*100).toFixed(2)),pp:stats.overall.pp,pv:stats.overall.pv,store:stats.overall.store,returned:stats.overall.returned,pending:stats.overall.pending,delivering:stats.overall.delivering,cancelled:stats.overall.cancelled,lastCurrentStatusAt:lastRefreshAt,engine:VERSION,truthEngine:V191_SHOPEE_TRUTH_VERSION,statusSource:'VALID_SOURCE_PLUS_CROSS_DAY_PERSISTED_TRUTH',outputContract:'LEGACY_10_SHEETS_V191_TRUTH'}};}
export const V191_SHOPEE_EXPORT_VERSION=VERSION;
