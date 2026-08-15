import express from 'express';
import fs from 'fs/promises';
import crypto from 'crypto';
import { parseUnifiedDailyExcel } from './unifiedExcelParser.js';
import { getUnifiedProcessingQueue } from './unifiedImportStore.js';
import { loadState, saveState } from './storage.js';
import { resetRunForReport } from './store.js';
import { getDb } from './db.js';
import {
  SHOPEE,
  loadBusinessState,
  resetBusinessRunForReport,
  saveBusinessState
} from './businessStore.js';

export const V150_UNIFIED_IMPORT_FAST_ROUTE_ID='2026-08-15-v151-direct-safe-persist-v2';
const IMPORT_ROUTE='/api/import/unified-daily-report';
const START_ROUTES=new Set(['/api/run/start','/api/shopee/run/start']);
const WRAPPED=Symbol.for('ce-qc.v150-unified-import-fast-route');
let hydrationPromise=null;
let hydrationKey='';

const BUSINESS_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
const nowIso=()=>new Date().toISOString();
function codeOf(row){return String(row?.shipmentCode||row?.运单号||'').trim().toUpperCase();}
function safeJsonRow(row){
  try{
    const parsed=JSON.parse(String(row?.stateJson||'{}'));
    return parsed&&typeof parsed==='object'?parsed:{shipmentCode:row?.shipmentCode||''};
  }catch{return {shipmentCode:row?.shipmentCode||'',businessType:row?.businessType||'',reportDate:row?.lastReportDate||row?.sourceReportDate||''};}
}
function sourceReconciliation(classificationCounts,validUniqueWaybills){
  const classifiedWaybills=BUSINESS_TYPES.reduce((sum,type)=>sum+Number(classificationCounts?.[type]||0),0);
  const valid=Number(validUniqueWaybills||0);
  return {businessTypes:[...BUSINESS_TYPES],validUniqueWaybills:valid,classifiedWaybills,difference:classifiedWaybills-valid,balanced:classifiedWaybills===valid};
}
function fastHydrateExisting(row){
  const db=getDb();
  const grouped=db.prepare('SELECT businessType,COUNT(*) count FROM unified_import_rows WHERE batchId=? GROUP BY businessType').all(row.batchId);
  const classificationCounts=Object.fromEntries(BUSINESS_TYPES.map(type=>[type,0]));
  for(const item of grouped)classificationCounts[String(item.businessType||'').toUpperCase()]=Number(item.count||0);
  const summary=JSON.parse(String(row.summaryJson||'{}'));
  return {
    batchId:row.batchId,snapshotId:row.snapshotId,reportDate:row.reportDate,fileHash:row.fileHash,
    classificationCounts,sourceReconciliation:sourceReconciliation(classificationCounts,summary.validUniqueWaybills),
    dateDetectionSource:row.dateDetectionSource||'',dateCandidates:JSON.parse(String(row.dateCandidatesJson||'[]')),
    dateConflict:JSON.parse(String(row.dateCandidatesJson||'[]')).length>1,dateWasManuallyCorrected:Boolean(row.dateWasManuallyCorrected),
    regionCounts:JSON.parse(String(row.regionCountsJson||'{}')),summary,warnings:JSON.parse(String(row.warningsJson||'[]')),
    duplicateFile:true,carryoverDeferred:true
  };
}

