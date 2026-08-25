import express from 'express';
export const V295_FIRST_ATTEMPT_INVALIDATION_ID='2026-08-25-v295-first-attempt-cache-invalidation-v1';
const previousPost=express.application.post;
const MUTATION_RE=/(?:import|purge|clear|reset|run|resume|refresh)/i;
function hook(req,res,next){
  const originalJson=res.json.bind(res);let done=false;
  res.json=function v295MutationJson(payload){const success=res.statusCode<400&&payload?.ok!==false;const out=originalJson(payload);if(success&&!done){done=true;try{globalThis.__CE_QC_INVALIDATE_V295_FIRST_ATTEMPT__?.();}catch{}}return out;};
  next();
}
express.application.post=function v295MutationRegistration(pathValue,...handlers){const path=String(pathValue||'');if(MUTATION_RE.test(path)&&handlers.length)return previousPost.call(this,pathValue,hook,...handlers);return previousPost.call(this,pathValue,...handlers);};
console.info('[CE-QC][V295_FIRST_ATTEMPT_INVALIDATION]',V295_FIRST_ATTEMPT_INVALIDATION_ID,'successful import/run/refresh/reset mutations clear V295 first-attempt cache before the next audit read.');
