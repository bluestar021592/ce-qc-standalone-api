import express from 'express';

export const V227_LOCAL_HEALTH_PROBE_VERSION='2026-08-19-v227-loopback-health-readiness-v1';
const INSTALLED=Symbol.for('ce-qc.v227-local-health-probe-installed');

function ipOnly(value=''){return String(value||'').replace(/^::ffff:/,'');}
function isLoopback(req){
  const ip=ipOnly(req.socket?.remoteAddress||'');
  const host=String(req.hostname||req.get?.('host')||'').toLowerCase().replace(/^\[|\]$/g,'').split(':')[0];
  return (ip==='127.0.0.1'||ip==='::1')&&(['127.0.0.1','localhost','::1'].includes(host));
}
function localHealth(req,res,next){
  if(req.method!=='GET'||req.path!=='/api/health'||!isLoopback(req))return next();
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-CE-QC-Health-Mode','LOOPBACK_READINESS_ONLY');
  return res.json({ok:true,ready:true,authRequired:true,scope:'LOOPBACK_READINESS_ONLY',version:V227_LOCAL_HEALTH_PROBE_VERSION,time:new Date().toISOString()});
}

if(!express.application[INSTALLED]){
  Object.defineProperty(express.application,INSTALLED,{value:true});
  const previousUse=express.application.use;
  let mounted=false;
  express.application.use=function v227HealthBeforeAccess(...args){
    const functions=args.flat().filter(v=>typeof v==='function');
    const access=functions.some(fn=>fn.name==='accessIdentity'||fn.name==='v209AccessIdentityNoHang');
    if(access&&!mounted){mounted=true;previousUse.call(this,localHealth);}
    return previousUse.apply(this,args);
  };
}

console.log('[CE-QC][V227] loopback /api/health readiness is public to the local launcher only; all dashboard/data APIs remain authenticated.');

export const __test={ipOnly,isLoopback};
