import { getDb } from './db.js';
import { collectV200Rows } from './v200EvidenceData.js';

export const V205_CANONICAL_TRUTH_VERSION = '2026-08-18-v205-canonical-membership-family-evidence-truth-v1';

const TYPES = new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const CCSL_TYPES = new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);
const POD_RE = /\bPOD\b|DELIVERED|签收|妥投|已妥投|SUCCESSFULLY\s*DELIVERED|4004/i;
const RETURN_RE = /RETURN(?:ED|_COMPLETED)?|退回完成|已退回|退件完成|R退回|P4008/i;
const CANCEL_RE = /ORDER_CANCELLED|CANCELLED|CANCELED|订单取消|已取消|取消订单/i;
const PENDING_RE = /\bPENDING\b|派送失败|无法联系|无人接听|地址错误|\b150\b/i;
const DELIVERY_RE = /PARCEL\s*START\s*TO\s*DELIVER|OUT\s*FOR\s*DELIVERY|派送中|派件中|正在为您派送|正在派送|DELIVER\s*TO\s*BUYER|\b4003\b/i;
const ASSIGN_RE = /ASSIGNING\s*COURIER|COURIER\s*ASSIGN|DELIVERY\s*ASSIGN|派件分配|分配快递员|分配派送|即将为您派送/i;
const STORE_RE = /(?:^|\b)(?:CP|FS)\d*[A-Z0-9_-]*\b|\bSHOP\b|CO[-\s]?SHOP|PT[-\s]?SHOP|门店|加盟店/i;
const MANUAL_REVIEW_RE = /需人工复核|人工复核|待人工|MANUAL\s*REVIEW/i;

function safeJson(value, fallback = {}) { if (value && typeof value === 'object') return value; try { return JSON.parse(String(value || '')) || fallback; } catch { return fallback; } }
function billOf(value = '') { return String(value || '').trim().toUpperCase(); }
function keyOf(value = '') { return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]+/g,''); }
function dateKey(value = '') { const m=String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/); return m?`${m[1]}-${m[2]}-${m[3]}`:''; }
function chunks(values = [], size = 220) { const out=[]; for(let i=0;i<values.length;i+=size) out.push(values.slice(i,i+size)); return out; }
function textOf(raw = {}) { return [raw.eventCode,raw.trackingEventCode,raw.statusCode,raw.shipmentStatus,raw.status,raw.statusText,raw.trackingEventDescZh,raw.trackingEventDesc,raw.trackingEventDescKm,raw.remark,raw.place,raw.eventShop,raw.locationCode,raw.latestEventDesc,raw.最后节点,raw.primaryCategory,raw.currentMainCategory,raw.主分类,raw.异常分类].map(v=>String(v||'').trim()).filter(Boolean).join(' '); }
function eventRaw(row = {}) { const raw=safeJson(row.rawJson,{}); return {...raw,...row}; }
function eventCode(row = {}) { const raw=eventRaw(row); return String(row.eventCode||row.shipmentStatus||raw.eventCode||raw.trackingEventCode||raw.statusCode||raw.shipmentStatus||raw.status||'').trim(); }
function eventTime(row = {}) { const raw=eventRaw(row); return String(row.eventTime||raw.eventTime||raw.creationDate||raw.lastUpdateDate||row.updatedAt||row.createdAt||'').trim(); }
function eventText(row = {}) { return textOf(eventRaw(row)); }
function familyOf(type='') { return SHOPEE_TYPES.has(type)?'SHOPEE':CCSL_TYPES.has(type)?'CCSL':type; }
function allowedEvidenceType(requested='', stored='') { const s=String(stored||'').toUpperCase(); return !s || s===requested || s===familyOf(requested); }
function firstValue(objects = [], keys = []) { for (const object of objects) { if(!object||typeof object!=='object') continue; for(const key of keys){const value=object[key]; if(value!==undefined&&value!==null&&String(value).trim()!=='') return String(value).trim();} } return ''; }
function parseMembership(rowJson = {}) { const parsed=safeJson(rowJson,{}); const raw=parsed?.raw&&typeof parsed.raw==='object'?parsed.raw:parsed; const map=new Map(Object.entries(raw||{}).map(([k,v])=>[keyOf(k),v])); const get=aliases=>{for(const alias of aliases){const value=map.get(keyOf(alias));if(value!==undefined&&value!==null&&String(value).trim()!=='')return String(value).trim();}return '';}; return {parsed,raw,get}; }
function areaOf(regionCode='',province=''){const code=String(regionCode||'').toUpperCase(),p=String(province||'');if(/\bPP\b|PNH|PHNOM\s*PENH|金边/.test(`${code} ${p}`))return'金边';if(/\bPV\b|PROVINCE|省/.test(code)||p)return'外省';return'未识别';}
function meaningfulDesc(value=''){const text=String(value||'').trim();return text&&!MANUAL_REVIEW_RE.test(text)?text:'';}
function appendRemark(existing='',addition=''){const a=String(existing||'').trim(),b=String(addition||'').trim();if(!b)return a;if(a.includes(b))return a;return [a,b].filter(Boolean).join('；').slice(0,600);}

