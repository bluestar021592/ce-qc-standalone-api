import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import multer from 'multer';
import express from 'express';
import { enqueueUnifiedImport } from './v153UnifiedImportQueue.js';

export const V102_UNIFIED_IMPORT_SAFETY_GATE_ID='2026-08-15-v156-zero-db-disk-upload-ingress-v8';
const ROUTE='/api/import/unified-daily-report';
const WRAPPED=Symbol.for('ce-qc.v102-unified-import-safety');
const fastSpoolDir=path.join(process.env.LOCALAPPDATA||process.env.TEMP||process.cwd(),'CE_QC_LAUNCHER','upload_spool');
fs.mkdirSync(fastSpoolDir,{recursive:true});

const fastUnifiedUpload=multer({
  dest:fastSpoolDir,
  limits:{fileSize:80*1024*1024,files:1},
  fileFilter:(req,file,callback)=>{
    const ext=path.extname(String(file?.originalname||'')).toLowerCase();
    const accepted=['.xls','.xlsx'].includes(ext);
    callback(accepted?null:new Error('综合日报只支持 .xls 或 .xlsx。'),accepted);
  }
});

function ingressError(code,message){const error=new Error(message);error.code=code;return error;}
function validExcelName(name=''){return /\.(xlsx|xls)$/i.test(String(name||'').trim());}

// V156 hard boundary:
// For the unified-daily-report route we deliberately discard the legacy route-level
// multer middleware (whose destination is the DB/data disk) and install exactly one
// local-appdata multer middleware. App-level auth/same-origin middleware remains in
// force. After the multipart body is on C: the ingress only creates tiny LOCALAPPDATA
// queue metadata and returns HTTP 202; neither D: nor SQLite is touched before 202.
const previousPost=express.application.post;
if(typeof previousPost==='function'&&!previousPost[WRAPPED]){
  const wrappedPost=function v156UnifiedImportQueuePost(pathValue,...handlers){
    if(pathValue!==ROUTE||handlers.length===0)return previousPost.call(this,pathValue,...handlers);
    const legacyFinalHandler=handlers[handlers.length-1];
    if(typeof legacyFinalHandler!=='function')return previousPost.call(this,pathValue,...handlers);

    const queuedHandler=async function v156UnifiedImportQueueIngress(req,res,next){
      const startedAt=Date.now();
      try{
        if(!req?.file?.path)return await legacyFinalHandler.call(this,req,res,next);
        if(!validExcelName(req.file.originalname))throw ingressError('UNIFIED_IMPORT_FILE_TYPE','综合日报只支持 .xls 或 .xlsx。');
        const queued=await enqueueUnifiedImport({tempPath:req.file.path,originalName:req.file.originalname,manualReportDate:req.body?.reportDate||''});
        res.setHeader('Cache-Control','no-store');
        res.setHeader('X-CE-QC-Import-Path','V156-LOCALAPPDATA-ZERO-DB-DISK');
        return res.status(202).json({ok:true,queued:true,...queued,uploadElapsedMs:Date.now()-startedAt,patchId:'2026-08-15-v156-zero-db-disk-upload-v1',message:'日报已接收，正在自动识别并分类，可以继续上传下一份。'});
      }catch(error){
        if(req?.file?.path)await fsPromises.unlink(req.file.path).catch(()=>{});
        console.error('[CE-QC][V156_IMPORT_INGRESS]',error?.code||'',error?.message||error);
        if(res.headersSent)return;
        return res.status(400).json({ok:false,code:error?.code||'UNIFIED_IMPORT_QUEUE_FAILED',error:error?.message||String(error),gateId:V102_UNIFIED_IMPORT_SAFETY_GATE_ID});
      }
    };

    // IMPORTANT: do not forward any legacy route-level upload middleware here.
    // The current server route has only legacy multer + final handler; the global
    // access-control middleware is registered separately with app.use().
    return previousPost.call(this,pathValue,fastUnifiedUpload.single('file'),queuedHandler);
  };
  Object.defineProperty(wrappedPost,WRAPPED,{value:true});
  express.application.post=wrappedPost;
}

// v150 still owns process-start hydration, but it is no longer part of upload HTTP.
await import('./v150UnifiedImportFastRoutePatch.js');
