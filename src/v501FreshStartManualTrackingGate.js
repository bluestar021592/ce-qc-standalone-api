import express from 'express';
import { inspectV499FreshStartTrackingPolicy } from './v499FreshStartTrackingPolicy.js';

export const V501_FRESH_START_MANUAL_TRACKING_GATE_ID='2026-09-10-v501-block-legacy-manual-v246-before-purge-v1';
const TARGET_PATH='/api/v246/tracking/reconcile';
const previousPost=express.application.post;
let wrappedRegistration=false;

function guardV246ManualHandler(handler){
  return function v501FreshStartManualGuard(req,res,next){
    const policy=inspectV499FreshStartTrackingPolicy();
    if(policy.waitingForFreshStart){
      return res.status(423).json({
        ok:false,
        code:'V501_FRESH_PURGE_REQUIRED',
        version:V501_FRESH_START_MANUAL_TRACKING_GATE_ID,
        error:'当前仍是旧数据库待清空状态，已阻止对旧账本执行150,000+票补核。请先完成“一键清空所有数据”，再重启系统后重新上传日报。'
      });
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
