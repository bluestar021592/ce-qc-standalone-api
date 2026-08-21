import express from 'express';

export const V227_LOCAL_HEALTH_PROBE_VERSION='2026-08-21-qc11-core-5177-5178-readiness-v1';
const INSTALLED=Symbol.for('ce-qc.v227-local-health-probe-installed');
const EXPORT_PORT=Math.max(1024,Math.min(65535,Number(process.env.CE_QC_EXPORT_SIDECAR_PORT||5178)));
const EXPORT_TIMEOUT_MS=1200;

function ipOnly(value=''){return String(value||'').replace(/^::ffff:/,'');}
function isLoopback(req){
  const ip=ipOnly(req.socket?.remoteAddress||'');
  const host=String(req.hostname||req.get?.('host')||'').toLowerCase().replace(/^\[|\]$/g,'').split(':')[0];
  return (ip==='127.0.0.1'||ip==='::1')&&(['127.0.0.1','localhost','::1'].includes(host));
}
async function exportSidecarReady(){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),EXPORT_TIMEOUT_MS);timer.unref?.();
  try{
    const response=await fetch(`http://127.0.0.1:${EXPORT_PORT}/api/v194/export-ping`,{cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
    if(response.status!==200)return{ready:false,status:response.status,reason:`HTTP_${response.status}`};
    const body=await response.json().catch(()=>({}));
    const capabilities=Array.isArray(body?.capabilities)?body.capabilities.map(v=>String(v).toUpperCase()):[];
    const ready=body?.ok===true&&body?.statusTransport==='IPC_MEMORY_V195'&&capabilities.includes('ALL')&&capabilities.includes('SINGLE');
    return{ready,status:response.status,revision:String(body?.revision||''),statusTransport:String(body?.statusTransport||''),capabilities};
  }catch(error){return{ready:false,status:0,reason:error?.name==='AbortError'?'TIMEOUT':String(error?.code||error?.message||'UNAVAILABLE')};}
  finally{clearTimeout(timer);}
}
async function localHealth(req,res,next){
  if(req.method!=='GET'||req.path!=='/api/health'||!isLoopback(req))return next();
  const exportService=await exportSidecarReady();
  const ready=Boolean(exportService.ready);
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-CE-QC-Health-Mode','LOOPBACK_READINESS_ONLY');
  res.setHeader('X-CE-QC-Core-Services','5177+5178');
  return res.status(ready?200:503).json({
    ok:ready,ready,authRequired:true,scope:'LOOPBACK_READINESS_ONLY',coreServices:'5177+5178',
    dataBlocking:false,dataState:'DIAGNOSTIC_ONLY',exportService,
    version:V227_LOCAL_HEALTH_PROBE_VERSION,time:new Date().toISOString()
  });
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

console.log('[CE-QC][QC11_HEALTH] loopback /api/health requires 5177 app + 5178 ALL/single export sidecar; business data remains diagnostic-only and all dashboard/data APIs remain authenticated.');

export const __test={ipOnly,isLoopback,exportSidecarReady};
