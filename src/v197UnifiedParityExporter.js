import path from 'node:path';
import ExcelJS from 'exceljs';
import { getDb } from './db.js';
import { loadLightweightUnifiedBusinessState } from './lightweightDashboardStore.js';
import { collectShopeeShipmentTruth } from './v191ShopeeTruth.js';
import { listCompletedWhppSnapshots } from './v87WhppExportStore.js';

export const V197_PARITY_EXPORT_VERSION = '2026-08-18-v197-unified-parity-dashboard-v1';
const FONT_NAME = 'Microsoft YaHei';
const TYPES = new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);
const CCSL_TYPES = new Set(['CE','CEAF','TBKH','ALI1688']);
const DETAIL_HEADERS = [
  '首次日报日期','运单编号','下单时间','状态标识','状态说明','收件省份','区域分类','门店标识','当前门店','当前省份',
  '收件人','收件人手机','收件地址','POD/签收时间','签收天数','派次','派次口径','派次证据','轨迹派次证据',
  '派件门店','派件省份','派件快递员','异常编码','异常描述','数据证据','备注'
];
const DETAIL_WIDTHS = [14,24,21,11,18,16,12,10,22,16,18,17,42,21,10,10,24,28,20,20,16,18,12,28,34,42];

function safeJson(value, fallback = {}) { try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); } catch { return fallback; } }
function normalizeBill(value = '') { return String(value || '').trim().toUpperCase(); }
function normalizeHeader(value = '') { return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]+/g, ''); }
function dateKey(value = '') { const m = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; }
function dayNumber(value = '') { const k = dateKey(value); if (!k) return null; const [y,m,d] = k.split('-').map(Number); return Date.UTC(y,m-1,d); }
function naturalDays(from, to) { const a=dayNumber(from),b=dayNumber(to); if(a===null||b===null||b<a)return 0; return Math.floor((b-a)/86400000)+1; }
function rate(a,b){ return b ? Number(a||0)/Number(b) : 0; }
function avg(values=[]){ const nums=values.map(Number).filter(v=>Number.isFinite(v)&&v>0); return nums.length ? Number((nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(2)) : 0; }
function safeFileName(value=''){ return String(value||'').replace(/[\\/:*?"<>|]/g,'_').replace(/\s+/g,' ').trim(); }
function displayType(type){ return ({SHOPEECN:'SHOPEE CN',SHOPEEVN:'SHOPEE VN'})[type] || type; }
function periodLabel(periodType='custom'){ return ({daily:'日报',weekly:'周报',monthly:'月报',custom:'自定义日期'})[periodType] || '区间报表'; }
function listDates(from,to){ const a=dayNumber(from),b=dayNumber(to); if(a===null||b===null||b<a)return[]; const out=[]; for(let t=a;t<=b;t+=86400000)out.push(new Date(t).toISOString().slice(0,10)); return out; }
function firstValue(row={}, keys=[]){ for(const key of keys){const v=row?.[key];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;} return ''; }
function rawMap(rowJson){ const parsed=safeJson(rowJson,{}); const raw=parsed?.raw&&typeof parsed.raw==='object'?parsed.raw:{}; const map=new Map(); for(const[k,v]of Object.entries(raw))map.set(normalizeHeader(k),v); return {parsed,map}; }
function valueByAliases(map, aliases=[]){ for(const alias of aliases){const k=normalizeHeader(alias);if(!map.has(k))continue;const v=map.get(k);if(v!==undefined&&v!==null&&String(v).trim()!=='')return String(v).trim();} return ''; }
function isPodRow(row={}){ return row.是否POD==='是'||Number(row.isPod||0)===1||String(row.orderStatus||'')==='85'||String(row.currentState||row.scanNormalizedState||row.POD状态||'').toUpperCase()==='POD'; }
function isReturnedRow(row={}){ const text=[row.currentState,row.returnState,row.退回状态,row.currentMainCategory,row.primaryCategory,row.主分类,row.异常分类,row.category].join(' ').toUpperCase(); return /RETURN_COMPLETED|RETURNED|退回|退件/.test(text); }
function isPendingRow(row={}){ const text=[row.currentState,row.currentMainCategory,row.primaryCategory,row.主分类,row.异常分类,row.category,row.状态说明].join(' ').toUpperCase(); return Number(row.Pending次数||row.Pending当前次数||row.pendingCount||0)>0 || /PENDING/.test(text); }
function isDeliveringRow(row={}){ const text=[row.currentState,row.currentMainCategory,row.primaryCategory,row.主分类,row.异常分类,row.category,row.状态说明].join(' ').toUpperCase(); return Number(row.派送中停留天数||0)>0 || /DELIVERING|OUT FOR DELIVERY|派送中|分配派送/.test(text); }
function isStoreLocation(row={}){ const text=[row.currentShop,row.currentStore,row.currentShopCode,row.targetShopCode,row.deliveryShop,row.当前门店,row.派件门店,row.shopName].filter(Boolean).join(' '); return /(?:^|\b)(?:CP|FS)\d*[A-Z0-9_-]*\b|\bSHOP\b|CO[-\s]?SHOP|PT[-\s]?SHOP/i.test(text); }
function areaOf(row={}){
  const raw=String(row.regionCode||row.region_code||row.区域||row.区域分类||row.regionType||'').trim().toUpperCase();
  if(raw.startsWith('PP')||raw==='PHNOM_PENH'||/金边|PHNOM\s*PENH/.test(raw))return '金边';
  if(raw.startsWith('PV')||raw==='PROVINCE'||/外省/.test(raw))return '外省';
  const province=String(row.recipientProvince||row.收件省份||row.province||'').trim();
  if(/金边|PHNOM\s*PENH/i.test(province))return '金边';
  if(province)return '外省';
  return '未识别';
}
function attemptFromDays(days){ return days===1?1:days===2?2:days>=3?3:0; }
function attemptLabel(no){ return no===1?'1派':no===2?'2派':no>=3?'3派+':'未识别'; }
function normalizeStatusText(value=''){ return String(value||'').trim(); }

function latestValidBatches(db,from,to){
  const rows=db.prepare(`SELECT snapshotId,reportDate,createdAt,batchId FROM unified_import_batches WHERE status='VALID' AND reportDate BETWEEN ? AND ? ORDER BY reportDate ASC,createdAt DESC,batchId DESC`).all(from,to);
  const byDate=new Map();for(const row of rows)if(row.reportDate&&!byDate.has(row.reportDate))byDate.set(row.reportDate,row);
  return [...byDate.values()].sort((a,b)=>String(a.reportDate).localeCompare(String(b.reportDate)));
}
function latestCompletedBatches(db,from,to){
  const rows=db.prepare(`SELECT b.snapshotId,b.reportDate,b.createdAt,b.sourceName FROM unified_import_batches b INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.status='VALID' AND s.status='COMPLETED' AND b.reportDate BETWEEN ? AND ? ORDER BY b.reportDate ASC,b.createdAt DESC`).all(from,to);
  const byDate=new Map();for(const row of rows)if(row.reportDate&&!byDate.has(row.reportDate))byDate.set(row.reportDate,row);
  return [...byDate.values()].sort((a,b)=>String(a.reportDate).localeCompare(String(b.reportDate)));
}

function shopeeFirstReportRows(db,businessType,batches,onProgress=()=>{}){
  const stmt=db.prepare(`SELECT shipmentCode,regionCode,rowNumber,rowJson FROM unified_import_rows WHERE snapshotId=? AND businessType=? ORDER BY rowNumber,shipmentCode`);
  const byBill=new Map();
  for(let index=0;index<batches.length;index++){
    const batch=batches[index], reportDate=String(batch.reportDate||'');
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
        recipientPhone:valueByAliases(map,['收件人手机','收件人电话','收货人手机','收货人电话','手机号','手机号码','recipientphone','receiverphone']),
        recipientAddress:valueByAliases(map,['收件地址','收货地址','详细地址','地址','recipientaddress','receiveraddress']),
        rawDeliveryTime:valueByAliases(map,['派件时间','签收时间','POD时间','podtime','deliverytime']),deliveryShop:valueByAliases(map,['派件门店','派送门店','deliveryshop']),
        deliveryProvince:valueByAliases(map,['派件省份','派送省份','deliveryprovince']),courier:valueByAliases(map,['派件快递员','派送快递员','快递员','deliverycourier','courier']),
        exceptionCode:valueByAliases(map,['异常编码','异常代码','exceptioncode']),exceptionDesc:valueByAliases(map,['异常描述','异常说明','exceptiondesc','exceptiondescription']),
        remark:valueByAliases(map,['备注','remark','remarks','note'])
      });
    }
    onProgress({phase:'sourceRows',completed:index+1,total:Math.max(1,batches.length),entries:byBill.size});
  }
  return [...byBill.values()].sort((a,b)=>a.firstReportDate.localeCompare(b.firstReportDate)||a.rowNumber-b.rowNumber||a.shipmentCode.localeCompare(b.shipmentCode));
}

function applyShopeeTruth(row,truth={}){
  let status=normalizeStatusText(row.rawStatus).toUpperCase(), statusDesc=normalizeStatusText(row.rawStatusDesc), deliveryTime=normalizeStatusText(row.rawDeliveryTime);
  const next={...row};if(truth.eventNode)next.currentShop=truth.eventNode;
  if(truth.pod){status='Y';statusDesc='POD';if(truth.eventTime)deliveryTime=truth.eventTime;}
  else if(truth.returned){status='R';statusDesc='退回';}
  else if(truth.cancelled){status='N';statusDesc='订单取消';}
  else if(truth.pending){status='P';statusDesc=Number(truth.pendingCount||0)>0?`Pending（${Number(truth.pendingCount)}次）`:'Pending';}
  else if(truth.delivering){status='W';statusDesc='分配派送中';}
  const pod=Boolean(truth.pod)||status==='Y'||/\bPOD\b|签收|妥投/i.test(statusDesc);
  const returned=!pod&&(Boolean(truth.returned)||status==='R'||/RETURN|退回|退件/i.test(statusDesc));
  const cancelled=!pod&&!returned&&(Boolean(truth.cancelled)||status==='N'||/取消|CANCEL/i.test(statusDesc));
  const pending=!pod&&!returned&&!cancelled&&(Boolean(truth.pending)||status==='P'||/PENDING/i.test(statusDesc));
  const delivering=!pod&&!returned&&!cancelled&&!pending&&(Boolean(truth.delivering)||status==='W'||/派件|派送|DELIVER/i.test(statusDesc));
  const podDate=pod?dateKey(deliveryTime):'';
  const deliveryDays=podDate?naturalDays(next.firstReportDate,podDate):0;
  const attemptNo=pod?attemptFromDays(deliveryDays):0;
  const trackAttemptNo=pod?Number(truth.attemptNo||0):0;
  const evidence=(truth.evidenceSources||[]).join('+')||(truth.hasEvidence?'已识别':'日报字段');
  return {
    firstReportDate:next.firstReportDate,shipmentCode:next.shipmentCode,orderTime:next.orderTime,status,statusDesc,
    recipientProvince:next.recipientProvince,area:areaOf(next),isStore:isStoreLocation(next),currentShop:next.currentShop,currentProvince:next.currentProvince,
    recipient:next.recipient,recipientPhone:next.recipientPhone,recipientAddress:next.recipientAddress,deliveryTime,podDate,deliveryDays,attemptNo,
    attemptLabel:attemptLabel(attemptNo),attemptBasis:'日报日期→POD日期自然日（同日=1派、次日=2派、第3天及以后=3派+）',
    attemptEvidence:podDate?`${next.firstReportDate}→${podDate}=${deliveryDays}天`:'POD时间缺失',trackAttemptNo,trackAttemptSource:String(truth.attemptSource||''),
    deliveryShop:next.deliveryShop,deliveryProvince:next.deliveryProvince,courier:next.courier,exceptionCode:next.exceptionCode,
    exceptionDesc:next.exceptionDesc||String(truth.category||''),remark:next.remark,pod,returned,cancelled,pending,delivering,
    hasEvidence:Boolean(truth.hasEvidence)||Boolean(status),evidence
  };
}

async function gatherShopee(type,range,onProgress){
  const db=getDb();const batches=latestValidBatches(db,range.from,range.to);
  if(!batches.length)throw new Error(`${range.from} 至 ${range.to} 没有 VALID 日报。`);
  onProgress({phase:'start',completed:0,total:batches.length,entries:0});
  const source=shopeeFirstReportRows(db,type,batches,onProgress);
  if(!source.length)throw new Error(`${displayType(type)} 在 ${range.from} 至 ${range.to} 没有可导出的业务数据。`);
  const truth=collectShopeeShipmentTruth({db,businessType:type,bills:source.map(r=>r.shipmentCode)});
  const rows=source.map(row=>applyShopeeTruth(row,truth.get(row.shipmentCode)||{}));
  onProgress({phase:'truth',completed:rows.length,total:rows.length,entries:rows.filter(r=>r.hasEvidence).length});
  return rows;
}

function snapshotBaseEntry(row,reportDate,type,existing=null){
  const bill=normalizeBill(firstValue(row,['shipmentCode','运单号','waybill','billNo']));if(!bill)return existing;
  const latest = !existing || reportDate>=String(existing.lastReportDate||'');
  const base=existing||{
    firstReportDate:reportDate,lastReportDate:reportDate,shipmentCode:bill,orderTime:'',status:'',statusDesc:'',recipientProvince:'',area:'未识别',isStore:false,
    currentShop:'',currentProvince:'',recipient:'',recipientPhone:'',recipientAddress:'',deliveryTime:'',podDate:'',deliveryDays:0,attemptNo:0,attemptLabel:'未识别',
    attemptBasis:'日报日期→POD日期自然日（同日=1派、次日=2派、第3天及以后=3派+）',attemptEvidence:'',trackAttemptNo:0,trackAttemptSource:'',
    deliveryShop:'',deliveryProvince:'',courier:'',exceptionCode:'',exceptionDesc:'',remark:'',pod:false,returned:false,cancelled:false,pending:false,delivering:false,hasEvidence:false,evidence:''
  };
  if(reportDate<base.firstReportDate)base.firstReportDate=reportDate;
  if(latest){
    base.lastReportDate=reportDate;
    base.orderTime=String(firstValue(row,['orderTime','下单时间','createTime','createdTime'])||base.orderTime||'');
    base.status=String(firstValue(row,['状态标识','statusCode','orderStatus'])||base.status||'');
    base.statusDesc=String(firstValue(row,['状态说明','currentState','scanNormalizedState','currentMainCategory','primaryCategory','主分类','异常分类','category'])||base.statusDesc||'');
    base.recipientProvince=String(firstValue(row,['recipientProvince','收件省份','province','省份','收件省'])||base.recipientProvince||'');
    base.currentShop=String(firstValue(row,['currentStore','currentShop','currentShopCode','targetShopCode','当前门店','门店名称','shopName','matchedShopName'])||base.currentShop||'');
    base.currentProvince=String(firstValue(row,['currentProvince','当前省份','deliveryProvince','派件省份'])||base.currentProvince||'');
    base.recipient=String(firstValue(row,['recipient','收件人','recipient_normalized','recipientNormalized','recipient_raw','recipientRaw'])||base.recipient||'');
    base.recipientPhone=String(firstValue(row,['recipientPhone','收件人手机','收件人电话','receiverPhone'])||base.recipientPhone||'');
    base.recipientAddress=String(firstValue(row,['recipientAddress','收件地址','收货地址','receiverAddress'])||base.recipientAddress||'');
    base.deliveryShop=String(firstValue(row,['deliveryShop','派件门店','matchedShopName','shopName'])||base.deliveryShop||'');
    base.deliveryProvince=String(firstValue(row,['deliveryProvince','派件省份'])||base.deliveryProvince||'');
    base.courier=String(firstValue(row,['courier','派件快递员','eventCourier'])||base.courier||'');
    base.exceptionCode=String(firstValue(row,['exceptionCode','异常编码'])||base.exceptionCode||'');
    base.exceptionDesc=String(firstValue(row,['exceptionDesc','异常描述','currentMainCategory','primaryCategory','主分类','异常分类'])||base.exceptionDesc||'');
    base.remark=String(firstValue(row,['remark','备注','QC判断'])||base.remark||'');
    const regionCandidate={...row,recipientProvince:base.recipientProvince};base.area=areaOf(regionCandidate);base.isStore=isStoreLocation({...row,currentShop:base.currentShop,deliveryShop:base.deliveryShop});
    base.returned=!base.pod&&isReturnedRow(row);base.pending=!base.pod&&!base.returned&&isPendingRow(row);base.delivering=!base.pod&&!base.returned&&!base.pending&&isDeliveringRow(row);
    base.hasEvidence=true;base.evidence=String(firstValue(row,['analysisRuleVersion','factVersion','API状态','apiStatus'])||'已完成分析快照');
  }
  if(isPodRow(row)){
    base.pod=true;base.returned=false;base.pending=false;base.delivering=false;base.status='Y';base.statusDesc='POD';
    const actual=String(firstValue(row,['POD时间','podTime','terminalObservedAt','latestEventTime','最后节点时间'])||'').trim();
    if(actual){const actualDate=dateKey(actual);if(actualDate&&(!base.podDate||actualDate<base.podDate)){base.deliveryTime=actual;base.podDate=actualDate;}}
  }
  return base;
}

function fillPodLocks(rows,type){
  const db=getDb();const podRows=rows.filter(r=>r.pod);if(!podRows.length)return;
  const byBill=new Map(rows.map(r=>[r.shipmentCode,r]));const chunkSize=500;
  for(let offset=0;offset<podRows.length;offset+=chunkSize){
    const chunk=podRows.slice(offset,offset+chunkSize),codes=chunk.map(r=>r.shipmentCode),marks=codes.map(()=>'?').join(',');
    let locks=[];
    try{
      if(CCSL_TYPES.has(type))locks=db.prepare(`SELECT shipmentCode,podTime,source FROM pod_locks WHERE shipmentCode IN (${marks})`).all(...codes);
      else locks=db.prepare(`SELECT shipmentCode,podTime,source FROM business_pod_locks WHERE businessType=? AND shipmentCode IN (${marks})`).all(type,...codes);
    }catch{locks=[];}
    for(const lock of locks){const entry=byBill.get(normalizeBill(lock.shipmentCode));const d=dateKey(lock.podTime);if(entry&&d){entry.deliveryTime=String(lock.podTime||'');entry.podDate=d;entry.evidence=[entry.evidence,`POD锁:${lock.source||''}`].filter(Boolean).join('+');}}
  }
  for(const entry of podRows){
    entry.deliveryDays=entry.podDate?naturalDays(entry.firstReportDate,entry.podDate):0;
    entry.attemptNo=attemptFromDays(entry.deliveryDays);entry.attemptLabel=attemptLabel(entry.attemptNo);
    entry.attemptEvidence=entry.podDate?`${entry.firstReportDate}→${entry.podDate}=${entry.deliveryDays}天`:'POD时间缺失';
    entry.trackAttemptNo=Number(entry.trackAttemptNo||0);
  }
}

async function gatherCcsl(type,range,onProgress){
  const db=getDb(),batches=latestCompletedBatches(db,range.from,range.to);
  if(!batches.length)throw new Error(`${range.from} 至 ${range.to} 没有 VALID + COMPLETED 日快照。`);
  const map=new Map();onProgress({phase:'start',completed:0,total:batches.length,entries:0});
  for(let i=0;i<batches.length;i++){
    const batch=batches[i];const state=loadLightweightUnifiedBusinessState(type,batch.snapshotId,{includeHistory:false});
    for(const row of state.finalRows||[]){const bill=normalizeBill(firstValue(row,['shipmentCode','运单号']));if(!bill)continue;map.set(bill,snapshotBaseEntry(row,batch.reportDate,type,map.get(bill)||null));}
    onProgress({phase:'sourceRows',completed:i+1,total:batches.length,entries:map.size});
  }
  const rows=[...map.values()];if(!rows.length)throw new Error(`${displayType(type)} 在 ${range.from} 至 ${range.to} 没有可导出的业务数据。`);
  fillPodLocks(rows,type);onProgress({phase:'truth',completed:rows.length,total:rows.length,entries:rows.filter(r=>r.hasEvidence).length});return rows;
}

async function gatherWhpp(range,onProgress){
  const snapshots=listCompletedWhppSnapshots(range.from,range.to);if(!snapshots.length)throw new Error(`${range.from} 至 ${range.to} 没有 WHPP 已完成数据。`);
  const map=new Map();onProgress({phase:'start',completed:0,total:snapshots.length,entries:0});
  for(let i=0;i<snapshots.length;i++){
    const snapshot=snapshots[i];for(const row of snapshot.payload?.finalRows||[]){const bill=normalizeBill(firstValue(row,['shipmentCode','运单号']));if(!bill)continue;map.set(bill,snapshotBaseEntry(row,snapshot.reportDate,'WHPP',map.get(bill)||null));}
    onProgress({phase:'sourceRows',completed:i+1,total:snapshots.length,entries:map.size});
  }
  const rows=[...map.values()];fillPodLocks(rows,'WHPP');onProgress({phase:'truth',completed:rows.length,total:rows.length,entries:rows.filter(r=>r.hasEvidence).length});return rows;
}

function emptyStat(date){return{date,total:0,pp:0,pv:0,unknownRegion:0,store:0,pod:0,notPod:0,returned:0,pending:0,delivering:0,a1:0,a2:0,a3:0,attemptUnknown:0,days:[],ppPod:0,ppA1:0,ppA2:0,ppA3:0,ppAttemptUnknown:0,ppDays:[],pvPod:0,pvA1:0,pvA2:0,pvA3:0,pvAttemptUnknown:0,pvDays:[],evidence:0};}
function applyStat(stat,row){
  stat.total++;if(row.area==='金边')stat.pp++;else if(row.area==='外省')stat.pv++;else stat.unknownRegion++;if(row.isStore)stat.store++;if(row.hasEvidence)stat.evidence++;
  if(row.pod){
    stat.pod++;const d=Number(row.deliveryDays||0);if(d>0)stat.days.push(d);if(row.attemptNo===1)stat.a1++;else if(row.attemptNo===2)stat.a2++;else if(row.attemptNo>=3)stat.a3++;else stat.attemptUnknown++;
    if(row.area==='金边'){stat.ppPod++;if(d>0)stat.ppDays.push(d);if(row.attemptNo===1)stat.ppA1++;else if(row.attemptNo===2)stat.ppA2++;else if(row.attemptNo>=3)stat.ppA3++;else stat.ppAttemptUnknown++;}
    if(row.area==='外省'){stat.pvPod++;if(d>0)stat.pvDays.push(d);if(row.attemptNo===1)stat.pvA1++;else if(row.attemptNo===2)stat.pvA2++;else if(row.attemptNo>=3)stat.pvA3++;else stat.pvAttemptUnknown++;}
  }
  if(row.returned)stat.returned++;if(row.pending)stat.pending++;if(row.delivering)stat.delivering++;
}
export function buildParityStats(rows,range){
  const days=new Map(listDates(range.from,range.to).map(d=>[d,emptyStat(d)])),overall=emptyStat('TOTAL');
  for(const row of rows){if(!days.has(row.firstReportDate))days.set(row.firstReportDate,emptyStat(row.firstReportDate));applyStat(days.get(row.firstReportDate),row);applyStat(overall,row);}
  for(const stat of [...days.values(),overall])stat.notPod=Math.max(0,stat.total-stat.pod);
  return {daily:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)),overall};
}
export function assertParityReconciliation(stats){
  const checks=[];for(const s of [...stats.daily,stats.overall]){
    checks.push([`${s.date}:区域`,s.total,s.pp+s.pv+s.unknownRegion]);
    checks.push([`${s.date}:派次`,s.pod,s.a1+s.a2+s.a3+s.attemptUnknown]);
    checks.push([`${s.date}:金边派次`,s.ppPod,s.ppA1+s.ppA2+s.ppA3+s.ppAttemptUnknown]);
    checks.push([`${s.date}:外省派次`,s.pvPod,s.pvA1+s.pvA2+s.pvA3+s.pvAttemptUnknown]);
  }
  const failed=checks.filter(([,a,b])=>a!==b);if(failed.length)throw new Error(`V197报表对账失败：${failed.slice(0,5).map(([k,a,b])=>`${k} ${a}!=${b}`).join('；')}`);
  return {passed:true,checks:checks.length};
}

