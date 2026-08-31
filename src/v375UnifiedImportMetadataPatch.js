import express from 'express';
import { getDb } from './db.js';

export const V375_UNIFIED_IMPORT_METADATA_ID='2026-08-31-v376-bootstrap-latest-snapshot-metadata-v2';

const BUSINESS_TYPES=Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const originalGet=express.application.get;

function json(value,fallback){
  try{return value?JSON.parse(value):fallback;}catch{return fallback;}
}
function numericCounts(base={}){
  return Object.fromEntries(BUSINESS_TYPES.map(type=>[type,Number(base?.[type]||0)]));
}
function sourceReconciliation(classificationCounts,validUniqueWaybills){
  const counts=numericCounts(classificationCounts);
  const classifiedWaybills=Object.values(counts).reduce((sum,value)=>sum+Number(value||0),0);
  const validUnique=Number(validUniqueWaybills||0);
  return{businessTypes:[...BUSINESS_TYPES],validUniqueWaybills:validUnique,classifiedWaybills,difference:classifiedWaybills-validUnique,balanced:classifiedWaybills===validUnique};
}
function carryoverSummary(db,reportDate){
  const row=db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN status='OPEN' AND sourceReportDate=? THEN 1 ELSE 0 END),0) todayOpen,
    COALESCE(SUM(CASE WHEN status='OPEN' AND sourceReportDate<? THEN 1 ELSE 0 END),0) historicalOpen,
    COALESCE(SUM(CASE WHEN lastReportDate=? AND sourceReportDate<? THEN 1 ELSE 0 END),0) rechecked,
    COALESCE(SUM(CASE WHEN status='OPEN' AND lastReportDate<=? THEN 1 ELSE 0 END),0) currentOpen
    FROM carryover_open_items`).get(reportDate,reportDate,reportDate,reportDate,reportDate)||{};
  return{todayOpen:Number(row.todayOpen||0),historicalOpen:Number(row.historicalOpen||0),rechecked:Number(row.rechecked||0),currentOpen:Number(row.currentOpen||0)};
}

export function readV375LatestUnifiedImport(db=getDb()){
  const row=db.prepare("SELECT * FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC LIMIT 1").get();
  if(!row)return null;
  const snapshot=db.prepare('SELECT status,payloadJson,createdAt FROM unified_snapshots WHERE snapshotId=? LIMIT 1').get(row.snapshotId)||{};
  const payload=json(snapshot.payloadJson,{});
  const grouped=db.prepare('SELECT businessType,COUNT(*) count FROM unified_import_rows WHERE batchId=? GROUP BY businessType').all(row.batchId);
  const classificationCounts=numericCounts(Object.fromEntries(grouped.map(item=>[String(item.businessType||'').toUpperCase(),Number(item.count||0)])));
  const classifiedTotal=Object.values(classificationCounts).reduce((sum,value)=>sum+value,0);

  const batchSummary=json(row.summaryJson,{});
  const payloadSummary=payload?.summary&&typeof payload.summary==='object'?payload.summary:{};
  const batchValid=Number(batchSummary?.validUniqueWaybills||0);
  const summary=(batchValid>0||classifiedTotal===0)
    ?{...payloadSummary,...batchSummary}
    :{...batchSummary,...payloadSummary};
  if(!Number(summary.validUniqueWaybills||0)&&classifiedTotal>0)summary.validUniqueWaybills=classifiedTotal;

  const storedRegions=json(row.regionCountsJson,{});
  const payloadRegions=payload?.regionCounts&&typeof payload.regionCounts==='object'?payload.regionCounts:{};
  const regionRows=db.prepare("SELECT UPPER(COALESCE(regionCode,'')) regionCode,COUNT(*) count FROM unified_import_rows WHERE batchId=? GROUP BY UPPER(COALESCE(regionCode,''))").all(row.batchId);
  const derivedRegions={PP:0,PV:0,UNKNOWN:0};
  for(const item of regionRows){
    const code=String(item.regionCode||'').toUpperCase();
    if(code==='PP')derivedRegions.PP+=Number(item.count||0);
    else if(code==='PV')derivedRegions.PV+=Number(item.count||0);
    else derivedRegions.UNKNOWN+=Number(item.count||0);
  }
  const candidateRegions={
    PP:Number(storedRegions.PP??payloadRegions.PP??0),
    PV:Number(storedRegions.PV??payloadRegions.PV??0),
    UNKNOWN:Number(storedRegions.UNKNOWN??payloadRegions.UNKNOWN??0)
  };
  const candidateRegionTotal=candidateRegions.PP+candidateRegions.PV+candidateRegions.UNKNOWN;
  const derivedRegionTotal=derivedRegions.PP+derivedRegions.PV+derivedRegions.UNKNOWN;
  const regionCounts=(candidateRegionTotal===classifiedTotal||derivedRegionTotal===0)?candidateRegions:derivedRegions;

  const batchCandidates=json(row.dateCandidatesJson,[]);
  const dateCandidates=batchCandidates.length?batchCandidates:(Array.isArray(payload.dateCandidates)?payload.dateCandidates:[]);
  const dateDetectionSource=String(row.dateDetectionSource||payload.dateDetectionSource||'').trim();
  const containerFormat=String(payload.containerFormat||'').trim();
  const sourceRecon=sourceReconciliation(classificationCounts,summary.validUniqueWaybills);
  return{
    batchId:row.batchId,snapshotId:row.snapshotId,reportDate:row.reportDate,sourceName:row.sourceName||'',fileHash:row.fileHash||'',
    classificationCounts,sourceReconciliation:sourceRecon,
    dateDetectionSource,dateCandidates,dateConflict:Boolean(payload.dateConflict??(dateCandidates.length>1)),dateWasManuallyCorrected:Boolean(row.dateWasManuallyCorrected||payload.dateWasManuallyCorrected),
    containerFormat,regionCounts,summary,sheetDiagnostics:Array.isArray(payload.sheetDiagnostics)?payload.sheetDiagnostics:[],warnings:json(row.warningsJson,[]),
    carryover:carryoverSummary(db,row.reportDate),duplicateFile:false,snapshotStatus:String(snapshot.status||'IMPORTED'),metadataHydrationId:V375_UNIFIED_IMPORT_METADATA_ID
  };
}

function latestHandler(req,res){
  try{
    res.setHeader('X-CE-QC-V375-Metadata',V375_UNIFIED_IMPORT_METADATA_ID);
    return res.json({ok:true,import:readV375LatestUnifiedImport()});
  }catch(error){return res.status(500).json({ok:false,error:`V375 日报状态回读失败：${error?.message||error}`});}
}

function wrapBootstrapHandler(handler){
  return async function v376HydratedBootstrap(req,res,next){
    const originalJson=res.json.bind(res);
    let restored=false;
    res.json=function v376BootstrapJson(payload){
      if(restored)return originalJson(payload);
      restored=true;
      try{
        if(payload&&typeof payload==='object'&&payload.ok!==false){
          const hydrated=readV375LatestUnifiedImport();
          payload={...payload,unifiedImport:hydrated};
          res.setHeader('X-CE-QC-V375-Metadata',V375_UNIFIED_IMPORT_METADATA_ID);
        }
      }catch(error){
        console.warn('[CE-QC][V376_BOOTSTRAP_METADATA] hydration skipped:',error?.message||error);
      }
      return originalJson(payload);
    };
    try{return await handler.call(this,req,res,next);}
    finally{res.json=originalJson;}
  };
}

express.application.get=function v375UnifiedImportMetadataGet(route,...handlers){
  const path=String(route||'');
  if(path==='/api/import/unified-latest')return originalGet.call(this,route,latestHandler);
  if(path==='/api/bootstrap'&&handlers.length){
    const nextHandlers=[...handlers];
    const index=nextHandlers.length-1;
    if(typeof nextHandlers[index]==='function')nextHandlers[index]=wrapBootstrapHandler(nextHandlers[index]);
    return originalGet.call(this,route,...nextHandlers);
  }
  return originalGet.call(this,route,...handlers);
};

console.info('[CE-QC][V375_IMPORT_METADATA]',V375_UNIFIED_IMPORT_METADATA_ID,'bootstrap + unified-latest read one exact latest VALID snapshot metadata truth; date/container/PP-PV/summary survive reload and processing polls; no database writes or schema changes.');
