import express from 'express';

export const V225_AUTH_BOOTSTRAP_GUARD_PATCH_ID='2026-08-19-v225-auth-bootstrap-guard-inject-v1';
const INSTALLED=Symbol.for('ce-qc.v225-auth-bootstrap-guard-installed');
const APP_PATHS=new Set(['/','/home','/ce','/ceaf','/tbkh','/ali1688','/shopeecn','/shopeevn','/whpp','/tracking','/exceptions','/reports','/import','/data-management','/settings','/logs','/carryover-center']);

function responseGuard(req,res,next){
  if(req.method!=='GET'||!APP_PATHS.has(req.path))return next();
  const originalSend=res.send.bind(res);
  let transformed=false;
  res.send=function v225GuardedHtmlSend(body){
    if(!transformed&&typeof body==='string'&&body.includes('<html')&&body.includes('/app.js')){
      transformed=true;
      const tag='  <script src="/v225-auth-bootstrap-guard.js?v=20260819-v225-1"></script>\n';
      if(!body.includes('/v225-auth-bootstrap-guard.js')){
        body=body.replace(/(\s*<script\s+src=["']\/app\.js[^>]*><\/script>)/i,`${tag}$1`);
      }
      res.setHeader('X-CE-QC-V225-Auth-Guard','active');
    }
    return originalSend(body);
  };
  next();
}

if(!express.application[INSTALLED]){
  Object.defineProperty(express.application,INSTALLED,{value:true});
  const previousUse=express.application.use;
  let mounted=false;
  express.application.use=function v225GuardUse(...args){
    const candidates=args.flat().filter(value=>typeof value==='function');
    if(!mounted&&candidates.some(fn=>fn.name==='serveStatic')){
      mounted=true;
      previousUse.call(this,responseGuard);
    }
    return previousUse.apply(this,args);
  };
}

console.log('[CE-QC][V225] browser auth/bootstrap zero-state guard armed before static shell.');