function detailValues(row){return[
  row.firstReportDate,row.shipmentCode,row.orderTime,row.status,row.statusDesc,row.recipientProvince,row.area,row.isStore?'门店':'否',row.currentShop,row.currentProvince,
  row.recipient,row.recipientPhone,row.recipientAddress,row.deliveryTime,row.deliveryDays||'',row.attemptLabel,row.attemptBasis,row.attemptEvidence,
  row.trackAttemptNo?`${row.trackAttemptNo}派${row.trackAttemptSource?`（${row.trackAttemptSource}）`:''}`:'',row.deliveryShop,row.deliveryProvince,row.courier,
  row.exceptionCode,row.exceptionDesc,row.evidence,row.remark
];}
function styleHeader(row){row.height=25;row.eachCell(cell=>{cell.font={name:FONT_NAME,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF195A8D'}};cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};cell.border={top:{style:'thin',color:{argb:'FFD6E3EF'}},bottom:{style:'thin',color:{argb:'FFD6E3EF'}},left:{style:'thin',color:{argb:'FFD6E3EF'}},right:{style:'thin',color:{argb:'FFD6E3EF'}}};});}
function styleBody(row,index){row.eachCell((cell,col)=>{cell.font={name:FONT_NAME,size:10,color:{argb:'FF18324F'}};cell.alignment={vertical:'middle',horizontal:col<=10?'center':'left',wrapText:col>=11};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:index%2?'FFF8FBFF':'FFFFFFFF'}};});}
function addDetailSheet(workbook,name,rows){
  const sheet=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]});sheet.columns=DETAIL_HEADERS.map((header,i)=>({header,width:DETAIL_WIDTHS[i]}));styleHeader(sheet.getRow(1));sheet.autoFilter={from:'A1',to:'Z1'};
  const anchors=new Map();let n=2;for(let i=0;i<rows.length;i++){const item=rows[i];if(item.firstReportDate&&!anchors.has(item.firstReportDate))anchors.set(item.firstReportDate,n);const r=sheet.addRow(detailValues(item));styleBody(r,i);r.commit();n++;}sheet.commit();return anchors;
}
function bucketRows(rows){
  const sorted=[...rows].sort((a,b)=>a.firstReportDate.localeCompare(b.firstReportDate)||a.shipmentCode.localeCompare(b.shipmentCode));
  const f=fn=>sorted.filter(fn);return {
    '全部明细':sorted,'金边明细':f(r=>r.area==='金边'),'外省明细':f(r=>r.area==='外省'),'门店明细':f(r=>r.isStore),'POD明细':f(r=>r.pod),
    '1派明细':f(r=>r.pod&&r.attemptNo===1),'2派明细':f(r=>r.pod&&r.attemptNo===2),'3派+明细':f(r=>r.pod&&r.attemptNo>=3),'派次未识别':f(r=>r.pod&&!r.attemptNo),
    '金边1派':f(r=>r.area==='金边'&&r.pod&&r.attemptNo===1),'金边2派':f(r=>r.area==='金边'&&r.pod&&r.attemptNo===2),'金边3派+':f(r=>r.area==='金边'&&r.pod&&r.attemptNo>=3),
    '外省1派':f(r=>r.area==='外省'&&r.pod&&r.attemptNo===1),'外省2派':f(r=>r.area==='外省'&&r.pod&&r.attemptNo===2),'外省3派+':f(r=>r.area==='外省'&&r.pod&&r.attemptNo>=3),
    '未POD明细':f(r=>!r.pod),'分配派送中明细':f(r=>r.delivering),'Pending明细':f(r=>r.pending),'退回明细':f(r=>r.returned)
  };
}
function anchor(anchors,name,date){return anchors[name]?.get(date)||2;}
function linkValue(text,name,row=2){return{text:String(text),hyperlink:`#'${name}'!A${row}`};}
function numFmt(cell,fmt){cell.numFmt=fmt;}
function cellStyle(cell,{bold=false,size=10,color='FF18324F',fill='FFFFFFFF',center=true}={}){cell.font={name:FONT_NAME,bold,size,color:{argb:color}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:fill}};cell.alignment={horizontal:center?'center':'left',vertical:'middle',wrapText:true};cell.border={top:{style:'thin',color:{argb:'FFD6E3EF'}},bottom:{style:'thin',color:{argb:'FFD6E3EF'}},left:{style:'thin',color:{argb:'FFD6E3EF'}},right:{style:'thin',color:{argb:'FFD6E3EF'}}};}
function writeCard(sheet,col,label,value,note,target){const letters=['A','C','E','G','I','K','M','O','Q','S'];const c=letters[col]||'A';const c2=String.fromCharCode(c.charCodeAt(0)+1);sheet.mergeCells(`${c}3:${c2}3`);sheet.mergeCells(`${c}4:${c2}4`);sheet.mergeCells(`${c}5:${c2}5`);const a=sheet.getCell(`${c}3`),b=sheet.getCell(`${c}4`),d=sheet.getCell(`${c}5`);a.value=label;b.value=target?linkValue(value,target):value;d.value=note;cellStyle(a,{bold:true,size:11,fill:'FFEAF3FA'});cellStyle(b,{bold:true,size:16,color:'FF0B5EA8'});cellStyle(d,{size:9,color:'FF657B95'});}
function fmtAvg(values){return values.length?`${avg(values).toFixed(2)}天`:'—';}
function pct(a,b){return b?`${(rate(a,b)*100).toFixed(2)}%`:'—';}
function writeDashboard(workbook,type,range,stats,anchors){
  const sheet=workbook.addWorksheet('每日看板',{views:[{state:'frozen',ySplit:9,xSplit:1}]});sheet.columns=Array.from({length:37},(_,i)=>({width:i===0?14:(i===12||i===21||i===30?14:12)}));
  sheet.mergeCells('A1:AK1');const title=sheet.getCell('A1');title.value=`${displayType(type)} 每日数据看板（${range.from} 至 ${range.to}）`;title.font={name:FONT_NAME,bold:true,size:18,color:{argb:'FF17365D'}};title.alignment={horizontal:'center',vertical:'middle'};sheet.getRow(1).height=30;
  const o=stats.overall;writeCard(sheet,0,'总票数',o.total,`${o.pp}金边 / ${o.pv}外省${o.unknownRegion?` / ${o.unknownRegion}未识别`:''}`,'全部明细');writeCard(sheet,1,'POD票数',o.pod,pct(o.pod,o.total),'POD明细');writeCard(sheet,2,'1派POD',o.a1,pct(o.a1,o.pod),'1派明细');writeCard(sheet,3,'2派POD',o.a2,pct(o.a2,o.pod),'2派明细');writeCard(sheet,4,'3派+POD',o.a3,pct(o.a3,o.pod),'3派+明细');writeCard(sheet,5,'总平均签收',fmtAvg(o.days),`有效样本 ${o.days.length}/${o.pod}`,'POD明细');writeCard(sheet,6,'金边平均签收',fmtAvg(o.ppDays),`${o.ppPod}/${o.pp} POD`,'金边明细');writeCard(sheet,7,'外省平均签收',fmtAvg(o.pvDays),`${o.pvPod}/${o.pv} POD`,'外省明细');writeCard(sheet,8,'派次未识别',o.attemptUnknown,`仅POD时间缺失时进入`,'派次未识别');writeCard(sheet,9,'门店票数',o.store,'门店为位置维度，不从PP/PV剔除','门店明细');
  const headers=['日期','总票数','金边','外省','POD','POD率','1派POD','1派占POD','2派POD','2派占POD','3派+POD','3派+占POD','总平均天数','金边POD','金边POD率','金边1派','金边1派占POD','金边2派','金边2派占POD','金边3派+','金边3派+占POD','金边平均天数','外省POD','外省POD率','外省1派','外省1派占POD','外省2派','外省2派占POD','外省3派+','外省3派+占POD','外省平均天数','门店','Pending','派送中','退回','未POD','状态覆盖率'];
  const hr=sheet.getRow(9);headers.forEach((h,i)=>hr.getCell(i+1).value=h);styleHeader(hr);
  let r=10;for(const d of stats.daily){const vals=[d.date,d.total,d.pp,d.pv,d.pod,rate(d.pod,d.total),d.a1,rate(d.a1,d.pod),d.a2,rate(d.a2,d.pod),d.a3,rate(d.a3,d.pod),d.days.length?avg(d.days):'',d.ppPod,rate(d.ppPod,d.pp),d.ppA1,rate(d.ppA1,d.ppPod),d.ppA2,rate(d.ppA2,d.ppPod),d.ppA3,rate(d.ppA3,d.ppPod),d.ppDays.length?avg(d.ppDays):'',d.pvPod,rate(d.pvPod,d.pv),d.pvA1,rate(d.pvA1,d.pvPod),d.pvA2,rate(d.pvA2,d.pvPod),d.pvA3,rate(d.pvA3,d.pvPod),d.pvDays.length?avg(d.pvDays):'',d.store,d.pending,d.delivering,d.returned,d.notPod,rate(d.evidence,d.total)];vals.forEach((v,i)=>{const c=sheet.getCell(r,i+1);c.value=v;cellStyle(c,{fill:r%2?'FFF8FBFF':'FFFFFFFF'});});for(const c of[6,8,10,12,15,17,19,21,24,26,28,30,37])numFmt(sheet.getCell(r,c),'0.00%');for(const c of[13,22,31])numFmt(sheet.getCell(r,c),'0.00');
    const links=[[2,'全部明细'],[3,'金边明细'],[4,'外省明细'],[5,'POD明细'],[7,'1派明细'],[9,'2派明细'],[11,'3派+明细'],[14,'金边明细'],[16,'金边1派'],[18,'金边2派'],[20,'金边3派+'],[23,'外省明细'],[25,'外省1派'],[27,'外省2派'],[29,'外省3派+'],[32,'门店明细'],[33,'Pending明细'],[34,'分配派送中明细'],[35,'退回明细'],[36,'未POD明细']];for(const [col,name] of links){const c=sheet.getCell(r,col);c.value=linkValue(vals[col-1],name,anchor(anchors,name,d.date));c.font={name:FONT_NAME,color:{argb:'FF0563C1'},underline:true};c.alignment={horizontal:'center',vertical:'middle'};}
    r++;}
  const noteRow=r+1;sheet.mergeCells(`A${noteRow}:AK${noteRow}`);sheet.getCell(`A${noteRow}`).value='派次统一口径：首次日报日期→POD日期自然日；同日=1派、次日=2派、第3天及以后=3派+。金边/外省按收件区域拆分；门店是当前位置维度，不从PP/PV剔除。平均签收天数只使用有真实POD日期的样本。';sheet.getCell(`A${noteRow}`).font={name:FONT_NAME,color:{argb:'FF657B95'},size:10};sheet.getCell(`A${noteRow}`).alignment={wrapText:true};sheet.getRow(noteRow).height=32;sheet.commit();
}

