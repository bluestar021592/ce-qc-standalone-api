import express from 'express';
import { auditV203Waybills, persistV203ManualQuery, V203_BUSINESS_TYPES, V203_MANUAL_EVIDENCE_VERSION } from './v203ManualEvidenceStore.js';
import { backfillV204LegacyManualEvidence, inspectV204LegacyManualBackfill } from './v204LegacyManualEvidenceBackfill.js';

export const V203_MANUAL_QUERY_PATCH_VERSION='2026-08-18-v204-seven-business-manual-query-persistence-v2';
const originalPost=express.application.post;
const EXACT_TYPES=new Set(V203_BUSINESS_TYPES);
let wrappedRegistration=false;
let backfillScheduled=false;

function exactRequestedType(req={}){
  const raw=String(req.body?.businessType||'').trim().toUpperCase().replace(/\s+/g,'');
  return EXACT_TYPES.has(raw)?raw:'';
}
function legacyEngineType(type=''){
  return /^SHOPEE/.test(type)?'SHOPEE':'CCSL';
}
function wrapTrackHandler(handler){
  if(typeof handler!=='function'||handler.__v203ManualWrapped)return handler;
  const wrapped=async function v204PersistManualTrackQuery(req,res,next){
    const requestedType=exactRequestedType(req);
    if(!requestedType){
      return res.status(400).json({ok:false,error:'轨迹查询必须选择精确业务板块：CE / CEAF / TBKH / ALI1688 / SHOPEECN / SHOPEEVN / WHPP，禁止再用模糊的 CCSL/SHOPEE 归属。'});
    }
    const originalBody=req.body;
    req.body={...(req.body||{}),businessType:legacyEngineType(requestedType)};
    const originalJson=res.json.bind(res);
    let persisted=false;
    res.json=function v204InterceptJson(payload){
      if(!persisted&&payload?.ok!==false){
        persisted=true;
        try{
          const reportDate=String(originalBody?.reportDate||payload?.reportDate||'');
          const persist=persistV203ManualQuery({
            requestedBusinessType:requestedType,
            reportDate,
            payload:{...payload,businessType:requestedType},
            requestMeta:{requestedBusinessType:requestedType,legacyEngineBusinessType:legacyEngineType(requestedType),requestIp:req.ip||'',user:req.user?.username||req.user?.email||'',sourceOrigin:'MANUAL_QUERY'}
          });
          payload={...payload,businessType:requestedType,manualEvidence:{persisted:persist.persisted||0,version:V203_MANUAL_EVIDENCE_VERSION,sourceOrigin:'MANUAL_QUERY'}};
        }catch(error){
          console.error('[CE-QC][V204_MANUAL_EVIDENCE_PERSIST_FAILED]',error?.stack||error);
          payload={...payload,businessType:requestedType,manualEvidence:{persisted:0,error:error?.message||String(error),version:V203_MANUAL_EVIDENCE_VERSION}};
        }
      }
      return originalJson(payload);
    };
    try{return await handler(req,res,next);}finally{req.body=originalBody;}
  };
  wrapped.__v203ManualWrapped=true;
  wrapped.__v203ManualOriginal=handler;
  return wrapped;
}

express.application.post=function v204ManualQueryRegistration(...args){
  if(String(args[0]||'')==='/api/track-query'){
    wrappedRegistration=true;
    return originalPost.apply(this,[args[0],...args.slice(1).map(wrapTrackHandler)]);
  }
  return originalPost.apply(this,args);
};

const previousListen=express.application.listen;
let endpointsInstalled=false;
express.application.listen=function v204ManualQueryListen(...args){
  if(!endpointsInstalled){
    endpointsInstalled=true;
    this.post('/api/v203/waybill-audit',(req,res)=>{
      try{
        const bills=Array.isArray(req.body?.shipmentCodes)?req.body.shipmentCodes:[];
        const rows=auditV203Waybills(bills);
        res.setHeader('Cache-Control','no-store');
        res.json({ok:true,version:V203_MANUAL_QUERY_PATCH_VERSION,rows,requested:bills.length,legacyBackfill:inspectV204LegacyManualBackfill()});
      }catch(error){res.status(400).json({ok:false,error:error.message});}
    });
    this.post('/api/v204/manual-evidence/backfill',(req,res)=>{
      try{const result=backfillV204LegacyManualEvidence({limit:req.body?.limit});res.setHeader('Cache-Control','no-store');res.json({ok:true,...result});}
      catch(error){res.status(500).json({ok:false,error:error.message});}
    });
    this.get('/api/v203/manual-evidence/status',(req,res)=>{
      res.setHeader('Cache-Control','no-store');
      res.json({ok:true,version:V203_MANUAL_QUERY_PATCH_VERSION,evidenceVersion:V203_MANUAL_EVIDENCE_VERSION,businessTypes:V203_BUSINESS_TYPES,trackRouteWrapped:wrappedRegistration,legacyBackfill:inspectV204LegacyManualBackfill()});
    });
    if(!backfillScheduled){backfillScheduled=true;setTimeout(()=>{try{backfillV204LegacyManualEvidence();}catch(error){console.error('[CE-QC][V204_LEGACY_MANUAL_BACKFILL_FAILED]',error?.stack||error);}},1500).unref?.();}
  }
  return previousListen.apply(this,args);
};

export function inspectV203ManualQueryPatch(){return{version:V203_MANUAL_QUERY_PATCH_VERSION,trackRouteWrapped:wrappedRegistration,businessTypes:V203_BUSINESS_TYPES,legacyBackfill:inspectV204LegacyManualBackfill()};}