function minimalRow(type, source={}){
  const {parsed,get}=parseMembership(source.rowJson);
  const statusCode=get(['状态标识','状态代码','status','statuscode']).toUpperCase();
  const rawDesc=get(['状态说明','状态描述','statusdesc','statusdescription','statusname']);
  const province=get(['收件省份','目的省份','目的地省份','收货省份','receiverprovince','destinationprovince']);
  const region=String(source.regionCode||parsed.regionCode||'');
  const returned=statusCode==='R'||RETURN_RE.test(rawDesc);
  const cancelled=CANCEL_RE.test(rawDesc);
  const pending=!returned&&!cancelled&&(statusCode==='P'||PENDING_RE.test(rawDesc));
  const delivering=!returned&&!cancelled&&!pending&&(statusCode==='W'||statusCode==='Y'||DELIVERY_RE.test(rawDesc)||ASSIGN_RE.test(rawDesc));
  return {
    shipmentCode:billOf(source.shipmentCode),businessType:type,firstReportDate:source.reportDate,lastReportDate:source.reportDate,
    orderTime:get(['下单时间','下单日期','订单时间','订单日期','ordertime','orderdate']),rawDeliveryTime:get(['派件时间','签收时间','POD时间','deliverytime','podtime','deliveredat']),
    statusCode,statusDesc:meaningfulDesc(rawDesc)||fallbackDailyStatus(statusCode),regionCode:region,recipientProvince:province,area:areaOf(region,province),
    currentShop:get(['当前门店','当前网点','当前站点','currentshop','currentsite']),currentProvince:get(['当前省份','所在省份','currentprovince']),
    recipient:String(source.recipientNormalized||source.recipientRaw||get(['收件人','收货人','recipient','receiver','consignee'])||''),recipientPhone:get(['收件人手机','收件人电话','收货人手机','收货人电话','手机号','receiverphone']),recipientAddress:get(['收件地址','收货地址','详细地址','地址','receiveraddress']),
    deliveryShop:get(['派件门店','派送门店','deliveryshop']),deliveryProvince:get(['派件省份','派送省份','deliveryprovince']),courier:get(['派件快递员','派送快递员','快递员','deliverycourier','courier']),
    exceptionCode:get(['异常编码','异常代码','exceptioncode']),exceptionDesc:get(['异常描述','异常说明','exceptiondesc','exceptiondescription']),remark:get(['备注','remark','remarks','note']),
    pod:false,returned,cancelled,terminalNormal:returned||cancelled,openUnpod:!returned&&!cancelled,pending,delivering,store:STORE_RE.test(`${get(['当前门店','当前网点','当前站点','currentshop','currentsite'])} ${get(['派件门店','派送门店','deliveryshop'])}`),
    podTime:'',podDate:'',podSource:'',podPriority:99,podAttemptNo:0,currentAttemptNo:0,historyAttemptNo:0,trackAttemptNo:0,attemptNo:0,attemptSource:'',deliveryDays:0,
    metricEligible:true,sourceOrigin:'DAILY_CANONICAL_UNION',membershipSeenCount:0,membershipSnapshotCount:0,evidenceCoverage:'DAILY_ONLY',latestEventTime:'',latestEventDesc:'',dataIntegrityReview:false
  };
}
function fallbackDailyStatus(code=''){const c=String(code||'').toUpperCase();if(c==='P')return'Pending（日报状态，等待/使用轨迹确认）';if(c==='W'||c==='Y')return'派送中（日报状态，等待/使用轨迹确认）';if(c==='R')return'退回';return'';}
function mergeMembershipField(row, source){
  const {parsed,get}=parseMembership(source.rowJson); const sourceKey=`${source.reportDate}|${source.batchCreatedAt||''}|${source.batchId||''}|${String(source.rowNumber||0).padStart(8,'0')}`;
  row.membershipSeenCount=Number(row.membershipSeenCount||0)+1; row._membershipSnapshots=row._membershipSnapshots||new Set(); if(source.snapshotId)row._membershipSnapshots.add(source.snapshotId);
  if(!row.firstReportDate||source.reportDate<row.firstReportDate)row.firstReportDate=source.reportDate; if(!row.lastReportDate||source.reportDate>row.lastReportDate)row.lastReportDate=source.reportDate;
  if(!row.orderTime)row.orderTime=get(['下单时间','下单日期','订单时间','订单日期','ordertime','orderdate']);
  if(!row.recipientProvince)row.recipientProvince=get(['收件省份','目的省份','目的地省份','收货省份','receiverprovince','destinationprovince']);
  if(!row.regionCode)row.regionCode=String(source.regionCode||parsed.regionCode||'');
  if(!row.recipient)row.recipient=String(source.recipientNormalized||source.recipientRaw||get(['收件人','收货人','recipient','receiver','consignee'])||'');
  if(!row.recipientPhone)row.recipientPhone=get(['收件人手机','收件人电话','收货人手机','收货人电话','手机号','receiverphone']);
  if(!row.recipientAddress)row.recipientAddress=get(['收件地址','收货地址','详细地址','地址','receiveraddress']);
  if(!row._membershipLatestKey||sourceKey>=row._membershipLatestKey){
    row._membershipLatestKey=sourceKey;const code=get(['状态标识','状态代码','status','statuscode']).toUpperCase();const desc=get(['状态说明','状态描述','statusdesc','statusdescription','statusname']);
    row.statusCode=code||row.statusCode;row.statusDesc=meaningfulDesc(desc)||row.statusDesc||fallbackDailyStatus(code);row.rawDeliveryTime=get(['派件时间','签收时间','POD时间','deliverytime','podtime','deliveredat'])||row.rawDeliveryTime;
    row.currentShop=get(['当前门店','当前网点','当前站点','currentshop','currentsite'])||row.currentShop;row.currentProvince=get(['当前省份','所在省份','currentprovince'])||row.currentProvince;
    row.deliveryShop=get(['派件门店','派送门店','deliveryshop'])||row.deliveryShop;row.deliveryProvince=get(['派件省份','派送省份','deliveryprovince'])||row.deliveryProvince;row.courier=get(['派件快递员','派送快递员','快递员','deliverycourier','courier'])||row.courier;
    row.exceptionCode=get(['异常编码','异常代码','exceptioncode'])||row.exceptionCode;row.exceptionDesc=get(['异常描述','异常说明','exceptiondesc','exceptiondescription'])||row.exceptionDesc;row.remark=get(['备注','remark','remarks','note'])||row.remark;
  }
  row.area=areaOf(row.regionCode,row.recipientProvince);row.store=Boolean(row.store||STORE_RE.test(`${row.currentShop||''} ${row.deliveryShop||''}`));row.metricEligible=true;row.sourceOrigin='DAILY_CANONICAL_UNION';
}
function canonicalMembership(db,type,range){
  if(type==='WHPP')return[];
  try{return db.prepare(`SELECT r.shipmentCode,r.reportDate,r.regionCode,r.recipientRaw,r.recipientNormalized,r.rowNumber,r.rowJson,r.snapshotId,r.batchId,b.createdAt batchCreatedAt
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
    INNER JOIN unified_import_rows r ON r.snapshotId=b.snapshotId AND r.businessType=?
    WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
    ORDER BY r.reportDate,b.createdAt,b.batchId,r.rowNumber,r.shipmentCode`).all(type,range.from,range.to);}catch{return[];}
}
function mergeCanonicalMembership(baseRows,type,range,db){
  const source=canonicalMembership(db,type,range); if(type!=='WHPP'&&!source.length) return {rows:baseRows,sourceRows:0,uniqueDaily:baseRows.length,recovered:0};
  const rows=[...baseRows]; const byBill=new Map(rows.map((row,index)=>[billOf(row.shipmentCode),index])); let recovered=0;
  for(const item of source){const bill=billOf(item.shipmentCode);if(!bill)continue;let index=byBill.get(bill);if(index===undefined){const row=minimalRow(type,item);rows.push(row);index=rows.length-1;byBill.set(bill,index);recovered++;}mergeMembershipField(rows[index],item);}
  for(const row of rows){if(row._membershipSnapshots){row.membershipSnapshotCount=row._membershipSnapshots.size;delete row._membershipSnapshots;}delete row._membershipLatestKey;}
  return {rows,sourceRows:source.length,uniqueDaily:new Set(source.map(r=>billOf(r.shipmentCode)).filter(Boolean)).size,recovered};
}

