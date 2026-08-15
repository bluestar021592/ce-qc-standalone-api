import express from 'express';
import fs from 'fs/promises';
import { parseUnifiedDailyExcel } from './unifiedExcelParser.js';
import { getUnifiedProcessingQueue, saveUnifiedImport } from './unifiedImportStore.js';
import { loadState, saveState } from './storage.js';
import { resetRunForReport } from './store.js';
import { getDb } from './db.js';
import {
  SHOPEE,
  loadBusinessState,
  resetBusinessRunForReport,
  saveBusinessState
} from './businessStore.js';

export const V150_UNIFIED_IMPORT_FAST_ROUTE_ID='2026-08-15-v150-upload-first-route-v1';
const IMPORT_ROUTE='/api/import/unified-daily-report';
const START_ROUTES=new Set(['/api/run/start','/api/shopee/run/start']);
const WRAPPED=Symbol.for('ce-qc.v150-unified-import-fast-route');
let hydrationPromise=null;
let hydrationKey='';

function codeOf(row){return String(row?.shipmentCode||row?.运单号||'').trim().toUpperCase();}
function safeJsonRow(row){
  try{
    const parsed=JSON.parse(String(row?.stateJson||'{}'));
    return parsed&&typeof parsed==='object'?parsed:{shipmentCode:row?.shipmentCode||''};
  }catch{return {shipmentCode:row?.shipmentCode||'',businessType:row?.businessType||'',reportDate:row?.lastReportDate||row?.sourceReportDate||''};}
}
function clearTransientRunState(state){
  for(const key of ['scanPool','scanResults','scanQueryStatus','trackEvents','trackResults','trackQueryStatus','needTrackBills','finalRows','nextCarryBills','failedBills'])state[key]=[];
  state.lastRun=null;
  state.currentRun=null;
  state.lastRunSummary=null;
  state.processing={running:false,paused:false,phase:''};
}
function latestBatch(reportDate=''){
  const db=getDb();
  if(reportDate){
    return db.prepare("SELECT batchId,snapshotId,reportDate,sourceName,createdAt FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC,batchId DESC LIMIT 1").get(reportDate)||null;
  }
  return db.prepare("SELECT batchId,snapshotId,reportDate,sourceName,createdAt FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC,batchId DESC LIMIT 1").get()||null;
}
function rowsForBatch(batchId){
  return getDb().prepare(`SELECT businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson
    FROM unified_import_rows WHERE batchId=? ORDER BY rowNumber,shipmentCode`).all(batchId).map(row=>{
      try{
        const parsed=JSON.parse(String(row.rowJson||'{}'));
        return {...parsed,businessType:parsed.businessType||row.businessType,shipmentCode:parsed.shipmentCode||row.shipmentCode,regionCode:parsed.regionCode||row.regionCode,recipientRaw:parsed.recipientRaw??row.recipientRaw,recipientNormalized:parsed.recipientNormalized??row.recipientNormalized,classificationReason:parsed.classificationReason||row.classificationReason};
      }catch{return {...row};}
    });
}
function countsOf(rows){
  const counts={CE:0,CEAF:0,TBKH:0,ALI1688:0,SHOPEECN:0,SHOPEEVN:0,WHPP:0};
  for(const row of rows){const type=String(row.businessType||'').toUpperCase();if(Object.hasOwn(counts,type))counts[type]+=1;}
  return counts;
}
async function hydrateReportState(reportDate=''){
  const batch=latestBatch(reportDate);
  if(!batch)return {ok:false,noImport:true};
  const key=`${batch.reportDate}:${batch.batchId}`;
  const ccslExisting=await loadState();
  const shopeeExisting=loadBusinessState(SHOPEE);
  if(ccslExisting?.reportDate===batch.reportDate&&ccslExisting?.unifiedBatchId===batch.batchId&&shopeeExisting?.reportDate===batch.reportDate&&shopeeExisting?.unifiedBatchId===batch.batchId){
    return {ok:true,skipped:true,reportDate:batch.reportDate,batchId:batch.batchId};
  }
  if(hydrationPromise&&hydrationKey===key)return hydrationPromise;
  hydrationKey=key;
  hydrationPromise=(async()=>{
    const rows=rowsForBatch(batch.batchId);
    const counts=countsOf(rows);
    // The full historical OPEN queue is intentionally loaded only when processing
    // actually starts. It is the expensive operation that previously blocked Excel uploads.
    const queue=getUnifiedProcessingQueue(batch.batchId);
    const historicalCcsl=queue.rows.filter(row=>row.sourceType==='HISTORICAL_CARRY'&&['CE','CEAF','TBKH','ALI1688'].includes(String(row.businessType||'').toUpperCase()));
    const historicalShopee=queue.rows.filter(row=>row.sourceType==='HISTORICAL_CARRY'&&['SHOPEECN','SHOPEEVN'].includes(String(row.businessType||'').toUpperCase()));
    const ccslRows=rows.filter(row=>['CE','CEAF','TBKH','ALI1688'].includes(String(row.businessType||'').toUpperCase()));
    const shopeeRows=rows.filter(row=>['SHOPEECN','SHOPEEVN'].includes(String(row.businessType||'').toUpperCase()));

    const ccsl=ccslExisting||{};
    ccsl.reportDate=batch.reportDate;
    ccsl.unifiedBatchId=batch.batchId;
    ccsl.sourceName=batch.sourceName||'';
    ccsl.dailyReportReady=true;
    ccsl.dailyParseRows=ccslRows.map(row=>({...row,result:'PNH',reason:row.classificationReason||''}));
    ccsl.dailyParseSummary={totalRecognized:ccslRows.length,pnh:ccslRows.length,nonPnh:0,excluded:0,duplicate:0};
    ccsl.pnhBills=ccslRows.map(codeOf).filter(Boolean);
    ccsl.nonPnhBills=[];ccsl.excludedBills=[];ccsl.duplicateBills=[];
    clearTransientRunState(ccsl);
    ccsl.carryBills=historicalCcsl.map(row=>String(row.shipmentCode||'').trim().toUpperCase()).filter(Boolean);
    ccsl.priorCarryRows=historicalCcsl.map(safeJsonRow);
    resetRunForReport(batch.reportDate);
    await saveState(ccsl);

    const shopee=shopeeExisting||{};
    shopee.businessType=SHOPEE;
    shopee.reportDate=batch.reportDate;
    shopee.unifiedBatchId=batch.batchId;
    shopee.sourceName=batch.sourceName||'';
    shopee.dailyReportReady=true;
    shopee.dailyParseRows=shopeeRows.map(row=>({...row,recipient_raw:row.recipientRaw,recipient_normalized:row.recipientNormalized,recipient_group:String(row.businessType||'').toUpperCase()==='SHOPEEVN'?'VN':'CN',region_code:row.regionCode,import_disposition:'ACCEPTED'}));
    shopee.dailyParseSummary={totalRecognized:shopeeRows.length,groupCounts:{CN:counts.SHOPEECN,VN:counts.SHOPEEVN},conflictCount:0};
    shopee.pnhBills=shopeeRows.map(codeOf).filter(Boolean);
    clearTransientRunState(shopee);
    shopee.carryBills=historicalShopee.map(row=>String(row.shipmentCode||'').trim().toUpperCase()).filter(Boolean);
    shopee.priorCarryRows=historicalShopee.map(safeJsonRow);
    resetBusinessRunForReport(SHOPEE,batch.reportDate);
    saveBusinessState(shopee,SHOPEE);
    return {ok:true,reportDate:batch.reportDate,batchId:batch.batchId,todayRows:rows.length,historicalCarry:queue.rows.length};
  })().finally(()=>{hydrationPromise=null;hydrationKey='';});
  return hydrationPromise;
}