// Upload persistence deliberately does NOT calculate carryoverSummary and does NOT
// hydrate the full OPEN carry queue. Those operations belong to processing start.
export function persistUnifiedUploadFast(parsed,sourceName=''){
  const db=getDb();
  const validUnique=Number(parsed?.summary?.validUniqueWaybills||0);
  const recon=parsed?.sourceReconciliation||sourceReconciliation(parsed?.classificationCounts||{},validUnique);
  if(!parsed?.reportDate||!parsed?.fileHash||validUnique<=0||recon.balanced!==true)throw new Error('日报解析或七业务分类守恒未通过，已停止保存。');

  const existing=db.prepare("SELECT * FROM unified_import_batches WHERE reportDate=? AND fileHash=? AND status='VALID' ORDER BY createdAt DESC LIMIT 1").get(parsed.reportDate,parsed.fileHash);
  if(existing)return fastHydrateExisting(existing);

  const batchId=`BATCH-${crypto.randomUUID()}`;
  const snapshotId=`SNAP-${crypto.randomUUID()}`;
  const createdAt=nowIso();
  // Keep snapshot metadata compact. Per-waybill source rows already live in
  // unified_import_rows / shipment_daily_snapshots and must not be duplicated as
  // a giant JSON array inside unified_snapshots on every daily upload.
  const payload={
    reportDate:parsed.reportDate,dateDetectionSource:parsed.dateDetectionSource,dateCandidates:parsed.dateCandidates,
    dateConflict:parsed.dateConflict,containerFormat:parsed.containerFormat,classificationCounts:parsed.classificationCounts,
    sourceReconciliation:recon,regionCounts:parsed.regionCounts,summary:parsed.summary,sheetDiagnostics:parsed.sheetDiagnostics,
    storagePolicy:'ROWS_NORMALIZED_IN_TABLES_V151'
  };

  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare("UPDATE unified_import_batches SET status='SUPERSEDED' WHERE reportDate=? AND status='VALID'").run(parsed.reportDate);
    db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt,dateDetectionSource,dateCandidatesJson,dateWasManuallyCorrected,regionCountsJson) VALUES(?,?,?,?,?,'VALID',?,?,?,?,?,?,?)`)
      .run(batchId,snapshotId,parsed.reportDate,sourceName,parsed.fileHash,JSON.stringify(parsed.summary||{}),JSON.stringify(parsed.warnings||[]),createdAt,parsed.dateDetectionSource||'',JSON.stringify(parsed.dateCandidates||[]),parsed.dateWasManuallyCorrected?1:0,JSON.stringify(parsed.regionCounts||{}));
    const insertRow=db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt,classificationSource,classificationMatchedValue,classificationWarning) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertDaily=db.prepare(`INSERT INTO shipment_daily_snapshots(snapshotId,batchId,reportDate,businessType,shipmentCode,regionCode,classificationSource,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)`);
    const upsertCurrent=db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,apiStatus,lastEventTime,stateJson,updatedAt) VALUES(?,?,?,?,?,'PENDING_SCAN','',?,?) ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,reportDate=excluded.reportDate,snapshotId=excluded.snapshotId,state=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN shipment_current_state.state ELSE 'PENDING_SCAN' END,apiStatus=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN shipment_current_state.apiStatus ELSE 'PENDING_SCAN' END,lastEventTime=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN shipment_current_state.lastEventTime ELSE '' END,stateJson=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN shipment_current_state.stateJson ELSE excluded.stateJson END,updatedAt=excluded.updatedAt`);
    const upsertCarry=db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,'OPEN','PENDING_SCAN','',?,?,?) ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,lastReportDate=excluded.lastReportDate,lastSnapshotId=excluded.lastSnapshotId,status=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN 'CLOSED' ELSE 'OPEN' END,apiStatus=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN carryover_open_items.apiStatus ELSE 'PENDING_SCAN' END,closeReason=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN carryover_open_items.closeReason ELSE '' END,stateJson=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN carryover_open_items.stateJson ELSE excluded.stateJson END,updatedAt=excluded.updatedAt`);

    for(const row of parsed.rows||[]){
      const rowJson=JSON.stringify(row);
      insertRow.run(batchId,snapshotId,parsed.reportDate,row.businessType,row.shipmentCode,row.regionCode,row.recipientRaw,row.recipientNormalized,row.sheetName,row.rowNumber,row.classificationReason,rowJson,createdAt,row.classificationSource||'',row.classificationMatchedValue||'',row.classificationWarning||'');
      insertDaily.run(snapshotId,batchId,parsed.reportDate,row.businessType,row.shipmentCode,row.regionCode,row.classificationSource||'',rowJson,createdAt);
      upsertCurrent.run(row.shipmentCode,row.businessType,parsed.reportDate,snapshotId,'PENDING_SCAN',rowJson,createdAt);
      upsertCarry.run(row.shipmentCode,row.businessType,parsed.reportDate,parsed.reportDate,snapshotId,snapshotId,rowJson,createdAt,createdAt);
    }
    db.prepare(`INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,'IMPORTED',?,?)`).run(snapshotId,batchId,parsed.reportDate,JSON.stringify(payload),createdAt);
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}

  return {
    batchId,snapshotId,reportDate:parsed.reportDate,dateDetectionSource:parsed.dateDetectionSource,dateCandidates:parsed.dateCandidates,
    dateConflict:parsed.dateConflict,dateWasManuallyCorrected:parsed.dateWasManuallyCorrected,containerFormat:parsed.containerFormat,fileHash:parsed.fileHash,
    classificationCounts:parsed.classificationCounts,sourceReconciliation:recon,regionCounts:parsed.regionCounts,summary:parsed.summary,
    sheetDiagnostics:parsed.sheetDiagnostics,warnings:parsed.warnings,duplicateFile:false,carryoverDeferred:true
  };
}

function clearTransientRunState(state){
  for(const key of ['scanPool','scanResults','scanQueryStatus','trackEvents','trackResults','trackQueryStatus','needTrackBills','finalRows','nextCarryBills','failedBills'])state[key]=[];
  state.lastRun=null;state.currentRun=null;state.lastRunSummary=null;state.processing={running:false,paused:false,phase:''};
}
function latestBatch(reportDate=''){
  const db=getDb();
  if(reportDate)return db.prepare("SELECT batchId,snapshotId,reportDate,sourceName,createdAt FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC,batchId DESC LIMIT 1").get(reportDate)||null;
  return db.prepare("SELECT batchId,snapshotId,reportDate,sourceName,createdAt FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC,batchId DESC LIMIT 1").get()||null;
}
function rowsForBatch(batchId){
  return getDb().prepare(`SELECT businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson FROM unified_import_rows WHERE batchId=? ORDER BY rowNumber,shipmentCode`).all(batchId).map(row=>{
    try{const parsed=JSON.parse(String(row.rowJson||'{}'));return {...parsed,businessType:parsed.businessType||row.businessType,shipmentCode:parsed.shipmentCode||row.shipmentCode,regionCode:parsed.regionCode||row.regionCode,recipientRaw:parsed.recipientRaw??row.recipientRaw,recipientNormalized:parsed.recipientNormalized??row.recipientNormalized,classificationReason:parsed.classificationReason||row.classificationReason};}
    catch{return {...row};}
  });
}
function countsOf(rows){const counts=Object.fromEntries(BUSINESS_TYPES.map(type=>[type,0]));for(const row of rows){const type=String(row.businessType||'').toUpperCase();if(Object.hasOwn(counts,type))counts[type]+=1;}return counts;}
async function hydrateReportState(reportDate=''){
  const batch=latestBatch(reportDate);if(!batch)return {ok:false,noImport:true};
  const key=`${batch.reportDate}:${batch.batchId}`;
  const ccslExisting=await loadState();const shopeeExisting=loadBusinessState(SHOPEE);
  if(ccslExisting?.reportDate===batch.reportDate&&ccslExisting?.unifiedBatchId===batch.batchId&&shopeeExisting?.reportDate===batch.reportDate&&shopeeExisting?.unifiedBatchId===batch.batchId)return {ok:true,skipped:true,reportDate:batch.reportDate,batchId:batch.batchId};
  if(hydrationPromise&&hydrationKey===key)return hydrationPromise;
  hydrationKey=key;
  hydrationPromise=(async()=>{
    const rows=rowsForBatch(batch.batchId);const counts=countsOf(rows);const queue=getUnifiedProcessingQueue(batch.batchId);
    const historicalCcsl=queue.rows.filter(row=>row.sourceType==='HISTORICAL_CARRY'&&['CE','CEAF','TBKH','ALI1688'].includes(String(row.businessType||'').toUpperCase()));
    const historicalShopee=queue.rows.filter(row=>row.sourceType==='HISTORICAL_CARRY'&&['SHOPEECN','SHOPEEVN'].includes(String(row.businessType||'').toUpperCase()));
    const ccslRows=rows.filter(row=>['CE','CEAF','TBKH','ALI1688'].includes(String(row.businessType||'').toUpperCase()));
    const shopeeRows=rows.filter(row=>['SHOPEECN','SHOPEEVN'].includes(String(row.businessType||'').toUpperCase()));
    const ccsl=ccslExisting||{};ccsl.reportDate=batch.reportDate;ccsl.unifiedBatchId=batch.batchId;ccsl.sourceName=batch.sourceName||'';ccsl.dailyReportReady=true;
    ccsl.dailyParseRows=ccslRows.map(row=>({...row,result:'PNH',reason:row.classificationReason||''}));ccsl.dailyParseSummary={totalRecognized:ccslRows.length,pnh:ccslRows.length,nonPnh:0,excluded:0,duplicate:0};ccsl.pnhBills=ccslRows.map(codeOf).filter(Boolean);ccsl.nonPnhBills=[];ccsl.excludedBills=[];ccsl.duplicateBills=[];clearTransientRunState(ccsl);ccsl.carryBills=historicalCcsl.map(row=>String(row.shipmentCode||'').trim().toUpperCase()).filter(Boolean);ccsl.priorCarryRows=historicalCcsl.map(safeJsonRow);resetRunForReport(batch.reportDate);await saveState(ccsl);
    const shopee=shopeeExisting||{};shopee.businessType=SHOPEE;shopee.reportDate=batch.reportDate;shopee.unifiedBatchId=batch.batchId;shopee.sourceName=batch.sourceName||'';shopee.dailyReportReady=true;
    shopee.dailyParseRows=shopeeRows.map(row=>({...row,recipient_raw:row.recipientRaw,recipient_normalized:row.recipientNormalized,recipient_group:String(row.businessType||'').toUpperCase()==='SHOPEEVN'?'VN':'CN',region_code:row.regionCode,import_disposition:'ACCEPTED'}));shopee.dailyParseSummary={totalRecognized:shopeeRows.length,groupCounts:{CN:counts.SHOPEECN,VN:counts.SHOPEEVN},conflictCount:0};shopee.pnhBills=shopeeRows.map(codeOf).filter(Boolean);clearTransientRunState(shopee);shopee.carryBills=historicalShopee.map(row=>String(row.shipmentCode||'').trim().toUpperCase()).filter(Boolean);shopee.priorCarryRows=historicalShopee.map(safeJsonRow);resetBusinessRunForReport(SHOPEE,batch.reportDate);saveBusinessState(shopee,SHOPEE);
    return {ok:true,reportDate:batch.reportDate,batchId:batch.batchId,todayRows:rows.length,historicalCarry:queue.rows.length};
  })().finally(()=>{hydrationPromise=null;hydrationKey='';});
  return hydrationPromise;
}

async function fastImportHandler(req,res){
  const startedAt=Date.now();
  try{
    if(!req.file)throw new Error('没有收到综合日报Excel文件');
    const parsed=req.ceQcParsedUnified||parseUnifiedDailyExcel(req.file.path,{reportDate:req.body?.reportDate||'',originalName:req.file.originalname});
    const saved=persistUnifiedUploadFast(parsed,req.file.originalname);
    hydrationPromise=null;hydrationKey='';
    await fs.unlink(req.file.path).catch(()=>{});
    res.setHeader('Cache-Control','no-store');
    return res.json({ok:true,...saved,processingDeferred:true,statePreparation:'ON_PROCESS_START',importElapsedMs:Date.now()-startedAt,patchId:V150_UNIFIED_IMPORT_FAST_ROUTE_ID});
  }catch(error){if(req.file?.path)await fs.unlink(req.file.path).catch(()=>{});if(res.headersSent)return;return res.status(400).json({ok:false,code:error?.code||'UNIFIED_IMPORT_FAILED',error:error?.message||String(error),sheetDiagnostics:error?.sheetDiagnostics||[],patchId:V150_UNIFIED_IMPORT_FAST_ROUTE_ID});}
}

const previousPost=express.application.post;
if(typeof previousPost==='function'&&!previousPost[WRAPPED]){
  const wrappedPost=function v151UnifiedImportFastPost(pathValue,...handlers){
    if(pathValue===IMPORT_ROUTE&&handlers.length){handlers[handlers.length-1]=fastImportHandler;return previousPost.call(this,pathValue,...handlers);}
    if(START_ROUTES.has(pathValue)&&handlers.length){const finalHandler=handlers[handlers.length-1];if(typeof finalHandler==='function'){handlers[handlers.length-1]=async function v151HydrateOnRunStart(req,res,next){try{const requested=String(req.body?.reportDate||'').trim().slice(0,10);await hydrateReportState(requested);return await finalHandler.call(this,req,res,next);}catch(error){if(typeof next==='function')return next(error);if(!res.headersSent)return res.status(500).json({ok:false,code:'V151_STATE_PREPARATION_FAILED',error:error?.message||String(error)});}};}return previousPost.call(this,pathValue,...handlers);}
    return previousPost.call(this,pathValue,...handlers);
  };
  Object.defineProperty(wrappedPost,WRAPPED,{value:true});express.application.post=wrappedPost;
}

export const __test={latestBatch,rowsForBatch,hydrateReportState,persistUnifiedUploadFast};
