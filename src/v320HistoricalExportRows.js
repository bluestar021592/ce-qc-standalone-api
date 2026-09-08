import { getDb } from './db.js';
import { collectV200Rows as collectLegacyV200Rows } from './v200EvidenceData.js';

export const V320_HISTORICAL_EXPORT_ROWS_ID='2026-09-03-v419-membership-locked-current-truth-export-v1';
export const V474_EXPORT_INDEXED_HYDRATION_ID='2026-09-08-v474-index-native-export-hydration-progress-v1';
export const V477_EXPORT_MEMBERSHIP_PLAN_ID='2026-09-08-v477-indexed-batch-driven-membership-selection-v1';
const TYPES=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const SHOPEE=new Set(['SHOPEECN','SHOPEEVN']);
const text=v=>String(v??'').trim();
const billOf=v=>text(v).toUpperCase();
const dateKey=v=>{const m=text(v).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const safeJson=(v,f={})=>{try{return v&&typeof v==='object'?v:(JSON.parse(String(v||''))||f);}catch{return f;}};
const normalizeKey=v=>text(v).normalize('NFKC').toLowerCase().replace(/[\s_\-]+/g,'');
const chunks=(a,size=300)=>{const out=[];for(let i=0;i<a.length;i+=size)out.push(a.slice(i,i+size));return out;};
const progress=(fn,payload)=>{try{fn?.({...payload,v474:V474_EXPORT_INDEXED_HYDRATION_ID,v477:V477_EXPORT_MEMBERSHIP_PLAN_ID});}catch{}};

function parseRow(raw={}){
  const root=raw?.raw&&typeof raw.raw==='object'?raw.raw:raw;
  const map=new Map(Object.entries(root||{}).map(([k,v])=>[normalizeKey(k),v]));
  return aliases=>{for(const a of aliases){const v=map.get(normalizeKey(a));if(v!==undefined&&v!==null&&text(v)!=='')return text(v);}return'';};
}
function areaOf(region='',province=''){
  const c=text(region).toUpperCase(),p=text(province);
  if(c.includes('PP')||c.includes('PNH')||/PHNOM\s*PENH|金边/i.test(`${c} ${p}`))return'金边';
  if(c.includes('PV')||p)return'外省';
  return'未识别';
}
function isStore(v=''){return/(?:^|\b)(?:CP|FS)[A-Z0-9_-]*|\bSHOP\b|CO[-\s]?SHOP|PT[-\s]?SHOP/i.test(text(v));}
function newEntry(code,type,date){
  return{shipmentCode:code,businessType:type,firstReportDate:date,lastReportDate:date,dailyMembershipDates:[],orderTime:'',rawDeliveryTime:'',statusCode:'',statusDesc:'',regionCode:'',recipientProvince:'',area:'未识别',currentShop:'',currentProvince:'',recipient:'',recipientPhone:'',recipientAddress:'',deliveryShop:'',deliveryProvince:'',courier:'',exceptionCode:'',exceptionDesc:'',remark:'',pod:false,returned:false,pending:false,delivering:false,store:false,podTime:'',podDate:'',podAttemptNo:0,currentAttemptNo:0,firstAttemptAt:'',attemptNo:0,attemptSource:'',signingDays:0,deliveryDays:0,evidence:new Set()};
}
function applySource(entry,row,date){
  const raw=safeJson(row.rowJson||row.rawJson||row,{}),get=parseRow(raw);
  entry.firstReportDate=!entry.firstReportDate||date<entry.firstReportDate?date:entry.firstReportDate;
  entry.lastReportDate=!entry.lastReportDate||date>entry.lastReportDate?date:entry.lastReportDate;
  if(!entry.dailyMembershipDates.includes(date))entry.dailyMembershipDates.push(date);
  entry.regionCode=entry.regionCode||text(row.regionCode||row.region_code||raw.regionCode||get(['区域分类','区域','regioncode']));
  entry.recipientProvince=entry.recipientProvince||get(['收件省份','目的省份','收货省份','receiverprovince','destinationprovince']);
  entry.orderTime=entry.orderTime||get(['下单时间','订单时间','orderTime']);
  entry.recipient=entry.recipient||text(row.recipientNormalized||row.recipient_normalized||row.recipientRaw||row.recipient_raw||get(['收件人','收货人','recipient','receiver','consignee']));
  entry.recipientPhone=entry.recipientPhone||get(['收件人手机','收件人电话','收货人手机','手机号','receiverphone']);
  entry.recipientAddress=entry.recipientAddress||get(['收件地址','收货地址','详细地址','receiveraddress']);
  entry.rawDeliveryTime=entry.rawDeliveryTime||get(['派件时间','签收时间','POD时间','deliverytime','podtime']);
  entry.currentShop=entry.currentShop||get(['当前门店','当前网点','currentshop']);
  entry.deliveryShop=entry.deliveryShop||get(['派件门店','派送门店','deliveryshop']);
  entry.currentProvince=entry.currentProvince||get(['当前省份','currentprovince']);
  entry.deliveryProvince=entry.deliveryProvince||get(['派件省份','deliveryprovince']);
  entry.courier=entry.courier||get(['派件快递员','快递员','courier']);
  entry.exceptionCode=entry.exceptionCode||get(['异常编码','exceptioncode']);
  entry.exceptionDesc=entry.exceptionDesc||get(['异常描述','exceptiondesc']);
  entry.remark=entry.remark||get(['备注','remark']);
  entry.area=areaOf(entry.regionCode,entry.recipientProvince);
  entry.store=entry.store||isStore(`${entry.currentShop} ${entry.deliveryShop}`);
  entry.evidence.add('历史日报成员');
}

// V477: keep the exact latest VALID per reportDate+businessType rule, but drive
// candidate selection from the small batch table. EXISTS probes the covering
// idx_unified_rows_snapshot(snapshotId,businessType,shipmentCode) index instead
// of joining/window-sorting the full member table before the first progress event.
function latestValidRows(db,type,range,onProgress=()=>{}){
  const rows=[];
  progress(onProgress,{phase:'membershipPlan',completed:0,total:0,entries:0});
  try{
    const candidates=db.prepare(`SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId
      FROM unified_import_batches b
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
        AND EXISTS (
          SELECT 1 FROM unified_import_rows u
          WHERE u.snapshotId=b.snapshotId AND u.businessType=?
            AND u.reportDate=b.reportDate AND u.shipmentCode<>''
          LIMIT 1
        )
      ORDER BY b.reportDate ASC,b.createdAt DESC,b.batchId DESC`).all(range.from,range.to,type);
    const batches=[],selectedDates=new Set();
    for(const candidate of candidates){
      const d=dateKey(candidate.reportDate);if(!d||selectedDates.has(d))continue;
      selectedDates.add(d);batches.push(candidate);
    }
    progress(onProgress,{phase:'membershipPlan',completed:batches.length,total:batches.length,entries:0,candidates:candidates.length});
    const stmt=db.prepare('SELECT shipmentCode,regionCode,recipientRaw,recipientNormalized,rowNumber,rowJson FROM unified_import_rows WHERE snapshotId=? AND businessType=? ORDER BY rowNumber,shipmentCode');
    const uniqueBills=new Set();let loadedDays=0;
    for(const b of batches){
      const dayRows=stmt.all(b.snapshotId,type);
      if(!dayRows.length)throw new Error(`EXPORT_BUSINESS_MEMBERSHIP_EMPTY:${type}:${b.reportDate}`);
      for(const r of dayRows){
        rows.push({...r,reportDate:b.reportDate,source:'UNIFIED_PER_BUSINESS_LATEST_VALID'});
        const bill=billOf(r.shipmentCode);if(bill)uniqueBills.add(bill);
      }
      loadedDays+=1;
      progress(onProgress,{phase:'membershipLoad',completed:loadedDays,total:batches.length,entries:uniqueBills.size,rows:rows.length});
    }
  }catch(error){if(String(error?.message||'').startsWith('EXPORT_BUSINESS_MEMBERSHIP_EMPTY:'))throw error;}
  return rows;
}
function historicalSnapshotRows(db,type,range,skipDates){
  const out=[];
  try{
    for(const r of db.prepare('SELECT reportDate,shipmentCode,regionCode,rowJson FROM shipment_daily_snapshots WHERE businessType=? AND reportDate BETWEEN ? AND ? ORDER BY reportDate,shipmentCode').iterate(type,range.from,range.to)){
      if(!skipDates.has(dateKey(r.reportDate)))out.push({...r,source:'SHIPMENT_DAILY_SNAPSHOT'});
    }
  }catch{}
  return out;
}
function legacyShopeeRows(db,type,range,skipDates){
  if(!SHOPEE.has(type))return[];
  const group=type==='SHOPEECN'?'CN':'VN',out=[];
  try{
    const stmt=db.prepare("SELECT reportDate,shipmentCode,region_code regionCode,recipient_raw recipientRaw,recipient_normalized recipientNormalized,rowJson FROM business_daily_parse_rows WHERE businessType IN ('SHOPEE',?) AND reportDate BETWEEN ? AND ? AND recipient_group=? ORDER BY reportDate,id");
    for(const r of stmt.iterate(type,range.from,range.to,group))if(!skipDates.has(dateKey(r.reportDate)))out.push({...r,source:'BUSINESS_DAILY_PARSE'});
  }catch{}
  return out;
}
function explicitPodDate(raw,row){
  const values=[raw.POD时间,raw.podTime,raw.签收时间,raw.deliveredAt,raw.deliveryCompletedAt,row.latestEventTime];
  for(const v of values){const d=dateKey(v);if(d)return d;}
  return'';
}
function applyFinal(entry,row={}){
  const raw=safeJson(row.rawJson,{});
  const pod=Number(row.isPod||0)===1||raw.是否POD==='是'||String(raw.orderStatus||'')==='85'||/\bPOD\b|签收|妥投/i.test(`${row.primaryCategory||''} ${raw.currentState||''} ${raw.latestEventDesc||''}`);
  const returned=!pod&&(/RETURN|退回|退件/i.test(`${row.primaryCategory||''} ${raw.currentState||''} ${raw.退回状态||''}`));
  entry.pod=pod||entry.pod;entry.returned=returned||entry.returned;
  entry.pending=!entry.pod&&!entry.returned&&(/PENDING/i.test(`${row.primaryCategory||''} ${raw.currentState||''}`)||Number(raw.Pending次数||raw.Pending当前次数||0)>0);
  entry.delivering=!entry.pod&&!entry.returned&&!entry.pending&&(/DELIVER|派送|派件|ASSIGN/i.test(`${row.primaryCategory||''} ${raw.currentState||''}`));
  entry.statusCode=entry.pod?'Y':entry.returned?'R':entry.pending?'P':entry.delivering?'W':entry.statusCode;
  entry.statusDesc=entry.pod?'POD':entry.returned?'R退回':entry.pending?'Pending':entry.delivering?'分配派送中':text(row.primaryCategory||raw.currentState||entry.statusDesc);
  const pd=explicitPodDate(raw,row);if(entry.pod&&pd){entry.podDate=pd;entry.podTime=text(raw.POD时间||raw.podTime||raw.签收时间||row.latestEventTime||pd);}
  entry.podAttemptNo=Math.max(entry.podAttemptNo,Number(row.podAttemptNo||raw.podAttemptNo||0));
  entry.currentAttemptNo=Math.max(entry.currentAttemptNo,Number(row.currentAttemptNo||raw.currentAttemptNo||0));
  entry.firstAttemptAt=entry.firstAttemptAt||text(row.firstAttemptAt||raw.firstAttemptAt||raw.首次派件时间||raw.首次派送时间);
  entry.currentShop=entry.currentShop||text(row.currentShopCode||row.shopName||raw.currentShop||raw.currentShopCode);
  entry.store=entry.store||isStore(entry.currentShop);
  entry.evidence.add('历史最终状态');
}
function enrichFinals(db,type,map,onProgress=()=>{}){
  const bills=[...map.keys()],parts=chunks(bills),queryType=SHOPEE.has(type)?'SHOPEE':type;
  let completed=0;
  for(const part of parts){
    const marks=part.map(()=>'?').join(',');if(!marks)continue;
    let rs=[];
    try{
      if(SHOPEE.has(type)){
        const group=type==='SHOPEECN'?'CN':'VN';
        rs=db.prepare(`SELECT * FROM business_final_rows WHERE businessType IN ('SHOPEE',?) AND recipient_group=? AND shipmentCode IN (${marks}) ORDER BY reportDate`).all(type,group,...part);
      }else if(type==='CE'){
        rs=db.prepare(`SELECT * FROM final_rows WHERE shipmentCode IN (${marks}) ORDER BY reportDate`).all(...part);
      }else{
        try{rs=db.prepare(`SELECT * FROM business_final_rows WHERE businessType=? AND shipmentCode IN (${marks}) ORDER BY reportDate`).all(queryType,...part);}catch{rs=[];}
        if(!rs.length)rs=db.prepare(`SELECT * FROM final_rows WHERE shipmentCode IN (${marks}) ORDER BY reportDate`).all(...part);
      }
    }catch{}
    for(const r of rs){const e=map.get(billOf(r.shipmentCode));if(e)applyFinal(e,r);}
    completed+=part.length;
    progress(onProgress,{phase:'hydrateFinalRows',completed:Math.min(completed,bills.length),total:bills.length,entries:map.size});
  }
}
function enrichCurrentTruth(db,type,map,onProgress=()=>{}){
  const bills=[...map.keys()],parts=chunks(bills);let completed=0;
  for(const part of parts){
    const marks=part.map(()=>'?').join(',');if(!marks)continue;let rows=[];
    try{rows=db.prepare(`SELECT shipmentCode,businessType,reportDate,state,apiStatus,lastEventTime,stateJson,updatedAt FROM shipment_current_state WHERE shipmentCode IN (${marks})`).all(...part);}catch{rows=[];}
    for(const row of rows){
      const entry=map.get(billOf(row.shipmentCode));if(!entry)continue;
      const bt=text(row.businessType).toUpperCase();
      if(SHOPEE.has(type)){if(bt&&![type,'SHOPEE'].includes(bt))continue;}else if(bt&&bt!==type)continue;
      const raw=safeJson(row.stateJson,{}),state=text(row.state);
      applyFinal(entry,{...raw,shipmentCode:row.shipmentCode,rawJson:row.stateJson,primaryCategory:raw.primaryCategory||raw.主分类||state,currentState:state,latestEventTime:row.lastEventTime||raw.latestEventTime||raw.最后节点时间||'',isPod:/^POD$/i.test(state)||raw.是否POD==='是'||String(raw.orderStatus||'')==='85'?1:Number(raw.isPod||0),apiStatus:row.apiStatus||raw.apiStatus||raw.API状态||'',updatedAt:row.updatedAt});
      entry.evidence.add('当前持久化终态');
    }
    completed+=part.length;
    progress(onProgress,{phase:'hydrateCurrentTruth',completed:Math.min(completed,bills.length),total:bills.length,entries:map.size});
  }
}

export async function collectV320HistoricalExportRows(type,range,onProgress=()=>{}){
  const businessType=text(type).toUpperCase();
  if(!TYPES.has(businessType))throw new Error(`V320不支持业务：${businessType}`);
  if(businessType==='WHPP')return collectLegacyV200Rows(businessType,range,onProgress);
  const db=getDb();
  const modern=latestValidRows(db,businessType,range,onProgress),modernDates=new Set(modern.map(r=>dateKey(r.reportDate)));
  const snap=historicalSnapshotRows(db,businessType,range,modernDates),covered=new Set([...modernDates,...snap.map(r=>dateKey(r.reportDate))]);
  const legacy=legacyShopeeRows(db,businessType,range,covered),source=[...modern,...snap,...legacy],map=new Map();
  for(const row of source){
    const code=billOf(row.shipmentCode),d=dateKey(row.reportDate);if(!code||!d||d<range.from||d>range.to)continue;
    let e=map.get(code);if(!e){e=newEntry(code,businessType,d);map.set(code,e);}applySource(e,row,d);
  }
  if(!map.size)return collectLegacyV200Rows(businessType,range,onProgress);
  const sourceDates=new Set(source.map(r=>dateKey(r.reportDate)).filter(Boolean));
  progress(onProgress,{phase:'membershipRows',completed:sourceDates.size,total:sourceDates.size,entries:map.size});
  enrichFinals(db,businessType,map,onProgress);
  enrichCurrentTruth(db,businessType,map,onProgress);
  for(const e of map.values()){
    e.dailyMembershipDates=[...new Set(e.dailyMembershipDates.map(dateKey).filter(d=>d>=range.from&&d<=range.to))].sort();
    e.firstReportDate=e.dailyMembershipDates[0]||e.firstReportDate;e.lastReportDate=e.dailyMembershipDates.at(-1)||e.lastReportDate;
    e.area=areaOf(e.regionCode,e.recipientProvince);e.store=e.store||isStore(`${e.currentShop} ${e.deliveryShop}`);
  }
  const out=[...map.values()].filter(e=>e.dailyMembershipDates.length).sort((a,b)=>a.firstReportDate.localeCompare(b.firstReportDate)||a.shipmentCode.localeCompare(b.shipmentCode));
  progress(onProgress,{phase:'sourceRows',completed:sourceDates.size,total:sourceDates.size,entries:out.length,historySource:'PER_BUSINESS_LATEST_VALID+SHIPMENT_SNAPSHOTS+LEGACY_SHOPEE+CURRENT_STATE_OVERLAY'});
  return out;
}
console.info('[CE-QC][V320_HISTORICAL_EXPORT_ROWS]',V320_HISTORICAL_EXPORT_ROWS_ID,V474_EXPORT_INDEXED_HYDRATION_ID,V477_EXPORT_MEMBERSHIP_PLAN_ID,'export membership stays date-locked; V477 selects per-business latest VALID snapshots from the small batch table with indexed EXISTS probes before member hydration.');
