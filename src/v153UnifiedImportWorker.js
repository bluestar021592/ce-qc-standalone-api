import { parentPort, workerData } from 'node:worker_threads';
import fs from 'fs/promises';
import { parseUnifiedDailyExcel } from './unifiedExcelParser.js';
import { assertUnifiedImportSafety } from './unifiedImportSafety.js';
import { persistUnifiedUploadFast } from './v150UnifiedImportFastRoutePatch.js';
import { closeDb } from './db.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function isSqliteBusy(error){
  const text=`${error?.code||''} ${error?.message||''}`.toUpperCase();
  return text.includes('SQLITE_BUSY')||text.includes('SQLITE_LOCKED')||text.includes('DATABASE IS LOCKED')||text.includes('DATABASE TABLE IS LOCKED');
}
async function persistWithRetry(parsed,originalName){
  let lastError=null;
  for(let attempt=1;attempt<=8;attempt+=1){
    try{return persistUnifiedUploadFast(parsed,originalName);}
    catch(error){
      lastError=error;
      if(!isSqliteBusy(error)||attempt>=8)throw error;
      try{closeDb();}catch{}
      const delay=Math.min(8000,350*(2**(attempt-1)));
      parentPort?.postMessage({type:'phase',phase:'WAITING_SQLITE',reportDate:parsed.reportDate||'',total:Number(parsed.summary?.validUniqueWaybills||0),retryAttempt:attempt,retryDelayMs:delay});
      await sleep(delay);
    }
  }
  throw lastError||new Error('SQLite写入重试失败');
}

function classificationPreview(parsed,safety){
  return {
    ok:true,previewOnly:true,processingDeferred:true,reportDate:parsed.reportDate||'',
    dateDetectionSource:parsed.dateDetectionSource||'',dateCandidates:parsed.dateCandidates||[],dateConflict:Boolean(parsed.dateConflict),
    dateWasManuallyCorrected:Boolean(parsed.dateWasManuallyCorrected),containerFormat:parsed.containerFormat||'',
    classificationCounts:parsed.classificationCounts||{},sourceReconciliation:parsed.sourceReconciliation||{},regionCounts:parsed.regionCounts||{},
    summary:parsed.summary||{},sheetDiagnostics:parsed.sheetDiagnostics||[],warnings:parsed.warnings||[],safetyGateId:safety?.gateId||'',
    classificationPolicy:'CLASSIFY_FIRST_PERSIST_BACKGROUND_V155'
  };
}

async function main(){
  const startedAt=Date.now();
  const {filePath,originalName='',manualReportDate=''}=workerData||{};
  try{
    if(!filePath)throw new Error('导入队列文件路径为空');
    parentPort?.postMessage({type:'phase',phase:'PARSING'});
    const parsed=parseUnifiedDailyExcel(filePath,{reportDate:manualReportDate||'',originalName});
    parentPort?.postMessage({type:'phase',phase:'VALIDATING',reportDate:parsed.reportDate||'',total:Number(parsed.summary?.validUniqueWaybills||0)});
    const safety=assertUnifiedImportSafety({filePath,parsed,manualReportDate});

    // Classification is the user-facing result. Publish it immediately, before any
    // large SQLite write, so the import page behaves like the original workflow:
    // upload -> recognize -> auto classify. Persistence continues in background.
    const preview=classificationPreview(parsed,safety);
    parentPort?.postMessage({type:'classified',preview});

    parentPort?.postMessage({type:'phase',phase:'PERSISTING',reportDate:parsed.reportDate||'',total:Number(parsed.summary?.validUniqueWaybills||0)});
    const saved=await persistWithRetry(parsed,originalName);
    parentPort?.postMessage({type:'done',result:{ok:true,...saved,processingDeferred:true,statePreparation:'ON_PROCESS_START',workerElapsedMs:Date.now()-startedAt,safetyGateId:safety.gateId,queueWorker:'V155'}});
  }catch(error){
    parentPort?.postMessage({type:'failed',error:{code:error?.code||'UNIFIED_IMPORT_WORKER_FAILED',message:error?.message||String(error),shipmentCode:error?.shipmentCode||'',sheetDiagnostics:error?.sheetDiagnostics||[]}});
  }finally{
    try{closeDb();}catch{}
    try{await fs.unlink(filePath);}catch{}
  }
}
await main();
