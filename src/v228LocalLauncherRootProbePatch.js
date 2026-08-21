import express from 'express';

export const V228_LOCAL_LAUNCHER_ROOT_PROBE_VERSION='2026-08-19-v228-loopback-root-readiness-v1';
const INSTALLED=Symbol.for('ce-qc.v228-local-launcher-root-probe-installed');

function ipOnly(value=''){return String(value||'').replace(/^::ffff:/,'');}
function hostOnly(value=''){
  const raw=String(value||'').trim().toLowerCase().replace(/^\[|\]$/g,'');
  if(raw==='::1')return raw;
  return raw.split(':')[0];
}
function isLoopback(req){
  const ip=ipOnly(req.socket?.remoteAddress||'');
  const host=hostOnly(req.hostname||req.get?.('host')||'');
  return (ip==='127.0.0.1'||ip==='::1')&&(['127.0.0.1','localhost','::1'].includes(host));
}
function isBrowserHtml(req){return String(req.get?.('accept')||'').toLowerCase().includes('text/html');}
function launcherRootProbe(req,res,next){
  if(req.method!=='GET'||req.path!=='/'||!isLoopback(req)||isBrowserHtml(req))return next();
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-CE-QC-Launcher-Readiness','READY_AUTH_REQUIRED');
  return res.status(200).type('text/plain').send(`CE QC READY · authentication required · ${V228_LOCAL_LAUNCHER_ROOT_PROBE_VERSION}`);
}

if(!express.application[INSTALLED]){
  Object.defineProperty(express.application,INSTALLED,{value:true});
  const previousUse=express.application.use;
  let mounted=false;
  express.application.use=function v228LauncherProbeBeforeAccess(...args){
    const functions=args.flat().filter(v=>typeof v==='function');
    const access=functions.some(fn=>fn.name==='accessIdentity'||fn.name==='v209AccessIdentityNoHang');
    if(access&&!mounted){mounted=true;previousUse.call(this,launcherRootProbe);}
    return previousUse.apply(this,args);
  };
}

console.log('[CE-QC][V228] loopback non-browser GET / now reports HTTP 200 readiness to the managed launcher; browser HTML still follows normal authentication.');

export const __test={ipOnly,hostOnly,isLoopback,isBrowserHtml};
