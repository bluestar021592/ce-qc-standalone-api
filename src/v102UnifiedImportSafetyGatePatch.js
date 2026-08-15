import fsPromises from 'fs/promises';
import express from 'express';
import { enqueueUnifiedImport } from './v153UnifiedImportQueue.js';

export const V102_UNIFIED_IMPORT_SAFETY_GATE_ID='2026-08-15-v153-queue-ingress-v6';
const ROUTE='/api/import/unified-daily-report';
const WRAPPED=Symbol.for('ce-qc.v102-unified-import-safety');

function ingressError(code,message){const error=new Error(message);error.code=code;return error;}
function validExcelName(name=''){return /\.(xlsx|xls)$/i.test(String(name||'').trim());}

// V153 architectural boundary:
// HTTP upload ingress never parses Excel and never opens SQLite. Multer has already
// persisted the request body to a temporary file. We atomically move that file into
// a durable queue and immediately return HTTP 202. Parsing, safety validation and
// SQLite persistence run in an isolated Worker so a large XLS/15+ GiB DB can never
// freeze the browser request again.
const previousPost=express.application.post;
if(typeof previousPost==='function'&&!previousPost[WRAPPED]){
  const wrappedPost=function v153UnifiedImportQueuePost(pathValue,...handlers){
    if(pathValue!==ROUTE||handlers.length===0)return previousPost.call(this,pathValue,...handlers);
    const legacyFinalHandler=handlers.pop();
    if(typeof legacyFinalHandler!=='function')return previousPost.call(this,pathValue,...handlers,legacyFinalHandler);

    const queuedHandler=async function v153UnifiedImportQueueIngress(req,res,next){
      const startedAt=Date.now();
      try{
        if(!req?.file?.path)return await legacyFinalHandler.call(this,req,res,next);
        if(!validExcelName(req.file.originalname))throw ingressError('UNIFIED_IMPORT_FILE_TYPE','综合日报只支持 .xls 或 .xlsx。');
        const queued=await enqueueUnifiedImport({tempPath:req.file.path,originalName:req.file.originalname,manualReportDate:req.body?.reportDate||''});
        res.setHeader('Cache-Control','no-store');
        res.setHeader('X-CE-QC-Import-Path','V153-DURABLE-WORKER-QUEUE');
        return res.status(202).json({ok:true,queued:true,...queued,uploadElapsedMs:Date.now()-startedAt,patchId:'2026-08-15-v153-durable-worker-queue-v1',message:'日报已接收并进入后台导入队列，可以继续上传下一份。'});
      }catch(error){
        if(req?.file?.path)await fsPromises.unlink(req.file.path).catch(()=>{});
        console.error('[CE-QC][V153_IMPORT_INGRESS]',error?.code||'',error?.message||error);
        if(res.headersSent)return;
        return res.status(400).json({ok:false,code:error?.code||'UNIFIED_IMPORT_QUEUE_FAILED',error:error?.message||String(error),gateId:V102_UNIFIED_IMPORT_SAFETY_GATE_ID});
      }
    };
    return previousPost.call(this,pathValue,...handlers,queuedHandler);
  };
  Object.defineProperty(wrappedPost,WRAPPED,{value:true});
  express.application.post=wrappedPost;
}

// v150 still owns process-start hydration, but it is no longer part of upload HTTP.
await import('./v150UnifiedImportFastRoutePatch.js');