async function fastImportHandler(req,res){
  const startedAt=Date.now();
  try{
    if(!req.file)throw new Error('没有收到综合日报Excel文件');
    // V102 already parsed and safety-checked this exact temporary file. Reuse that
    // object so one upload is never parsed twice.
    const parsed=req.ceQcParsedUnified||parseUnifiedDailyExcel(req.file.path,{reportDate:req.body?.reportDate||'',originalName:req.file.originalname});
    const saved=saveUnifiedImport(parsed,req.file.originalname);
    // Any prior state hydration for the same date is now stale. The next actual run
    // will rebuild current + historical queues from this newest VALID batch.
    hydrationPromise=null;hydrationKey='';
    await fs.unlink(req.file.path).catch(()=>{});
    res.setHeader('Cache-Control','no-store');
    return res.json({
      ok:true,...saved,
      processingDeferred:true,
      statePreparation:'ON_PROCESS_START',
      importElapsedMs:Date.now()-startedAt,
      patchId:V150_UNIFIED_IMPORT_FAST_ROUTE_ID
    });
  }catch(error){
    if(req.file?.path)await fs.unlink(req.file.path).catch(()=>{});
    if(res.headersSent)return;
    return res.status(400).json({ok:false,code:error?.code||'UNIFIED_IMPORT_FAILED',error:error?.message||String(error),sheetDiagnostics:error?.sheetDiagnostics||[],patchId:V150_UNIFIED_IMPORT_FAST_ROUTE_ID});
  }
}

const previousPost=express.application.post;
if(typeof previousPost==='function'&&!previousPost[WRAPPED]){
  const wrappedPost=function v150UnifiedImportFastPost(pathValue,...handlers){
    if(pathValue===IMPORT_ROUTE&&handlers.length){
      // Preserve multer/auth/safety middleware, replace only the old heavy final handler.
      handlers[handlers.length-1]=fastImportHandler;
      return previousPost.call(this,pathValue,...handlers);
    }
    if(START_ROUTES.has(pathValue)&&handlers.length){
      const finalHandler=handlers[handlers.length-1];
      if(typeof finalHandler==='function'){
        handlers[handlers.length-1]=async function v150HydrateOnRunStart(req,res,next){
          try{
            const requested=String(req.body?.reportDate||'').trim().slice(0,10);
            await hydrateReportState(requested);
            return await finalHandler.call(this,req,res,next);
          }catch(error){
            if(typeof next==='function')return next(error);
            if(!res.headersSent)return res.status(500).json({ok:false,code:'V150_STATE_PREPARATION_FAILED',error:error?.message||String(error)});
          }
        };
      }
      return previousPost.call(this,pathValue,...handlers);
    }
    return previousPost.call(this,pathValue,...handlers);
  };
  Object.defineProperty(wrappedPost,WRAPPED,{value:true});
  express.application.post=wrappedPost;
}

export const __test={latestBatch,rowsForBatch,hydrateReportState};
