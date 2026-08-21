import express from 'express';
import { getDb } from './db.js';
import { inspectV132WhppFastSummary } from './v132WhppFastIntegrationPatch.js';

export const V248_WHPP_AUTHORITY_VERSION='2026-08-20-v248-whpp-after-access-authority-v1';
const RESPONSE_PATCH_ID='2026-08-20-v246-whpp-stable-refresh-v1';
const INSTALLED=Symbol.for('ce-qc.v248-whpp-authority-installed');
const ROUTE='/api/v132/whpp-fast-summary';

function latestWhppDate(){
  const db=getDb();
  const candidates=[];
  const probes=[
    ['business_final_rows',"SELECT COALESCE(MAX(reportDate),'') d FROM business_final_rows WHERE UPPER(COALESCE(businessType,''))='WHPP'"],
    ['business_daily_parse_rows',"SELECT COALESCE(MAX(reportDate),'') d FROM business_daily_parse_rows WHERE UPPER(COALESCE(businessType,''))='WHPP'"],
    ['business_daily_reports',"SELECT COALESCE(MAX(reportDate),'') d FROM business_daily_reports WHERE UPPER(COALESCE(businessType,''))='WHPP'"]
  ];
  for(const [table,sql] of probes){
    try{
      const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table);
      if(!exists)continue;
      const d=String(db.prepare(sql).get()?.d||'');
      if(/^\d{4}-\d{2}-\d{2}$/.test(d))candidates.push(d);
    }catch{}
  }
  return candidates.sort().at(-1)||'';
}

function v248WhppAuthority(req,res,next){
  if(req.method!=='GET'||req.path!==ROUTE)return next();
  try{
    const explicit=String(req.query?.reportDate||req.query?.date||'').slice(0,10);
    const reportDate=/^\d{4}-\d{2}-\d{2}$/.test(explicit)?explicit:latestWhppDate();
    const payload=inspectV132WhppFastSummary(reportDate);
    res.setHeader('Cache-Control','private, max-age=3');
    res.setHeader('X-CE-QC-WHPP-Authority','V248-AFTER-ACCESS-BEFORE-LEGACY');
    return res.json({...payload,patchId:RESPONSE_PATCH_ID,authorityVersion:V248_WHPP_AUTHORITY_VERSION,resolvedReportDate:reportDate||'',routeAuthority:'AFTER_ACCESS_BEFORE_LEGACY'});
  }catch(error){
    return res.status(500).json({ok:false,patchId:RESPONSE_PATCH_ID,authorityVersion:V248_WHPP_AUTHORITY_VERSION,code:'V248_WHPP_SUMMARY_FAILED',error:error?.message||String(error)});
  }
}

if(!express.application[INSTALLED]){
  Object.defineProperty(express.application,INSTALLED,{value:true});
  const previousUse=express.application.use;
  let mounted=false;
  express.application.use=function v248WhppAuthorityUse(...args){
    const functions=args.flat().filter(value=>typeof value==='function');
    const access=functions.some(fn=>fn.name==='accessIdentity'||fn.name==='v209AccessIdentityNoHang');
    if(access&&!mounted){
      // First let V246 mount login/health and the real access middleware.
      // Then mount WHPP authority AFTER authentication but BEFORE legacy routes.
      const result=previousUse.apply(this,args);
      mounted=true;
      previousUse.call(this,v248WhppAuthority);
      return result;
    }
    return previousUse.apply(this,args);
  };
}

console.log('[CE-QC][V248] authenticated WHPP fast summary authority armed after access middleware and before legacy V137/V132 routes.');

export const __test={latestWhppDate,v248WhppAuthority,ROUTE,RESPONSE_PATCH_ID};
