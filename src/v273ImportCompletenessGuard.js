import fs from 'node:fs';
import express from 'express';
import { getDb } from './db.js';
import { parseUnifiedDailyExcel } from './unifiedExcelParser.js';

export const V273_IMPORT_COMPLETENESS_ID='2026-08-24-v273-final-history-reupload-completeness-v2';
const previousPost=express.application.post;

export function compareV273ReuploadCounts(newCount,previousCount){
  const next=Math.max(0,Number(newCount||0)),prev=Math.max(0,Number(previousCount||0));
  return{ok:prev===0||next>=prev,newCount:next,previousCount:prev,difference:next-prev};
}
function latestValidCount(reportDate,db=getDb()){
  const row=db.prepare(`SELECT b.batchId,COUNT(u.id) count FROM unified_import_batches b LEFT JOIN unified_import_rows u ON u.batchId=b.batchId WHERE b.reportDate=? AND b.status='VALID' GROUP BY b.batchId ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1`).get(reportDate);
  return{batchId:String(row?.batchId||''),count:Number(row?.count||0)};
}
async function guard(req,res,next){
  try{
    const filePath=String(req.file?.path||'');
    if(!filePath||!fs.existsSync(filePath))return res.status(422).json({ok:false,code:'V273_IMPORT_FILE_NOT_READY',error:'日报文件尚未完成接收，已阻止入库。'});
    const requestedDate=String(req.body?.reportDate||'').slice(0,10);
    const parsed=parseUnifiedDailyExcel(filePath,{reportDate:requestedDate,originalName:req.file?.originalname||''});
    const previous=latestValidCount(parsed.reportDate);
    const comparison=compareV273ReuploadCounts(parsed.summary?.validUniqueWaybills,previous.count);
    req.v273ImportCompleteness={id:V273_IMPORT_COMPLETENESS_ID,reportDate:parsed.reportDate,rawRows:Number(parsed.summary?.rawRows||0),validUniqueWaybills:Number(parsed.summary?.validUniqueWaybills||0),classifiedWaybills:Number(parsed.sourceReconciliation?.classifiedWaybills||0),previousValidWaybills:previous.count,previousBatchId:previous.batchId,sheetDiagnostics:parsed.sheetDiagnostics||[]};
    if(!parsed.sourceReconciliation?.balanced){return res.status(422).json({ok:false,code:'V273_CLASSIFICATION_NOT_BALANCED',error:'日报分类守恒失败，已阻止入库。',completeness:req.v273ImportCompleteness});}
    if(!comparison.ok){return res.status(409).json({ok:false,code:'V273_SAME_DATE_REUPLOAD_SHRINK_BLOCKED',error:`${parsed.reportDate}重新上传文件只有${comparison.newCount}个唯一运单，少于当前有效批次${comparison.previousCount}个。为防止历史单号再次丢失，本次已拒绝覆盖。请上传完整原始日报。`,completeness:req.v273ImportCompleteness});}
    return next();
  }catch(error){return res.status(422).json({ok:false,code:error?.code||'V273_IMPORT_COMPLETENESS_FAILED',error:error?.message||String(error),sheetName:error?.sheetName||'',rowNumber:error?.rowNumber||null});}
}
function responseTruth(req,res,next){const originalJson=res.json.bind(res);res.json=function(payload){if(res.statusCode<400&&payload&&req.v273ImportCompleteness)payload.importCompleteness=req.v273ImportCompleteness;return originalJson(payload);};next();}
express.application.post=function v273ImportPost(pathValue,...handlers){
  if(String(pathValue||'')==='/api/import/unified-daily-report'&&handlers.length>=1){
    const last=handlers.length-1;
    return previousPost.call(this,pathValue,...handlers.slice(0,last),guard,responseTruth,handlers[last]);
  }
  return previousPost.call(this,pathValue,...handlers);
};
console.info('[CE-QC][V273_IMPORT_COMPLETENESS]',V273_IMPORT_COMPLETENESS_ID,'guard runs after upload middleware and immediately before final import commit; same-date reupload cannot silently shrink.');
