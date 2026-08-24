import express from 'express';
import { fileURLToPath } from 'node:url';

export const V288_STATIC_PREAUTH_ID='2026-08-24-v288-static-assets-before-db-auth-v1';

const previousUse=express.application.use;
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
const SAFE_ASSET_RE=/\.(?:css|js|mjs|svg|png|jpe?g|webp|gif|ico|woff2?|map)$/i;
let inserted=false;

const staticAssets=express.static(publicDir,{
  index:false,
  fallthrough:true,
  setHeaders(res){
    res.setHeader('Cache-Control','no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma','no-cache');
    res.setHeader('Expires','0');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-CE-QC-V288-Static',V288_STATIC_PREAUTH_ID);
  }
});

function v288StaticAssetBeforeAuth(req,res,next){
  const method=String(req.method||'GET').toUpperCase();
  const pathname=String(req.path||req.url||'').split('?')[0];
  if(!['GET','HEAD'].includes(method)||!SAFE_ASSET_RE.test(pathname))return next();
  return staticAssets(req,res,()=>{
    if(res.headersSent)return;
    res.status(404).type('text/plain').send('Static asset not found');
  });
}

// Arm only until server.js registers accessIdentity. The middleware is inserted
// immediately before authentication so CSS/JS/images never wait on the 25 GiB
// SQLite session lookup. Then express.application.use is restored at once; this is
// not a persistent global Express owner. HTML, root navigation and every API remain
// behind accessIdentity exactly as before.
express.application.use=function v288ArmStaticBeforeAccessIdentity(...args){
  const handlers=args.flat().filter(value=>typeof value==='function');
  const isAuthRegistration=handlers.some(fn=>fn.name==='accessIdentity');
  if(!inserted&&isAuthRegistration){
    inserted=true;
    previousUse.call(this,v288StaticAssetBeforeAuth);
    express.application.use=previousUse;
    console.info('[CE-QC][V288_STATIC_PREAUTH]',V288_STATIC_PREAUTH_ID,'static CSS/JS/image assets inserted before accessIdentity; HTML/API remain authenticated; express.use hook restored immediately.');
    return previousUse.apply(this,args);
  }
  return previousUse.apply(this,args);
};

console.info('[CE-QC][V288_STATIC_PREAUTH]',V288_STATIC_PREAUTH_ID,'armed until accessIdentity registration; prevents render-blocking assets from waiting on SQLite session reads.');
