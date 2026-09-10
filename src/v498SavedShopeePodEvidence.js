import { getDb } from './db.js';

export const V498_SAVED_SHOPEE_POD_EVIDENCE_ID='2026-09-10-v498-saved-shopee-scan-final-pod-time-v1';
const BATCH_SIZE=220;
const text=value=>String(value??'').trim();
const bill=value=>text(value).toUpperCase();
const uniq=values=>[...new Set((values||[]).map(bill).filter(Boolean))];
const dateKey=value=>{const m=text(value).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const safeJson=value=>{try{return value&&typeof value==='object'?value:JSON.parse(String(value||''));}catch{return{};}};
const chunks=(values,size=BATCH_SIZE)=>{const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;};
const EXPLICIT_POD_TIME_KEYS=['POD时间','podTime','podClosedAt','podAt','deliveredAt','deliveryCompletedAt','签收时间','signTime','signedTime'];
const TERMINAL_STATUS_TIME_KEYS=['updateTime','lastUpdateDate','scanTime','statusTime','modifyTime'];
const TERMINAL_TEXT_KEYS=['currentState','state','status','shipmentStatus','statusName','orderStatusDesc','scanTerminalType','scanTerminalReason'];
const TERMINAL_TEXT=new Set(['POD','DELIVERED','SIGNED','签收','已签收','妥投','已妥投']);

function terminalProof(row={},raw={}){
  for(const value of [row.orderStatus,raw.orderStatus,row.shipmentStatus,raw.shipmentStatus,raw.statusCode])if(text(value)==='85')return'85';
  for(const key of TERMINAL_TEXT_KEYS){const value=text(raw?.[key]).toUpperCase();if(TERMINAL_TEXT.has(value))return`${key}=${text(raw?.[key])}`;}
  return'';
}
function better(next,previous){
  if(!previous)return true;
  if(Number(next.priority)!==Number(previous.priority))return Number(next.priority)<Number(previous.priority);
  if(next.podDate!==previous.podDate)return next.podDate<previous.podDate;
  return text(next.timestamp)<text(previous.timestamp);
}

export function extractV498SavedShopeePodEvidence(row={},source=''){
  const raw=safeJson(row.rawJson),shipmentCode=bill(row.shipmentCode||raw.shipmentCode||raw.运单号||raw.waybill);
  if(!shipmentCode)return null;
  for(const key of EXPLICIT_POD_TIME_KEYS){
    const value=raw?.[key],podDate=dateKey(value);
    if(podDate)return{shipmentCode,podDate,timestamp:text(value),field:key,source,priority:0,terminalProof:`explicit:${key}`};
  }
  const proof=terminalProof(row,raw);if(!proof)return null;
  for(const key of TERMINAL_STATUS_TIME_KEYS){
    const value=raw?.[key],podDate=dateKey(value);
    if(podDate)return{shipmentCode,podDate,timestamp:text(value),field:key,source,priority:1,terminalProof:proof};
  }
  return null;
}

export function recoverV498SavedShopeePodDates({db=getDb(),targetBills=[]}={}){
  const targets=uniq(targetBills),evidenceByBill=new Map();
  if(!targets.length)return{evidenceByBill,targetBills:0,matchedBills:0,scanRows:0,trackRows:0,finalRows:0};
  const consider=(rows,source)=>{for(const row of rows||[]){const evidence=extractV498SavedShopeePodEvidence(row,source);if(!evidence||!targets.includes(evidence.shipmentCode))continue;if(better(evidence,evidenceByBill.get(evidence.shipmentCode)))evidenceByBill.set(evidence.shipmentCode,evidence);}};
  let scanRows=0,trackRows=0,finalRows=0;
  for(const part of chunks(targets)){
    const marks=part.map(()=>'?').join(',');if(!marks)continue;
    try{const rows=db.prepare(`SELECT shipmentCode,reportDate,orderStatus,isPod,rawJson FROM business_scan_results WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,reportDate`).all(...part);scanRows+=rows.length;consider(rows,'business_scan_results');}catch{}
    try{const rows=db.prepare(`SELECT shipmentCode,reportDate,shipmentStatus,statusText,apiStatus,rawJson FROM business_shipment_tracks WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,reportDate`).all(...part);trackRows+=rows.length;consider(rows,'business_shipment_tracks');}catch{}
    try{const rows=db.prepare(`SELECT shipmentCode,reportDate,isPod,apiStatus,rawJson FROM business_final_rows WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,reportDate`).all(...part);finalRows+=rows.length;consider(rows,'business_final_rows');}catch{}
  }
  return{evidenceByBill,targetBills:targets.length,matchedBills:evidenceByBill.size,scanRows,trackRows,finalRows};
}

console.info('[CE-QC][V498_SAVED_SHOPEE_POD_EVIDENCE]',V498_SAVED_SHOPEE_POD_EVIDENCE_ID,'strict Shopee POD rows with blank podDate may recover only from exact-member saved SQLite scan/shipment/final raw evidence: explicit POD timestamp, or saved terminal proof (orderStatus/shipmentStatus=85 or exact POD terminal token) plus updateTime/lastUpdateDate/scanTime/statusTime/modifyTime; table updatedAt/export time/lastCheckedAt are never used.');
