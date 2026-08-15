import crypto from 'crypto';
import express from 'express';

export const V156_SESSION_HOT_PATH_ID='2026-08-15-v156-session-hot-path-v1';
const WRAPPED=Symbol.for('ce-qc.v156-session-hot-path');
const CACHE_TTL_MS=Math.max(30_000,Math.min(5*60_000,Number(process.env.CE_QC_SESSION_HOT_CACHE_MS||120_000)));
const MAX_ENTRIES=64;
const cache=new Map();

function cookieValue(req,name){
  const raw=String(req?.headers?.cookie||'');
  for(const part of raw.split(';')){
    const index=part.indexOf('=');
    if(index<0)continue;
    if(part.slice(0,index).trim()===name)return decodeURIComponent(part.slice(index+1).trim());
  }
  return '';
}
function hash(value){return crypto.createHash('sha256').update(String(value||'')).digest('hex');}
function requestKey(req){
  const token=cookieValue(req,'ce_internal_session');
  if(!token)return '';
  const host=String(req?.hostname||req?.headers?.host||'').toLowerCase();
  const remote=String(req?.socket?.remoteAddress||'');
  return `${hash(token)}|${host}|${remote}`;
}
function authMutationPath(pathname=''){
  return /^\/api\/(?:internal-auth|local-auth)\//.test(String(pathname||''));
}
function prune(){
  const now=Date.now();
  for(const [key,entry] of cache){
    if(!entry||entry.cacheExpiresAt<=now||entry.sessionExpiresAt<=now)cache.delete(key);
  }
  while(cache.size>MAX_ENTRIES){const first=cache.keys().next().value;if(first===undefined)break;cache.delete(first);}
}
function store(req,key){
  if(!key||!req?.user||!req?.accessMode)return;
  const sessionExpiresAt=Date.parse(String(req.user.sessionExpiresAt||''));
  const hardExpiry=Number.isFinite(sessionExpiresAt)?sessionExpiresAt:Date.now()+CACHE_TTL_MS;
  cache.set(key,{
    user:{...req.user},accessMode:req.accessMode,cloudflareEmail:req.cloudflareEmail||'',
    sessionExpiresAt:hardExpiry,cacheExpiresAt:Math.min(hardExpiry,Date.now()+CACHE_TTL_MS)
  });
  prune();
}

const previousUse=express.application.use;
if(typeof previousUse==='function'&&!previousUse[WRAPPED]){
  const wrappedUse=function v156SessionHotPathUse(...args){
    const mapped=args.map(handler=>{
      if(typeof handler!=='function'||handler.name!=='accessIdentity')return handler;
      const original=handler;
      return function v156CachedAccessIdentity(req,res,next){
        if(authMutationPath(req?.path))return original.call(this,req,res,next);
        prune();
        const key=requestKey(req);
        const entry=key?cache.get(key):null;
        const now=Date.now();
        if(entry&&entry.cacheExpiresAt>now&&entry.sessionExpiresAt>now){
          req.user={...entry.user};
          req.accessMode=entry.accessMode;
          req.cloudflareEmail=entry.cloudflareEmail;
          res.setHeader('X-CE-QC-Session-Cache','HIT');
          return next();
        }
        const captureNext=error=>{
          if(!error&&key&&req?.user)store(req,key);
          if(!error)res.setHeader('X-CE-QC-Session-Cache','MISS');
          return next(error);
        };
        return original.call(this,req,res,captureNext);
      };
    });
    return previousUse.apply(this,mapped);
  };
  Object.defineProperty(wrappedUse,WRAPPED,{value:true});
  express.application.use=wrappedUse;
}

export function getV156SessionHotPathStats(){prune();return {patchId:V156_SESSION_HOT_PATH_ID,entries:cache.size,ttlMs:CACHE_TTL_MS};}