export async function createUnifiedParityWorkbook({type,periodType='custom',range,outputDir,onProgress=()=>{}}){
  const businessType=String(type||'').trim().toUpperCase();if(!TYPES.has(businessType))throw new Error(`V197不支持业务类型：${businessType||'空'}`);
  let rows=[];if(SHOPEE_TYPES.has(businessType))rows=await gatherShopee(businessType,range,onProgress);else if(businessType==='WHPP')rows=await gatherWhpp(range,onProgress);else rows=await gatherCcsl(businessType,range,onProgress);
  rows=rows.filter(r=>r&&r.shipmentCode&&r.firstReportDate).sort((a,b)=>a.firstReportDate.localeCompare(b.firstReportDate)||a.shipmentCode.localeCompare(b.shipmentCode));
  const stats=buildParityStats(rows,range);const reconciliation=assertParityReconciliation(stats);const buckets=bucketRows(rows);
  const fileName=safeFileName(`${displayType(businessType)}_${periodLabel(periodType)}_一比一完整数据看板_${range.from}_至_${range.to}_V197.xlsx`),filePath=path.join(outputDir,fileName);
  const workbook=new ExcelJS.stream.xlsx.WorkbookWriter({filename:filePath,useStyles:true,useSharedStrings:false});workbook.creator='CE Express QC';workbook.created=new Date();
  const anchors={};const sheetOrder=['全部明细','金边明细','外省明细','门店明细','POD明细','1派明细','2派明细','3派+明细','派次未识别','金边1派','金边2派','金边3派+','外省1派','外省2派','外省3派+','未POD明细','分配派送中明细','Pending明细','退回明细'];
  // Dashboard is created first so it remains the first visible tab; detail anchors are deterministic because rows are already sorted.
  const anchorPlan={};for(const name of sheetOrder){anchorPlan[name]=new Map();let rr=2;for(const item of buckets[name]){if(item.firstReportDate&&!anchorPlan[name].has(item.firstReportDate))anchorPlan[name].set(item.firstReportDate,rr);rr++;}}
  writeDashboard(workbook,businessType,range,stats,anchorPlan);let completed=0;for(const name of sheetOrder){anchors[name]=addDetailSheet(workbook,name,buckets[name]);completed++;onProgress({phase:'writing',completed,total:sheetOrder.length,entries:rows.length,sheet:name});}
  await workbook.commit();
  return {file:filePath,summary:{type:businessType,total:stats.overall.total,pod:stats.overall.pod,notPod:stats.overall.notPod,podRate:Number((rate(stats.overall.pod,stats.overall.total)*100).toFixed(2)),attempt1:stats.overall.a1,attempt2:stats.overall.a2,attempt3:stats.overall.a3,attemptUnknown:stats.overall.attemptUnknown,pp:stats.overall.pp,pv:stats.overall.pv,unknownRegion:stats.overall.unknownRegion,ppPod:stats.overall.ppPod,pvPod:stats.overall.pvPod,avgDays:avg(stats.overall.days),ppAvgDays:avg(stats.overall.ppDays),pvAvgDays:avg(stats.overall.pvDays),validTimeSamples:stats.overall.days.length,store:stats.overall.store,reconciliation,engine:V197_PARITY_EXPORT_VERSION,attemptRule:'REPORT_DATE_TO_POD_NATURAL_DAY',outputContract:'V197_UNIFIED_1TO1_PARITY_20_SHEETS'}};
}