function classifyEvidence(raw={}, code=''){
  const c=String(code||raw.eventCode||raw.trackingEventCode||raw.statusCode||raw.shipmentStatus||'').trim().toUpperCase();const text=textOf(raw);
  if(c==='80'||c==='4004'||POD_RE.test(text))return{kind:'POD',label:'POD',terminal:true,normal:true};
  if(c==='86'||c==='P4008'||RETURN_RE.test(text))return{kind:'RETURNED',label:'退回',terminal:true,normal:true};
  if(CANCEL_RE.test(text)||String(raw.orderStatus||'')==='10')return{kind:'CANCELLED',label:'取消订单',terminal:true,normal:true};
  if(c==='84'||/退回处理中|RETURN_IN_PROGRESS/i.test(text))return{kind:'RETURN_IN_PROGRESS',label:'退回处理中',terminal:false,normal:true};
  if(/(?:CE|CEL)\s*:\s*(?:CCSL)?580\b|\b580滞留/i.test(text))return{kind:'SPECIAL',label:'580滞留包裹',terminal:false,normal:true};
  if(/(?:CE|CEL)\s*:\s*(?:CEZT|CECN)\b|仓库自提|WORK\s*ORDER\s*:\s*仓库自提/i.test(text))return{kind:'SPECIAL',label:'自提/转运门店',terminal:false,normal:true};
  if(c==='150'||PENDING_RE.test(text))return{kind:'PENDING',label:'Pending',terminal:false,normal:false};
  if(c==='70'||c==='4003'||DELIVERY_RE.test(text))return{kind:'DELIVERING',label:'派送中',terminal:false,normal:true};
  if(c==='60'||ASSIGN_RE.test(text))return{kind:'ASSIGNED',label:'分配派送中',terminal:false,normal:true};
  if(c==='30'||c==='32'||/CYCLE\s*COUNT|盘点/i.test(text))return{kind:'CYCLE',label:'盘点',terminal:false,normal:false};
  if(c==='99'||/工单|WORK\s*ORDER/i.test(text))return{kind:'WORK_ORDER',label:'工单',terminal:false,normal:false};
  if(STORE_RE.test(text))return{kind:'STORE',label:'门店流转',terminal:false,normal:true};
  if(c==='26'||/PICKUP\s*SUCCESS|揽收成功|货物到达|到达.*网点|INBOUND|DIVERSION/i.test(text))return{kind:'FLOW',label:'正常流转',terminal:false,normal:true};
  if(text)return{kind:'FLOW',label:'正常流转',terminal:false,normal:true};
  return{kind:'UNKNOWN',label:'',terminal:false,normal:false};
}
function truthTime(raw={}){return String(raw.latestEventTime||raw.最后节点时间||raw.lastEventTime||raw.POD时间||raw.podTime||raw.eventTime||raw.creationDate||raw.updatedAt||'').trim();}
function shouldReplaceTruth(row,newTime='',forceTerminal=false){if(forceTerminal)return true;const old=String(row.latestEventTime||'');if(!old)return true;if(!newTime)return false;return newTime>=old;}
function applyTruth(row,raw={},source='EVIDENCE',forceTerminal=false){
  const code=String(raw.eventCode||raw.trackingEventCode||raw.lastEventCode||raw.latestTrackStatusCode||raw.shipmentStatus||raw.statusCode||'').trim();const t=truthTime(raw);const text=textOf(raw);const cls=classifyEvidence(raw,code);if(cls.kind==='UNKNOWN')return false;
  if(!shouldReplaceTruth(row,t,forceTerminal||cls.terminal&&String(raw.orderStatus||'')==='85'))return false;
  row.latestEventTime=t||row.latestEventTime||'';row.latestEventDesc=String(raw.latestEventDesc||raw.最后节点||raw.lastEventDesc||text||'').trim();row.evidenceCoverage=source;
  const shop=firstValue([raw],['eventShop','locationCode','currentShop','currentShopCode','targetShopCode','shopName','matchedShopName','当前门店']);if(shop)row.currentShop=shop;
  const province=firstValue([raw],['currentProvince','deliveryProvince','派件省份','当前省份']);if(province)row.currentProvince=province;
  const courier=firstValue([raw],['eventCourier','courier','派件快递员']);if(courier)row.courier=courier;
  row.remark=appendRemark(row.remark,row.latestEventDesc?`最新轨迹：${row.latestEventDesc}`:'');
  row.pod=false;row.returned=false;row.cancelled=false;row.pending=false;row.delivering=false;
  if(cls.kind==='POD'){row.pod=true;row.podTime=t||firstValue([raw],['POD时间','podTime','deliveredAt']);row.podDate=dateKey(row.podTime);row.podSource=source;}
  else if(cls.kind==='RETURNED')row.returned=true;else if(cls.kind==='CANCELLED')row.cancelled=true;else if(cls.kind==='PENDING')row.pending=true;else if(cls.kind==='DELIVERING'||cls.kind==='ASSIGNED')row.delivering=true;
  row.terminalNormal=row.pod||row.returned||row.cancelled;row.openUnpod=!row.terminalNormal;row.store=cls.kind==='STORE'||Boolean(row.store&&cls.kind!=='DELIVERING');
  row.statusDesc=cls.label||meaningfulDesc(row.statusDesc)||fallbackDailyStatus(row.statusCode);if(!cls.normal&&!cls.terminal&&cls.label)row.exceptionDesc=cls.label;
  return true;
}
function applyStateRow(row,stateRow={}){if(!allowedEvidenceType(row.businessType,stateRow.businessType))return;const raw={...safeJson(stateRow.stateJson,{}),currentState:stateRow.state,latestEventTime:stateRow.lastEventTime,apiStatus:stateRow.apiStatus};const current=String(raw.currentState||raw.scanNormalizedState||'').toUpperCase();const terminalLock=current==='POD'||current==='RETURNED'||current==='RETURN_COMPLETED'||current==='CANCELLED'||String(raw.orderStatus||'')==='85'||String(raw.orderStatus||'')==='100';applyTruth(row,raw,'CURRENT_STATE',terminalLock);}
function evidenceRows(db,table,type,bills,columns){const out=[];for(const part of chunks(bills)){const marks=part.map(()=>'?').join(',');if(!marks)continue;const family=familyOf(type);try{out.push(...db.prepare(`SELECT ${columns} FROM ${table} WHERE businessType IN (?,?) AND shipmentCode IN (${marks})`).all(type,family,...part));}catch{}}return out;}
function enrichFamilyEvidence(rows,type,db){
  const byBill=new Map(rows.map(row=>[billOf(row.shipmentCode),row]));const bills=[...byBill.keys()].filter(Boolean);if(!bills.length)return{track:0,current:0,final:0,noEvidence:0};let trackCount=0,currentCount=0,finalCount=0;
  for(const source of evidenceRows(db,'business_track_events',type,bills,'businessType,shipmentCode,eventTime,eventCode,rawJson,createdAt')){const row=byBill.get(billOf(source.shipmentCode));if(!row)continue;const raw={...safeJson(source.rawJson,{}),eventTime:source.eventTime,eventCode:source.eventCode};if(applyTruth(row,raw,'TRACK'))trackCount++;}
  if(CCSL_TYPES.has(type))for(const part of chunks(bills)){const marks=part.map(()=>'?').join(',');if(!marks)continue;let legacy=[];try{legacy=db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,createdAt FROM track_events WHERE shipmentCode IN (${marks})`).all(...part);}catch{}for(const source of legacy){const row=byBill.get(billOf(source.shipmentCode));if(!row)continue;const raw={...safeJson(source.rawJson,{}),eventTime:source.eventTime,eventCode:source.eventCode};if(applyTruth(row,raw,'TRACK'))trackCount++;}}
  for(const source of evidenceRows(db,'business_final_rows',type,bills,'businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,latestEventTime,latestEventDesc,latestNode,rawJson,updatedAt')){const row=byBill.get(billOf(source.shipmentCode));if(!row)continue;const raw={...safeJson(source.rawJson,{}),isPod:source.isPod,primaryCategory:source.primaryCategory,latestEventTime:source.latestEventTime,latestEventDesc:source.latestEventDesc,latestNode:source.latestNode,updatedAt:source.updatedAt};if(applyTruth(row,raw,'FINAL_ROW'))finalCount++;}
  for(const part of chunks(bills)){const marks=part.map(()=>'?').join(',');if(!marks)continue;let current=[];try{current=db.prepare(`SELECT shipmentCode,businessType,reportDate,state,apiStatus,lastEventTime,stateJson,updatedAt FROM shipment_current_state WHERE shipmentCode IN (${marks})`).all(...part);}catch{}for(const source of current){const row=byBill.get(billOf(source.shipmentCode));if(!row)continue;const before=row.evidenceCoverage;applyStateRow(row,source);if(row.evidenceCoverage!==before)currentCount++;}}
  for(const source of evidenceRows(db,'business_scan_results',type,bills,'businessType,shipmentCode,reportDate,orderStatus,rawJson,updatedAt')){const row=byBill.get(billOf(source.shipmentCode));if(!row)continue;const raw={...safeJson(source.rawJson,{}),orderStatus:source.orderStatus,updatedAt:source.updatedAt};const status=String(source.orderStatus||'');if(status==='85')applyTruth(row,{...raw,currentState:'POD',statusText:'POD'},'SCAN_LOCK',true);else if(status==='100')applyTruth(row,{...raw,currentState:'RETURN_COMPLETED',statusText:'退回完成'},'SCAN_LOCK',true);else if(status==='10')applyTruth(row,{...raw,currentState:'CANCELLED',statusText:'取消订单'},'SCAN_LOCK',true);}
  for(const source of evidenceRows(db,'business_pod_locks',type,bills,'businessType,shipmentCode,podTime,source,updatedAt')){const row=byBill.get(billOf(source.shipmentCode));if(row)applyTruth(row,{eventCode:'80',eventTime:source.podTime,statusText:'POD'},'POD_LOCK',true);}
  if(type==='CE')for(const part of chunks(bills)){const marks=part.map(()=>'?').join(',');if(!marks)continue;let locks=[];try{locks=db.prepare(`SELECT shipmentCode,podTime,source,updatedAt FROM pod_locks WHERE shipmentCode IN (${marks})`).all(...part);}catch{}for(const source of locks){const row=byBill.get(billOf(source.shipmentCode));if(row)applyTruth(row,{eventCode:'80',eventTime:source.podTime,statusText:'POD'},'POD_LOCK',true);}}
  let noEvidence=0;for(const row of rows){
    if(row.terminalNormal){row.pending=false;row.delivering=false;row.statusDesc=row.pod?'POD':row.returned?'退回':'取消订单';}
    else if(row.evidenceCoverage==='DAILY_ONLY'||!row.evidenceCoverage){
      if(row.statusCode==='P'){row.pending=true;row.delivering=false;row.statusDesc='Pending（日报状态，轨迹证据待补齐）';}
      else if(row.statusCode==='W'||row.statusCode==='Y'){row.delivering=true;row.pending=false;row.statusDesc='派送中（日报状态，轨迹证据待补齐）';}
      else if(row.statusCode==='R'){row.returned=true;row.terminalNormal=true;row.openUnpod=false;row.statusDesc='退回';}
      else if(MANUAL_REVIEW_RE.test(row.statusDesc||''))row.statusDesc='证据待补齐';
      noEvidence++;row.dataIntegrityReview=true;
    }
    row.area=areaOf(row.regionCode,row.recipientProvince);row.store=Boolean(row.store||STORE_RE.test(`${row.currentShop||''} ${row.latestEventDesc||''}`));row.openUnpod=!row.pod&&!row.returned&&!row.cancelled;row.terminalNormal=!row.openUnpod;
  }
  return{track:trackCount,current:currentCount,final:finalCount,noEvidence};
}

export async function collectV205CanonicalRows(type,range,onProgress=()=>{}){
  const businessType=String(type||'').trim().toUpperCase();if(!TYPES.has(businessType))throw new Error(`V205不支持业务：${businessType}`);const db=getDb();
  const base=await collectV200Rows(businessType,range,onProgress);const merged=mergeCanonicalMembership(base,businessType,range,db);const evidence=enrichFamilyEvidence(merged.rows,businessType,db);
  const official=merged.rows.filter(row=>row.metricEligible!==false);const uniqueBills=new Set(official.map(row=>billOf(row.shipmentCode)).filter(Boolean));
  if(businessType!=='WHPP'&&merged.uniqueDaily&&uniqueBills.size!==merged.uniqueDaily)throw new Error(`V205完整性对账失败：${businessType} 日报唯一票 ${merged.uniqueDaily}，导出候选 ${uniqueBills.size}`);
  onProgress({phase:'v205CanonicalTruth',completed:merged.rows.length,total:merged.rows.length,businessType,canonicalSourceRows:merged.sourceRows,canonicalUniqueDaily:merged.uniqueDaily,recoveredFromOlderValidSnapshots:merged.recovered,trackTruth:evidence.track,currentTruth:evidence.current,finalTruth:evidence.final,noEvidence:evidence.noEvidence,version:V205_CANONICAL_TRUTH_VERSION});
  return merged.rows.sort((a,b)=>String(a.firstReportDate||'').localeCompare(String(b.firstReportDate||''))||billOf(a.shipmentCode).localeCompare(billOf(b.shipmentCode)));
}
