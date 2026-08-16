import express from 'express';
import path from 'path';
import { auditSevenBusinessHistory } from './v142SevenBusinessHistoryAudit.js';
import { exportSevenBusinessPeriodReports } from './v142SevenBusinessPeriodExporter.js';

const PATCH_ID='2026-08-16-v142-seven-business-export-preflight-v1';
const WRAPPED_GET=Symbol.for('ce-qc.v142-export-get');
const WRAPPED_POST=Symbol.for('ce-qc.v142-export-post');

function auditHandler(req,res){
  try{
    const payload=auditSevenBusinessHistory({fromDate:req.query.fromDate||'2026-07-01',toDate:req.query.toDate||''});
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
    res.json(payload);
  }catch(error){res.status(400).json({ok:false,patchId:PATCH_ID,error:error.message||String(error)});}
}
async function downloadHandler(req,res){
  try{
    const result=await exportSevenBusinessPeriodReports({periodType:req.query.periodType||'daily',date:req.query.date||'',fromDate:req.query.fromDate||'',toDate:req.query.toDate||'',businessType:req.query.businessType||'ALL'});
    res.setHeader('X-CE-QC-Export','V142-SEVEN-BUSINESS-STRICT');
    res.download(result.file,path.basename(result.file));
  }catch(error){res.status(400).json({ok:false,patchId:PATCH_ID,error:error.message||String(error)});}
}
async function prepareHandler(req,res){
  try{
    const result=await exportSevenBusinessPeriodReports({periodType:req.body?.periodType||'daily',date:req.body?.date||'',fromDate:req.body?.fromDate||'',toDate:req.body?.toDate||'',businessType:req.body?.businessType||'ALL'});
    const unique=[...new Set([...result.files,result.file])];
    res.json({ok:true,patchId:PATCH_ID,range:result.range,snapshotIds:result.snapshots,audit:{expectedDays:result.audit.expectedDays,totalImported:result.audit.totalImported,totalRetryPending:result.audit.totalRetryPending,exportStatus:result.audit.exportStatus},files:unique.map(file=>({name:path.basename(file),url:`/api/export-file?name=${encodeURIComponent(path.basename(file))}`}))});
  }catch(error){res.status(400).json({ok:false,patchId:PATCH_ID,error:error.message||String(error)});}
}

const previousGet=express.application.get;
if(typeof previousGet==='function'&&!previousGet[WRAPPED_GET]){
  const wrapped=function v142Get(pathValue,...handlers){
    if(String(pathValue||'')==='/api/export-period')return previousGet.call(this,pathValue,downloadHandler);
    return previousGet.call(this,pathValue,...handlers);
  };
  Object.defineProperty(wrapped,WRAPPED_GET,{value:true});express.application.get=wrapped;
}
const previousPost=express.application.post;
if(typeof previousPost==='function'&&!previousPost[WRAPPED_POST]){
  const wrapped=function v142Post(pathValue,...handlers){
    if(String(pathValue||'')==='/api/export-period/prepare')return previousPost.call(this,pathValue,prepareHandler);
    return previousPost.call(this,pathValue,...handlers);
  };
  Object.defineProperty(wrapped,WRAPPED_POST,{value:true});express.application.post=wrapped;
}
let installed=false;const previousListen=express.application.listen;
express.application.listen=function v142Listen(...args){if(!installed){installed=true;this.get('/api/v142/history-integrity',auditHandler);}return previousListen.apply(this,args);};

export const V142_SEVEN_BUSINESS_EXPORT_PATCH_ID=PATCH_ID;
