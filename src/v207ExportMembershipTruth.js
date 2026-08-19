import { getDb } from './db.js';
import { collectV205ExportRows } from './v205ExportTruth.js';
import { loadV207CanonicalRows, V207_IMPORT_INTEGRITY_VERSION } from './v207UnifiedImportIntegrity.js';

export const V207_EXPORT_MEMBERSHIP_VERSION='2026-08-19-v207-export-membership-rebaseline-gate-v2';
const RETURN_RE=/RETURN(?:ED|_COMPLETED)?|退回完成|已退回|退件完成|\bR\b/i;
const CANCEL_RE=/ORDER_CANCELLED|CANCELLED|CANCELED|订单取消|已取消|取消订单/i;
const PENDING_RE=/\bPENDING\b|派送失败|\b150\b/i;
const DELIVERY_RE=/派送中|派件中|OUT\s*FOR\s*DELIVERY|DELIVER\s*TO\s*BUYER|\b4003\b/i;
function billOf(value=''){return String(value||'').trim().toUpperCase();}
function keyOf(value=''){return String(value||'').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]+/g,'');}
function safeJson(value,fallback={}){if(value&&typeof value==='object')return value;try{return JSON.parse(String(value||''))||fallback;}catch{return fallback;}}
function parseRaw(row={}){const raw=row.raw&&typeof row.raw==='object'?row.raw:row,map=new Map(Object.entries(raw||{}).map(([k,v])=>[keyOf(k),v]));const get=aliases=>{for(const a of aliases){const v=map.get(keyOf(a));if(v!==undefined&&v!==null&&String(v).trim()!=='')return String(v).trim();}return'';};return{raw,get};}
function areaOf(regionCode='',province=''){const code=String(regionCode||'').toUpperCase(),p=String(province||'');if(/\bPP\b|PNH|PHNOM\s*PENH|金边/.test(`${code} ${p}`))return'金边';if(/\bPV\b|PROVINCE|省/.test(code)||p)return'外省';return'未识别';}
function fallbackFromOwnership(source={}){const{get}=parseRaw(source),statusCode=get(['状态标识','状态代码','status','statuscode']).toUpperCase(),statusDesc=get(['状态说明','状态描述','statusdesc','statusdescription','statusname']),province=get(['收件省份','目的省份','目的地省份','收货省份','receiverprovince','destinationprovince']),region=String(source.regionCode||''),returned=statusCode==='R'||RETURN_RE.test(statusDesc),cancelled=!returned&&CANCEL_RE.test(statusDesc),pending=!returned&&!cancelled&&(statusCode==='P'||PENDING_RE.test(statusDesc)),delivering=!returned&&!cancelled&&!pending&&(statusCode==='W'||statusCode==='Y'||DELIVERY_RE.test(statusDesc));return{
  shipmentCode:billOf(source.shipmentCode),businessType:String(source.businessType||'').toUpperCase(),firstReportDate:source.reportDate,lastReportDate:source.reportDate,orderTime:get(['下单时间','下单日期','订单时间','订单日期','ordertime','orderdate']),statusCode,statusDesc:statusDesc||(pending?'Pending（轨迹证据待补齐）':delivering?'派送中（轨迹证据待补齐）':returned?'退回':cancelled?'取消订单':'轨迹证据待补齐'),recipientProvince:province,regionCode:region,area:areaOf(region,province),recipient:get(['收件人','收货人','recipient','receiver','consignee']),recipientPhone:get(['收件人手机','收件人电话','手机号','receiverphone']),recipientAddress:get(['收件地址','收货地址','地址','receiveraddress']),currentShop:get(['当前门店','当前网点','当前站点','currentshop']),currentProvince:get(['当前省份','所在省份','currentprovince']),deliveryShop:get(['派件门店','派送门店','deliveryshop']),deliveryProvince:get(['派件省份','派送省份','deliveryprovince']),courier:get(['派件快递员','派送快递员','快递员','courier']),exceptionCode:get(['异常编码','异常代码','exceptioncode']),exceptionDesc:get(['异常描述','异常说明','exceptiondesc']),remark:'V207不可丢失成员底账恢复；等待/复用扫描轨迹证据',pod:false,returned,cancelled,terminalNormal:returned||cancelled,openUnpod:!returned&&!cancelled,pending,delivering,store:false,podTime:'',podDate:'',attemptNo:0,currentAttemptNo:0,deliveryDays:0,metricEligible:true,sourceOrigin:'V207_OWNERSHIP_LEDGER_RECOVERY',sourceOriginLabel:'不可丢失底账恢复',evidenceCoverage:'OWNERSHIP_ONLY',dataIntegrityReview:true,v207RecoveredFromPrior:Boolean(source.v207RecoveredFromPrior),v207OwnershipVersion:V207_IMPORT_INTEGRITY_VERSION
};}
function legacyDates(type,range){const db=getDb(),businessType=String(type||'').toUpperCase();try{if(businessType==='WHPP')return db.prepare("SELECT DISTINCT reportDate FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? ORDER BY reportDate").all(range.from,range.to).map(r=>String(r.reportDate));return db.prepare(`SELECT DISTINCT r.reportDate FROM unified_import_rows r JOIN unified_import_batches b ON b.batchId=r.batchId WHERE r.businessType=? AND r.reportDate BETWEEN ? AND ? AND b.status IN ('VALID','SUPERSEDED') ORDER BY r.reportDate`).all(businessType,range.from,range.to).map(r=>String(r.reportDate));}catch{return[];}}
function rebuiltDates(type,range){try{return getDb().prepare('SELECT DISTINCT reportDate FROM v207_daily_ownership WHERE businessType=? AND reportDate BETWEEN ? AND ? ORDER BY reportDate').all(String(type||'').toUpperCase(),range.from,range.to).map(r=>String(r.reportDate));}catch{return[];}}
function assertRebaselineReady(type,range){const legacy=legacyDates(type,range),rebuilt=new Set(rebuiltDates(type,range)),missing=legacy.filter(date=>!rebuilt.has(date));if(missing.length){const error=new Error(`${type} 所选区间还有 ${missing.length} 个历史日报日期尚未按V207重新建立底账：${missing.slice(0,12).join('、')}${missing.length>12?'…':''}。为避免把旧漏票/旧归属继续带进新报表，已停止本次区间导出。请先完成这些日期的重新上传。`);error.code='V207_REBASELINE_INCOMPLETE';error.businessType=type;error.missingDates=missing;throw error;}return{legacyDates:legacy.length,rebuiltDates:rebuilt.size,complete:true};}

