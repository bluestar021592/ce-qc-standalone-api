import express from 'express';
import { getUnifiedImportJob, getUnifiedImportQueueSummary } from './v153UnifiedImportQueue.js';

export const V153_RUNTIME_BUILD_ID='2026-08-15-v154-runtime-build-queue-status-v2';
let installed=false;
const previousListen=express.application.listen;

express.application.listen=function v154RuntimeBuildListen(...args){
  if(!installed){
    installed=true;
    this.get('/api/runtime-build',(req,res)=>{
      res.setHeader('Cache-Control','no-store, max-age=0');
      res.json({ok:true,buildId:process.env.CE_QC_UI_BUILD_ID||V153_RUNTIME_BUILD_ID});
    });
    this.get('/api/import/unified-queue',(req,res)=>{
      const {queueDir,...summary}=getUnifiedImportQueueSummary();
      res.setHeader('Cache-Control','no-store, max-age=0');
      res.json({ok:true,...summary});
    });
    this.get('/api/import/unified-queue/:jobId',(req,res)=>{
      const job=getUnifiedImportJob(String(req.params?.jobId||''));
      res.setHeader('Cache-Control','no-store, max-age=0');
      if(!job)return res.status(404).json({ok:false,code:'IMPORT_JOB_NOT_FOUND',error:'导入任务不存在或已清理。'});
      res.json({ok:true,job});
    });
  }
  return previousListen.apply(this,args);
};
