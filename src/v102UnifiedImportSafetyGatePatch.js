import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import multer from 'multer';
import express from 'express';
import { enqueueUnifiedImport } from './v153UnifiedImportQueue.js';

export const V102_UNIFIED_IMPORT_SAFETY_GATE_ID='2026-08-15-v155-local-spool-classification-first-v7';
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

// V155 upload boundary:
// 1) Multipart bytes land on the local launcher spool instead of the large DB/data disk.
// 2) HTTP ingress only registers the already-received spool file and returns 202.
// 3) Excel parsing/classification and SQLite persistence stay in an isolated Worker.
// This restores the old "upload -> recognize -> auto classify" experience without
// putting 15+ GiB SQLite work back onto the browser request thread.
const previousPost=express.application.post;
if(typeof previousPost==='function'&&!previousPost[WRAPPED]){
  const wrappedPost=function v155UnifiedImportQueuePost(pathValue,...handlers){
    if(pathValue!==ROUTE||handlers.length===0)return previousPost.call(this,pathValue,...handlers);
    const legacyFinalHandler=handlers.pop();
    if(typeof legacyFinalHandler!=='function')return previousPost.call(this,pathValue,...handlers,legacyFinalHandler);

    const routeHandlers=[...handlers];
    const multerIndex=routeHandlers.findIndex(handler=>typeof handler==='function'&&/multer/i.test(String(handler.name||'')));
    if(multerIndex>=0)routeHandlers[multerIndex]=fastUnifiedUpload.single('file');
    else if(routeHandlers.length===1)routeHandlers[0]=fastUnifiedUpload.single('file');

    const queuedHandler=async function v155UnifiedImportQueueIngress(req,res,next){
      const startedAt=Date.now();
      try{
        if(!req?.file?.path)return await legacyFinalHandler.call(this,req,res,next);
        if(!validExcelName(req.file.originalname))throw ingressError('UNIFIED_IMPORT_FILE_TYPE','综合日报只支持 .xls 或 .xlsx。');
        const queued=await enqueueUnifiedImport({tempPath:req.file.path,originalName:req.file.originalname,manualReportDate:req.body?.reportDate||''});
        res.setHeader('Cache-Control','no-store');
        res.setHeader('X-CE-QC-Import-Path','V155-LOCAL-SPOOL-WORKER-CLASSIFICATION');
        return res.status(202).json({ok:true,queued:true,...queued,uploadElapsedMs:Date.now()-startedAt,patchId:'2026-08-15-v155-classification-first-v1',message:'日报已接收，正在自动识别并分类，可以继续上传下一份。'});
      }catch(error){
        if(req?.file?.path)await fsPromises.unlink(req.file.path).catch(()=>{});
        console.error('[CE-QC][V155_IMPORT_INGRESS]',error?.code||'',error?.message||error);
        if(res.headersSent)return;
        return res.status(400).json({ok:false,code:error?.code||'UNIFIED_IMPORT_QUEUE_FAILED',error:error?.message||String(error),gateId:V102_UNIFIED_IMPORT_SAFETY_GATE_ID});
      }
    };
    return previousPost.call(this,pathValue,...routeHandlers,queuedHandler);
  };
  Object.defineProperty(wrappedPost,WRAPPED,{value:true});
  express.application.post=wrappedPost;
}

// v150 still owns process-start hydration, but it is no longer part of upload HTTP.
await import('./v150UnifiedImportFastRoutePatch.js');
