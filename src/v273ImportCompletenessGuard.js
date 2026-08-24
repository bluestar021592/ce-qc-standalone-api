import fs from 'node:fs';
import express from 'express';
import { getDb, nowIso } from './db.js';
import { parseUnifiedDailyExcel } from './unifiedExcelParser.js';

export const V273_IMPORT_COMPLETENESS_ID='2026-08-24-v273-final-history-reupload-completeness-v3';
const previousPost=express.application.post;

export function compareV273ReuploadCounts(newCount,previousCount){
  const next=Math.max(0,Number(newCount||0)),prev=Math.max(0,Number(previousCount||0));
  return{ok:prev===0||next>=prev,newCount:next,previousCount:prev,difference:next-prev};
}
function latestValidCount(reportDate,db=getDb()){
  const row=db.prepare(`SELECT b.batchId,b.fileHash,COUNT(u.id) count FROM unified_import_batches b LEFT JOIN unified_import_rows u ON u.batchId=b.batchId WHERE b.reportDate=? AND b.status='VALID' GROUP BY b.batchId,b.fileHash ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1`).get(reportDate);
  return{batchId:String(row?.batchId||''),fileHash:String(row?.fileHash||''),count:Number(row?.count||0)};
}
function recoverInterruptedSameHashRepairs(db=getDb()){
  try{
    const rows=db.prepare("SELECT batchId,reportDate,fileHash,status FROM unified_import_batches WHERE status LIKE 'V273_REPARSE_PENDING:%'").all();
    for(const row of rows){
      const replacement=db.prepare("SELECT batchId FROM unified_import_batches WHERE reportDate=? AND fileHash=? AND status='VALID' AND batchId<>? ORDER BY createdAt DESC LIMIT 1").get(row.reportDate,row.fileHash,row.batchId);
      if(replacement)db.prepare('UPDATE unified_import_batches SET status=? WHERE batchId=?').run(`SUPERSEDED_V273:${row.batchId}`,row.batchId);
      else db.prepare("UPDATE unified_import_batches SET status='VALID' WHERE batchId=?").run(row.batchId);
    }
  }catch(error){console.warn('[CE-QC][V273_IMPORT_COMPLETENESS] pending repair recovery skipped:',error?.message||error);}
}
function prepareSameHashReparse(req,parsed,previous,db=getDb()){
  if(!previous.batchId||previous.fileHash!==parsed.fileHash||previous.count===Number(parsed.summary?.validUniqueWaybills||0))return null;
  const pending=`V273_REPARSE_PENDING:${previous.batchId}`;
  const changed=db.prepare("UPDATE unified_import_batches SET status=? WHERE batchId=? AND status='VALID'").run(pending,previous.batchId).changes;
  if(!changed)throw new Error('旧日报批次状态已变化，请重新提交一次完整日报。');
  const repair={batchId:previous.batchId,reportDate:parsed.reportDate,fileHash:parsed.fileHash,pending,preparedAt:nowIso()};
  req.v273SameHashRepair=repair;return repair;
}
function finalizeRepair(req,success,db=getDb()){
  const repair=req.v273SameHashRepair;if(!repair)return;
  try{
    if(success){db.prepare('UPDATE unified_import_batches SET status=? WHERE batchId=? AND status=?').run(`SUPERSEDED_V273:${repair.batchId}`,repair.batchId,repair.pending);}
    else{db.prepare("UPDATE unified_import_batches SET status='VALID' WHERE batchId=? AND status=?").run(repair.batchId,repair.pending);}
  }catch(error){console.warn('[CE-QC][V273_IMPORT_COMPLETENESS] repair finalization failed:',error?.message||error);}
  req.v273SameHashRepair=null;
}
async function guard(req,res,next){
  try{
    const filePath=String(req.file?.path||'');
    if(!filePath||!fs.existsSync(filePath))return res.status(422).json({ok:false,code:'V273_IMPORT_FILE_NOT_READY',error:'日报文件尚未完成接收，已阻止入库。'});
    const requestedDate=String(req.body?.reportDate||'').slice(0,10);
    const parsed=parseUnifiedDailyExcel(filePath,{reportDate:requestedDate,originalName:req.file?.originalname||''});
    const previous=latestValidCount(parsed.reportDate);
    const comparison=compareV273ReuploadCounts(parsed.summary?.validUniqueWaybills,previous.count);
    req.v273ImportCompleteness={id:V273_IMPORT_COMPLETENESS_ID,reportDate:parsed.reportDate,rawRows:Number(parsed.summary?.rawRows||0),validUniqueWaybills:Number(parsed.summary?.validUniqueWaybills||0),classifiedWaybills:Number(parsed.sourceReconciliation?.classifiedWaybills||0),previousValidWaybills:previous.count,previousBatchId:previous.batchId,sameSourceFile:previous.fileHash===parsed.fileHash,sheetDiagnostics:parsed.sheetDiagnostics||[]};
    if(!parsed.sourceReconciliation?.balanced)return res.status(422).json({ok:false,code:'V273_CLASSIFICATION_NOT_BALANCED',error:'日报分类守恒失败，已阻止入库。',completeness:req.v273ImportCompleteness});
    if(!comparison.ok)return res.status(409).json({ok:false,code:'V273_SAME_DATE_REUPLOAD_SHRINK_BLOCKED',error:`${parsed.reportDate}重新上传文件只有${comparison.newCount}个唯一运单，少于当前有效批次${comparison.previousCount}个。为防止历史单号再次丢失，本次已拒绝覆盖。请上传完整原始日报。`,completeness:req.v273ImportCompleteness});
    if(previous.fileHash===parsed.fileHash&&comparison.difference>0)prepareSameHashReparse(req,parsed,previous);
    return next();
  }catch(error){finalizeRepair(req,false);return res.status(422).json({ok:false,code:error?.code||'V273_IMPORT_COMPLETENESS_FAILED',error:error?.message||String(error),sheetName:error?.sheetName||'',rowNumber:error?.rowNumber||null});}
}
function responseTruth(req,res,next){
  const originalJson=res.json.bind(res);let finalized=false;
  const finish=success=>{if(finalized)return;finalized=true;finalizeRepair(req,success);};
  res.json=function(payload){const success=res.statusCode<400;if(success&&payload&&req.v273ImportCompleteness){payload.importCompleteness=req.v273ImportCompleteness;if(req.v273SameHashRepair)payload.importCompleteness.sameFileReparsed=true;}const out=originalJson(payload);finish(success);return out;};
  res.once('finish',()=>finish(res.statusCode<400));res.once('close',()=>{if(!res.writableEnded)finish(false);});next();
}
express.application.post=function v273ImportPost(pathValue,...handlers){
  if(String(pathValue||'')==='/api/import/unified-daily-report'&&handlers.length>=1){const last=handlers.length-1;return previousPost.call(this,pathValue,...handlers.slice(0,last),guard,responseTruth,handlers[last]);}
  return previousPost.call(this,pathValue,...handlers);
};
setImmediate(()=>recoverInterruptedSameHashRepairs());
console.info('[CE-QC][V273_IMPORT_COMPLETENESS]',V273_IMPORT_COMPLETENESS_ID,'guard runs after upload and before commit; same-file parser repairs are safely re-imported; smaller same-date reuploads are blocked.');
