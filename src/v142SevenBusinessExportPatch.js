import express from 'express';
import path from 'path';
import { auditSevenBusinessHistory } from './v142SevenBusinessHistoryAudit.js';
import { exportSevenBusinessPeriodReports } from './v142SevenBusinessPeriodExporter.js';

const PATCH_ID='2026-08-16-v142-seven-business-export-preflight-v2';
const WRAPPED_GET=Symbol.for('ce-qc.v142-export-get');

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

const previousGet=express.application.get;
if(typeof previousGet==='function'&&!previousGet[WRAPPED_GET]){
  const wrapped=function v142Get(pathValue,...handlers){
    if(String(pathValue||'')==='/api/export-period')return previousGet.call(this,pathValue,downloadHandler);
    return previousGet.call(this,pathValue,...handlers);
  };
  Object.defineProperty(wrapped,WRAPPED_GET,{value:true});express.application.get=wrapped;
}

// POST /api/export-period/prepare deliberately remains owned by V84 asynchronous
// export jobs. Its worker imports the V142 read-only audit before generating files,
// so large range exports stay responsive while still failing closed on missing days.
let installed=false;const previousListen=express.application.listen;
express.application.listen=function v142Listen(...args){if(!installed){installed=true;this.get('/api/v142/history-integrity',auditHandler);}return previousListen.apply(this,args);};

export const V142_SEVEN_BUSINESS_EXPORT_PATCH_ID=PATCH_ID;
