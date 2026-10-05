import express from 'express';
import { inspectV499FreshStartTrackingPolicy } from './v499FreshStartTrackingPolicy.js';

export const V501_FRESH_START_MANUAL_TRACKING_GATE_ID='2026-10-05-v641-allow-explicit-single-day-manual-v246-v1';
const TARGET_PATH='/api/v246/tracking/reconcile';
const previousPost=express.application.post;
let wrappedRegistration=false;

function guardV246ManualHandler(handler){
  return function v501FreshStartManualGuard(req,res,next){
    const policy=inspectV499FreshStartTrackingPolicy();
    if(policy.waitingForFreshStart){
      const body=req.body||{};
      const from=String(body.fromDate||'').slice(0,10),to=String(body.toDate||'').slice(0,10);
      const explicitSingleDay=/^\d{4}-\d{2}-\d{2}$/.test(from)&&from===to;
      if(!explicitSingleDay){
        return res.status(423).json({
          ok:false,
          code:'V501_LEGACY_WIDE_RANGE_BLOCKED',
          version:V501_FRESH_START_MANUAL_TRACKING_GATE_ID,
          error:'旧数据库仅允许明确指定单日报日期的定向补查；已阻止全库或长区间150,000+票补核。无需清空数据，请选择具体日报日期后重试。'
        });
      }
      req.v501ScopedLegacyAllowed=true;
    }
    return handler(req,res,next);
  };
}

express.application.post=function v501FreshStartPost(pathValue,...handlers){
  if(String(pathValue||'')===TARGET_PATH&&handlers.length){
    wrappedRegistration=true;
    const guarded=handlers.map(handler=>typeof handler==='function'?guardV246ManualHandler(handler):handler);
    return previousPost.call(this,pathValue,...guarded);
  }
  return previousPost.call(this,pathValue,...handlers);
};

export function inspectV501FreshStartManualTrackingGate(){
  return {
    id:V501_FRESH_START_MANUAL_TRACKING_GATE_ID,
    targetPath:TARGET_PATH,
    wrappedRegistration,
    policy:inspectV499FreshStartTrackingPolicy()
  };
}

console.info('[CE-QC][V501_FRESH_START_MANUAL_TRACKING_GATE]',JSON.stringify(inspectV501FreshStartManualTrackingGate()));
