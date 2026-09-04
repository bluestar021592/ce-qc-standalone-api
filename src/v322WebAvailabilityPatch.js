import express from 'express';
import { getDb } from './db.js';
import {
  PROCESSING_STATUS_CORE_ID,
  V322_WEB_AVAILABILITY_ID,
  V322_SEVEN_BUSINESS_STATUS_ID,
  V322_WHPP_COMPLETION_PARITY_ID,
  V418_V322_LIGHTWEIGHT_COMPLETED_CLAIM_ID,
  V419_SCALAR_STATUS_PRIORITY_ID,
  V419_STATUS_TIMING_ID,
  V424_SAME_LIFECYCLE_COMPLETION_FALLBACK_ID,
  readSevenBusinessStatus,
  readRunProgress
} from './processingStatusCore.js';
import { V418_STATUS_PROOF_FAST_PATH_ID } from './v418StatusProofFastPath.js';

export {
  PROCESSING_STATUS_CORE_ID,
  V322_WEB_AVAILABILITY_ID,
  V322_SEVEN_BUSINESS_STATUS_ID,
  V322_WHPP_COMPLETION_PARITY_ID,
  V418_V322_LIGHTWEIGHT_COMPLETED_CLAIM_ID,
  V419_SCALAR_STATUS_PRIORITY_ID,
  V419_STATUS_TIMING_ID,
  V424_SAME_LIFECYCLE_COMPLETION_FALLBACK_ID
} from './processingStatusCore.js';

const previousGet=express.application.get;
const STATUS_ROUTE='/api/v33/run-progress';
const text=value=>String(value??'').trim();
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const normalizeDate=value=>{const s=text(value).replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const tick=()=>process.hrtime.bigint();
const elapsed=start=>Math.max(0,Number(process.hrtime.bigint()-start)/1e6);

export function readV322SevenBusinessStatus(options={}){return readSevenBusinessStatus(options);}
export function readV322RunProgress(businessType='CCSL',db=getDb(),reportDate=''){return readRunProgress(businessType,db,reportDate);}

function progressHandler(req,res){
  const started=tick();
  try{
    res.setHeader('Cache-Control','private,max-age=1');
    res.setHeader('X-CE-QC-Processing-Status-Core',PROCESSING_STATUS_CORE_ID);
    res.setHeader('X-CE-QC-V322',V322_WEB_AVAILABILITY_ID);
    res.setHeader('X-CE-QC-V322-Seven-Status',V322_SEVEN_BUSINESS_STATUS_ID);
    res.setHeader('X-CE-QC-V322-WHPP-Completion',V322_WHPP_COMPLETION_PARITY_ID);
    res.setHeader('X-CE-QC-V418-Status-Fast-Path',V418_STATUS_PROOF_FAST_PATH_ID);
    res.setHeader('X-CE-QC-V419-Scalar-Status',V419_SCALAR_STATUS_PRIORITY_ID);
    res.setHeader('X-CE-QC-V424-Same-Lifecycle-Completion',V424_SAME_LIFECYCLE_COMPLETION_FALLBACK_ID);
    const data=readRunProgress(req.query.businessType||'CCSL',getDb(),req.query.reportDate||'');
    const totalMs=Number(elapsed(started).toFixed(3)),d=data?.statusDiagnostics||{};
    res.setHeader('Server-Timing',`corestatus;dur=${totalMs},membership;dur=${n(d.membershipMs)},locks;dur=${n(d.locksMs)},ccsl;dur=${n(d.ccslMs)},shopee;dur=${n(d.shopeeMs)},whpp;dur=${n(d.whppMs)}`);
    return res.json(data);
  }catch(error){
    const totalMs=Number(elapsed(started).toFixed(3));
    res.setHeader('Server-Timing',`corestatus;dur=${totalMs}`);
    return res.status(200).json({ok:false,code:'CORE_PERSISTED_STATUS_READ_FAILED',detailCode:'V419_SCALAR_STATUS_READ_FAILED',coreStatusId:PROCESSING_STATUS_CORE_ID,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,whppCompletionPolicy:V322_WHPP_COMPLETION_PARITY_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,v419ScalarStatusId:V419_SCALAR_STATUS_PRIORITY_ID,v424SameLifecycleCompletionId:V424_SAME_LIFECYCLE_COMPLETION_FALLBACK_ID,businessType:text(req.query.businessType).toUpperCase()||'CCSL',reportDate:normalizeDate(req.query.reportDate),error:text(error?.message||error),statusDiagnostics:{id:V419_STATUS_TIMING_ID,totalMs},generatedAt:new Date().toISOString()});
  }
}

// Legacy URL retained; truth ownership is now the unversioned processingStatusCore.
express.application.get=function processingStatusCompatibilityGet(pathValue,...handlers){
  if(String(pathValue||'')===STATUS_ROUTE){this.route(pathValue).get(progressHandler);return this;}
  return previousGet.call(this,pathValue,...handlers);
};

console.info('[CE-QC][CORE_PROCESSING_STATUS_ROUTE]',PROCESSING_STATUS_CORE_ID,V322_WEB_AVAILABILITY_ID,'/api/v33/run-progress is compatibility-only; all persisted stage truth is computed once in processingStatusCore.js.');