import crypto from 'node:crypto';
import { getDataDb, nowIso } from './db.js';
import { parseUnifiedDailyExcel } from '../src/unifiedExcelParser.js';

export const BUSINESSES=Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);

export function importDaily(filePath,{originalName='',reportDate=''}={}){
  const parsed=parseUnifiedDailyExcel(filePath,{originalName,reportDate});
  const total=BUSINESSES.reduce((sum,type)=>sum+Number(parsed.classificationCounts?.[type]||0),0);
  if(total!==parsed.rows.length)throw new Error(`七业务分类守恒失败：明细${parsed.rows.length}票，分类合计${total}票。`);
  const db=getDataDb(),batchId=crypto.randomUUID(),createdAt=nowIso();
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare("UPDATE import_batches SET status='SUPERSEDED' WHERE reportDate=? AND status='VALID'").run(parsed.reportDate);
    db.prepare('INSERT INTO import_batches(batchId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?)').run(batchId,parsed.reportDate,originalName||'',parsed.fileHash,'VALID',JSON.stringify({classificationCounts:parsed.classificationCounts,regionCounts:parsed.regionCounts,sourceReconciliation:parsed.sourceReconciliation,summary:parsed.summary,sheetDiagnostics:parsed.sheetDiagnostics,dateDetectionSource:parsed.dateDetectionSource}),JSON.stringify(parsed.warnings||[]),createdAt);
    const insert=db.prepare('INSERT INTO import_rows(batchId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,customerNameRaw,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)');
    const seedState=db.prepare(`INSERT INTO shipment_state(shipmentCode,businessType,reportDate,state,isPod,isReturned,pendingDays,ocDays,specialState,lastEventTime,lastEventDesc,stateJson,updatedAt)
      VALUES(?,?,?,'UNPROCESSED',0,0,0,0,'','','','{}',?)
      ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,reportDate=excluded.reportDate,updatedAt=excluded.updatedAt`);
    for(const row of parsed.rows){
      insert.run(batchId,parsed.reportDate,row.businessType,row.shipmentCode,row.regionCode||'',row.recipientRaw||'',row.customerNameRaw||'',row.classificationReason||'',JSON.stringify(row),createdAt);
      seedState.run(row.shipmentCode,row.businessType,parsed.reportDate,createdAt);
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return {ok:true,batchId,reportDate:parsed.reportDate,total:parsed.rows.length,classificationCounts:parsed.classificationCounts,regionCounts:parsed.regionCounts,warnings:parsed.warnings||[],sheetDiagnostics:parsed.sheetDiagnostics||[]};
}

export function latestDate(){return String(getDataDb().prepare("SELECT COALESCE(MAX(reportDate),'') reportDate FROM import_batches WHERE status='VALID'").get()?.reportDate||'');}
export function listDates(){return getDataDb().prepare("SELECT reportDate,sourceName,createdAt,summaryJson FROM import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC").all().map(row=>({...row,summary:safeJson(row.summaryJson)}));}
export function validBatch(reportDate=''){const date=reportDate||latestDate();if(!date)return null;return getDataDb().prepare("SELECT * FROM import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC LIMIT 1").get(date)||null;}

export function boardSummary(reportDate=''){
  const batch=validBatch(reportDate);
  const date=batch?.reportDate||reportDate||'';
  const boards={};
  for(const type of BUSINESSES)boards[type]=businessSummary(type,date,batch?.batchId||'');
  return {reportDate:date,batchId:batch?.batchId||'',hasData:Boolean(batch),boards};
}

export function businessSummary(type,reportDate='',batchId=''){
  const business=String(type||'').toUpperCase();if(!BUSINESSES.includes(business))throw new Error(`未知业务板块：${business}`);
  const batch=batchId?{batchId,reportDate}:validBatch(reportDate);
  if(!batch)return emptyBoard(business,reportDate||'');
  const db=getDataDb();
  const rows=db.prepare(`SELECT r.shipmentCode,r.regionCode,r.recipientRaw,r.customerNameRaw,r.classificationReason,
    COALESCE(s.state,'UNPROCESSED') state,COALESCE(s.isPod,0) isPod,COALESCE(s.isReturned,0) isReturned,
    COALESCE(s.pendingDays,0) pendingDays,COALESCE(s.ocDays,0) ocDays,COALESCE(s.specialState,'') specialState,
    COALESCE(s.lastEventTime,'') lastEventTime,COALESCE(s.lastEventDesc,'') lastEventDesc
    FROM import_rows r LEFT JOIN shipment_state s ON s.shipmentCode=r.shipmentCode
    WHERE r.batchId=? AND r.businessType=? ORDER BY r.id`).all(batch.batchId,business);
  const total=rows.length,pod=rows.filter(r=>Number(r.isPod)===1||r.state==='POD').length,returned=rows.filter(r=>Number(r.isReturned)===1||r.state==='RETURN_COMPLETED').length;
  const pending1=rows.filter(r=>Number(r.pendingDays)>=1&&!terminal(r)).length,pending2=rows.filter(r=>Number(r.pendingDays)>=2&&!terminal(r)).length,pending3=rows.filter(r=>Number(r.pendingDays)>=3&&!terminal(r)).length;
  const oc1=rows.filter(r=>Number(r.ocDays)>=1&&!terminal(r)).length,oc2=rows.filter(r=>Number(r.ocDays)>=2&&!terminal(r)).length,oc3=rows.filter(r=>Number(r.ocDays)>=3&&!terminal(r)).length;
  const specialCount=pattern=>rows.filter(r=>pattern.test(String(r.specialState||''))).length;
  const unresolved=rows.filter(r=>!terminal(r)&&!isNormalSpecial(r)).length;
  return {businessType:business,reportDate:batch.reportDate,total,pod,returned,open:Math.max(0,total-pod-returned),podRate:total?Number((pod*100/total).toFixed(2)):0,
    pending1,pending2,pending3,oc1,oc2,oc3,unresolved,
    selfPickup:specialCount(/SELF_PICKUP/i),cecn:specialCount(/CECN/i),cezt:specialCount(/CEZT/i),retention580:specialCount(/580/i),
    pp:rows.filter(r=>r.regionCode==='PP').length,pv:rows.filter(r=>r.regionCode==='PV').length,rows};
}

export function boardRows(type,{reportDate='',state='',region='',q='',limit=500}={}){
  const board=businessSummary(type,reportDate);let rows=board.rows||[];
  if(state)rows=rows.filter(r=>String(r.state||'')===state);
  if(region)rows=rows.filter(r=>String(r.regionCode||'')===region);
  if(q){const text=String(q).toUpperCase();rows=rows.filter(r=>[r.shipmentCode,r.recipientRaw,r.lastEventDesc].some(v=>String(v||'').toUpperCase().includes(text)));}
  return {reportDate:board.reportDate,businessType:board.businessType,total:rows.length,rows:rows.slice(0,Math.max(1,Math.min(2000,Number(limit||500))))};
}

export function clearBusinessData(){
  const db=getDataDb();db.exec('BEGIN IMMEDIATE');try{for(const table of ['export_jobs','daily_metrics','carryover','track_events','shipment_state','import_rows','import_batches'])db.exec(`DELETE FROM ${table}`);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return {ok:true};
}

function terminal(row){return Number(row.isPod)===1||Number(row.isReturned)===1||['POD','RETURN_COMPLETED','CANCELLED'].includes(String(row.state||''));}
function isNormalSpecial(row){return /SELF_PICKUP|CECN|CEZT|580/.test(String(row.specialState||''));}
function emptyBoard(type,reportDate){return{businessType:type,reportDate,total:0,pod:0,returned:0,open:0,podRate:0,pending1:0,pending2:0,pending3:0,oc1:0,oc2:0,oc3:0,unresolved:0,selfPickup:0,cecn:0,cezt:0,retention580:0,pp:0,pv:0,rows:[]};}
function safeJson(value){try{return JSON.parse(value||'{}');}catch{return{};}}
