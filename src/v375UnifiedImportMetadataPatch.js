import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, getRuntimeConfig } from './db.js';
import { parseUnifiedDailyExcel } from './unifiedExcelParser.js';

export const V375_UNIFIED_IMPORT_METADATA_ID='2026-08-31-v376-bootstrap-latest-snapshot-metadata-v2';
export const V377_UNIFIED_IMPORT_STATUS_TRUTH_ID='2026-08-31-v377-import-metadata-carryover-status-truth-v1';
export const V384_UNIFIED_IMPORT_POST_TRUTH_ID='2026-08-31-v384-import-post-hydrated-snapshot-truth-v1';
export const V387_UNIFIED_IMPORT_POST_OWNER_ID='2026-08-31-v387-final-unified-import-post-owner-v1';
export const V388_ARCHIVED_IMPORT_METADATA_ID='2026-08-31-v388-immutable-source-metadata-recovery-v1';

const BUSINESS_TYPES=Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const POST_OWNER=Symbol.for('ce-qc.v387-unified-import-post-owner');
const originalGet=express.application.get;
const archivedMetadataCache=new Map();

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
    COALESCE(SUM(CASE WHEN lastReportDate=? AND sourceReportDate<? THEN 1 ELSE 0 END),0) rechecked
    FROM carryover_open_items`).get(reportDate,reportDate,reportDate,reportDate)||{};
  const todayOpen=Number(row.todayOpen||0);
  const historicalOpen=Number(row.historicalOpen||0);
  return{
    todayOpen,
    historicalOpen,
    rechecked:Number(row.rechecked||0),
    currentOpen:todayOpen+historicalOpen,
    historicalSeparate:true,
    source:'V377_OPEN_TODAY_PLUS_HISTORICAL'
  };
}
function canonicalFileHash(value=''){
  const match=String(value||'').trim().match(/^([a-f0-9]{64})/i);
  return match?match[1].toLowerCase():'';
}
function findArchivedSourceByHash(hash=''){
  if(!hash)return'';
  const cfg=getRuntimeConfig();
  const root=path.join(cfg.dataDir,'evidence_archive','source_uploads');
  if(!fs.existsSync(root))return'';
  let folders=[];
  try{folders=fs.readdirSync(root,{withFileTypes:true}).filter(item=>item.isDirectory()).map(item=>item.name).sort().reverse();}catch{return'';}
  for(const folder of folders){
    const dir=path.join(root,folder);
    for(const ext of ['.xlsx','.xls']){
      const candidate=path.join(dir,`${hash}${ext}`);
      try{if(fs.statSync(candidate).isFile())return candidate;}catch{}
    }
  }
  return'';
}
export function recoverV388ArchivedImportMetadata(batch={}){
  const hash=canonicalFileHash(batch?.fileHash);
  if(!hash)return null;
  const key=`${hash}|${String(batch?.reportDate||'')}|${String(batch?.sourceName||'')}`;
  if(archivedMetadataCache.has(key))return archivedMetadataCache.get(key);
  const file=findArchivedSourceByHash(hash);
  if(!file){archivedMetadataCache.set(key,null);return null;}
  try{
    const originalName=String(batch?.sourceName||'').trim()||`${String(batch?.reportDate||'daily')}${path.extname(file)}`;
    let parsed;
    try{parsed=parseUnifiedDailyExcel(file,{originalName});}
    catch{parsed=parseUnifiedDailyExcel(file,{originalName,reportDate:String(batch?.reportDate||'')});}
    const result={
      recovered:true,
      recoveryId:V388_ARCHIVED_IMPORT_METADATA_ID,
      evidence:'V266_EXACT_SHA_SOURCE_UPLOAD',
      fileHash:hash,
      reportDate:String(parsed?.reportDate||batch?.reportDate||''),
      dateDetectionSource:String(parsed?.dateDetectionSource||'归档原始日报').trim()||'归档原始日报',
      dateCandidates:Array.isArray(parsed?.dateCandidates)?parsed.dateCandidates:[],
      containerFormat:String(parsed?.containerFormat||'').trim(),
      regionCounts:{PP:Number(parsed?.regionCounts?.PP||0),PV:Number(parsed?.regionCounts?.PV||0),UNKNOWN:Number(parsed?.regionCounts?.UNKNOWN||0)},
      summary:parsed?.summary&&typeof parsed.summary==='object'?parsed.summary:{},
      sheetDiagnostics:Array.isArray(parsed?.sheetDiagnostics)?parsed.sheetDiagnostics:[]
    };
    archivedMetadataCache.set(key,result);
    return result;
  }catch(error){
    console.warn('[CE-QC][V388_ARCHIVED_IMPORT_METADATA] recovery skipped:',error?.message||error);
    archivedMetadataCache.set(key,null);
    return null;
  }
}

export function readV375LatestUnifiedImport(db=getDb()){
  const row=db.prepare("SELECT * FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC,batchId DESC LIMIT 1").get();
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
  const existingDateSource=String(row.dateDetectionSource||payload.dateDetectionSource||'').trim();
  const existingContainer=String(payload.containerFormat||'').trim();
  const existingRegionEvidence=(candidateRegions.PP+candidateRegions.PV)+(derivedRegions.PP+derivedRegions.PV);
  const archiveMeta=(!existingDateSource||!existingContainer||existingRegionEvidence===0)?recoverV388ArchivedImportMetadata(row):null;
  const recoveredRegions=archiveMeta?.regionCounts||{PP:0,PV:0,UNKNOWN:0};
  const candidateRegionTotal=candidateRegions.PP+candidateRegions.PV+candidateRegions.UNKNOWN;
  const derivedRegionTotal=derivedRegions.PP+derivedRegions.PV+derivedRegions.UNKNOWN;
  let regionCounts=(candidateRegionTotal===classifiedTotal||derivedRegionTotal===0)?candidateRegions:derivedRegions;
  if(Number(regionCounts.PP||0)+Number(regionCounts.PV||0)===0&&Number(recoveredRegions.PP||0)+Number(recoveredRegions.PV||0)>0)regionCounts=recoveredRegions;

  const batchCandidates=json(row.dateCandidatesJson,[]);
  const archiveCandidates=Array.isArray(archiveMeta?.dateCandidates)?archiveMeta.dateCandidates:[];
  const dateCandidates=batchCandidates.length?batchCandidates:(Array.isArray(payload.dateCandidates)&&payload.dateCandidates.length?payload.dateCandidates:archiveCandidates);
  const dateDetectionSource=existingDateSource||String(archiveMeta?.dateDetectionSource||'数据库批次').trim()||'数据库批次';
  const containerFormat=existingContainer||String(archiveMeta?.containerFormat||'').trim();
  const sourceRecon=sourceReconciliation(classificationCounts,summary.validUniqueWaybills);
  return{
    batchId:row.batchId,snapshotId:row.snapshotId,reportDate:row.reportDate,sourceName:row.sourceName||'',fileHash:row.fileHash||'',createdAt:row.createdAt||'',
    classificationCounts,sourceReconciliation:sourceRecon,
    dateDetectionSource,dateCandidates,dateConflict:Boolean(payload.dateConflict??(dateCandidates.length>1)),dateWasManuallyCorrected:Boolean(row.dateWasManuallyCorrected||payload.dateWasManuallyCorrected),
    containerFormat,regionCounts,summary,sheetDiagnostics:Array.isArray(payload.sheetDiagnostics)&&payload.sheetDiagnostics.length?payload.sheetDiagnostics:(archiveMeta?.sheetDiagnostics||[]),warnings:json(row.warningsJson,[]),
    carryover:carryoverSummary(db,row.reportDate),duplicateFile:false,snapshotStatus:String(snapshot.status||'IMPORTED'),metadataHydrationId:V375_UNIFIED_IMPORT_METADATA_ID,statusTruthId:V377_UNIFIED_IMPORT_STATUS_TRUTH_ID,postTruthId:V384_UNIFIED_IMPORT_POST_TRUTH_ID,postOwnerRevision:V387_UNIFIED_IMPORT_POST_OWNER_ID,
    metadataRecovery:archiveMeta?{recovered:true,id:V388_ARCHIVED_IMPORT_METADATA_ID,evidence:archiveMeta.evidence}:null
  };
}

export function hydrateV384UnifiedImportPostPayload(payload,db=getDb()){
  if(!payload||typeof payload!=='object'||payload.ok!==true||payload.importCommitted!==true)return payload;
  const hydrated=readV375LatestUnifiedImport(db);
  const responseDate=String(payload.reportDate||'').trim();
  if(!hydrated||(responseDate&&String(hydrated.reportDate||'')!==responseDate))return payload;
  const state=payload.state,shopeeState=payload.shopeeState,whppState=payload.whppState,processingQueue=payload.processingQueue;
  const next={...payload,...hydrated,ok:true,importCommitted:true,postOwnerRevision:V387_UNIFIED_IMPORT_POST_OWNER_ID};
  if(state!==undefined)next.state=state;
  if(shopeeState!==undefined)next.shopeeState=shopeeState;
  if(whppState!==undefined)next.whppState=whppState;
  if(processingQueue!==undefined)next.processingQueue=processingQueue;
  return next;
}

function latestHandler(req,res){
  try{
    res.setHeader('X-CE-QC-V375-Metadata',V375_UNIFIED_IMPORT_METADATA_ID);
    res.setHeader('X-CE-QC-V377-Import-Truth',V377_UNIFIED_IMPORT_STATUS_TRUTH_ID);
    res.setHeader('X-CE-QC-V384-Import-Post-Truth',V384_UNIFIED_IMPORT_POST_TRUTH_ID);
    res.setHeader('X-CE-QC-V388-Archived-Metadata',V388_ARCHIVED_IMPORT_METADATA_ID);
    return res.json({ok:true,import:readV375LatestUnifiedImport()});
  }catch(error){return res.status(500).json({ok:false,error:`V375 日报状态回读失败：${error?.message||error}`});}
}

function wrapBootstrapHandler(handler){
  return async function v377HydratedBootstrap(req,res,next){
    const originalJson=res.json.bind(res);
    let restored=false;
    res.json=function v377BootstrapJson(payload){
      if(restored)return originalJson(payload);
      restored=true;
      try{
        if(payload&&typeof payload==='object'&&payload.ok!==false){
          const hydrated=readV375LatestUnifiedImport();
          payload={...payload,unifiedImport:hydrated};
          res.setHeader('X-CE-QC-V375-Metadata',V375_UNIFIED_IMPORT_METADATA_ID);
          res.setHeader('X-CE-QC-V377-Import-Truth',V377_UNIFIED_IMPORT_STATUS_TRUTH_ID);
          res.setHeader('X-CE-QC-V388-Archived-Metadata',V388_ARCHIVED_IMPORT_METADATA_ID);
        }
      }catch(error){
        console.warn('[CE-QC][V377_BOOTSTRAP_METADATA] hydration skipped:',error?.message||error);
      }
      return originalJson(payload);
    };
    try{return await handler.call(this,req,res,next);}
    finally{res.json=originalJson;}
  };
}

function unifiedImportPostHydrationMiddleware(req,res,next){
  const originalJson=res.json.bind(res);
  let restored=false;
  res.json=function v387ImportPostJson(payload){
    if(restored)return originalJson(payload);
    restored=true;
    res.json=originalJson;
    try{
      const hydrated=hydrateV384UnifiedImportPostPayload(payload);
      if(hydrated!==payload){
        payload=hydrated;
        res.setHeader('X-CE-QC-V384-Import-Post-Truth',V384_UNIFIED_IMPORT_POST_TRUTH_ID);
        res.setHeader('X-CE-QC-V387-Import-Post-Owner',V387_UNIFIED_IMPORT_POST_OWNER_ID);
      }
    }catch(error){
      console.warn('[CE-QC][V387_IMPORT_POST_METADATA] hydration skipped:',error?.message||error);
    }
    return originalJson(payload);
  };
  try{return next();}
  catch(error){res.json=originalJson;throw error;}
}

express.application.get=function v377UnifiedImportMetadataGet(route,...handlers){
  const routePath=String(route||'');
  if(routePath==='/api/import/unified-latest')return originalGet.call(this,route,latestHandler);
  if(routePath==='/api/bootstrap'&&handlers.length){
    const nextHandlers=[...handlers];
    const index=nextHandlers.length-1;
    if(typeof nextHandlers[index]==='function')nextHandlers[index]=wrapBootstrapHandler(nextHandlers[index]);
    return originalGet.call(this,route,...nextHandlers);
  }
  return originalGet.call(this,route,...handlers);
};

export function installV387UnifiedImportPostOwner(){
  const previousPost=express.application.post;
  if(typeof previousPost!=='function')return{installed:false,active:false,revision:V387_UNIFIED_IMPORT_POST_OWNER_ID,reason:'EXPRESS_POST_MISSING'};
  if(previousPost[POST_OWNER])return{installed:false,active:true,revision:V387_UNIFIED_IMPORT_POST_OWNER_ID,reason:'ALREADY_FINAL_OWNER'};
  const wrappedPost=function v387UnifiedImportMetadataPost(route,...handlers){
    const routePath=String(route||'');
    if(routePath==='/api/import/unified-daily-report'&&handlers.length){
      const finalHandler=handlers[handlers.length-1];
      if(typeof finalHandler!=='function')return previousPost.call(this,route,...handlers);
      return previousPost.call(this,route,...handlers.slice(0,-1),unifiedImportPostHydrationMiddleware,finalHandler);
    }
    return previousPost.call(this,route,...handlers);
  };
  Object.defineProperty(wrappedPost,POST_OWNER,{value:true});
  express.application.post=wrappedPost;
  return{installed:true,active:true,revision:V387_UNIFIED_IMPORT_POST_OWNER_ID,previousOwner:previousPost.name||'anonymous',placement:'PRE_FINAL_HANDLER_SURVIVES_V42_REPLACEMENT'};
}

console.info('[CE-QC][V375_IMPORT_METADATA]',V375_UNIFIED_IMPORT_METADATA_ID,V377_UNIFIED_IMPORT_STATUS_TRUTH_ID,'bootstrap + unified-latest read one exact latest VALID snapshot; processing queue is always open-today + open-historical; no database writes or schema changes.');
console.info('[CE-QC][V388_ARCHIVED_IMPORT_METADATA]',V388_ARCHIVED_IMPORT_METADATA_ID,'missing legacy date/container/PP-PV metadata is recovered read-only from the exact V266 SHA-archived source workbook; no database writes.');
console.info('[CE-QC][V384_IMPORT_POST_TRUTH]',V384_UNIFIED_IMPORT_POST_TRUTH_ID,'successful unified-daily-report POST payload hydration uses a pre-final response middleware so V42 final-handler replacement cannot discard it; V387 installs after earlier import wrappers.');