export async function collectV207ExportRows(type,range,onProgress=()=>{}){
  const businessType=String(type||'').trim().toUpperCase();
  const rebaseline=assertRebaselineReady(businessType,range);
  const ownership=loadV207CanonicalRows(businessType,range);
  let base=[];let baseError='';
  try{base=await collectV205ExportRows(businessType,range,onProgress);}catch(error){baseError=error?.message||String(error);}
  if(!ownership.length){if(rebaseline.legacyDates===0&&base.length)return base;if(baseError)throw new Error(baseError);return[];}
  const wanted=new Map(ownership.map(row=>[billOf(row.shipmentCode),row]));
  const officialByBill=new Map();const manual=[];
  for(const row of base){const bill=billOf(row.shipmentCode);if(row.metricEligible===false){manual.push(row);continue;}if(wanted.has(bill))officialByBill.set(bill,row);}
  let recovered=0;
  for(const [bill,member] of wanted){if(officialByBill.has(bill)){const row=officialByBill.get(bill);row.businessType=businessType;row.v207OwnershipVersion=V207_IMPORT_INTEGRITY_VERSION;row.v207RecoveredFromPrior=Boolean(member.v207RecoveredFromPrior);continue;}officialByBill.set(bill,fallbackFromOwnership(member));recovered++;}
  const official=[...officialByBill.values()];
  if(official.length!==wanted.size)throw new Error(`V207导出成员对账失败：${businessType} 底账${wanted.size}票，导出${official.length}票`);
  if(new Set(official.map(row=>billOf(row.shipmentCode))).size!==official.length)throw new Error(`V207导出成员存在重复运单：${businessType}`);
  onProgress({phase:'v207ExportMembership',completed:official.length,total:official.length,businessType,ownershipRows:wanted.size,recoveredMissingRows:recovered,manualEvidenceRows:manual.length,rebaseline,previousWarning:baseError,version:V207_EXPORT_MEMBERSHIP_VERSION});
  return [...official,...manual].sort((a,b)=>String(a.firstReportDate||'').localeCompare(String(b.firstReportDate||''))||billOf(a.shipmentCode).localeCompare(billOf(b.shipmentCode)));
}
