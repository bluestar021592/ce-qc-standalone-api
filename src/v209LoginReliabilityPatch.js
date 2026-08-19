import express from 'express';
import net from 'node:net';

export const V209_LOGIN_RELIABILITY_VERSION='2026-08-19-v209-local-login-no-hang-v3';
const INSTALLED=Symbol.for('ce-qc.v209-login-reliability-installed');
const WRAPPED=Symbol.for('ce-qc.v209-access-wrapped');

function hostOnly(value=''){return String(value||'').trim().toLowerCase().replace(/^\[|\]$/g,'').split(':')[0];}
function ipOnly(value=''){return String(value||'').replace(/^::ffff:/,'');}
function hasSession(req){return String(req.get?.('cookie')||'').split(';').some(v=>v.trim().startsWith('ce_internal_session='));}
function localLike(req){
  const host=hostOnly(req.hostname||req.get?.('host')||''),ip=ipOnly(req.socket?.remoteAddress||'');
  if(['127.0.0.1','localhost','::1'].includes(host))return ip==='127.0.0.1'||ip==='::1';
  if(net.isIP(host)!==4)return false;
  return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
}
function wantsHtml(req){return String(req.get?.('accept')||'').includes('text/html');}

function inlineLoginScript(){return `<script>(function(){'use strict';const form=document.getElementById('login'),button=document.getElementById('submit'),error=document.getElementById('error');if(!form||!button||!error)return;const message=text=>{error.textContent=String(text||'');};form.addEventListener('submit',async event=>{event.preventDefault();if(button.disabled)return;message('');button.disabled=true;const original=button.textContent;button.textContent='正在登录…';const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);try{const body={username:String(document.getElementById('username')?.value||'').trim(),password:String(document.getElementById('password')?.value||'')};const response=await fetch('/api/internal-auth/login',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(body),signal:controller.signal});const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{payload={error:text||('登录接口返回 HTTP '+response.status)};}if(!response.ok||payload.ok===false){message(payload.error||payload.message||('登录失败（HTTP '+response.status+'）'));return;}button.textContent='登录成功，正在进入…';location.replace('/?login='+Date.now());}catch(err){message(err?.name==='AbortError'?'登录接口15秒内没有响应，请重新打开CE QC后再试。':'登录请求失败：'+(err?.message||err));}finally{clearTimeout(timer);if(!String(button.textContent).includes('成功')){button.disabled=false;button.textContent=original;}}});})();</script>`;}

export function v209LoginReliabilityPage(req,res,next){
  if(req.method!=='GET'||req.path.startsWith('/api/')||hasSession(req)||!localLike(req)||!wantsHtml(req))return next();
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  res.setHeader('X-CE-QC-Login-Reliability',V209_LOGIN_RELIABILITY_VERSION);
  // Important: the login JS is INLINE. An unauthenticated request for an external
  // /v209-login-reliability.js would itself pass through accessIdentity and could be
  // replaced by the login HTML, leaving the button inert. The self-contained page
  // therefore has zero authenticated/static dependencies before a session exists.
  return res.status(200).type('html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CE质控系统内部登录</title><style>
  body{margin:0;background:#f3f6fa;color:#17324d;font:15px/1.6 system-ui,'Microsoft YaHei',sans-serif;display:grid;place-items:center;min-height:100vh}.box{width:min(600px,calc(100% - 48px));background:#fff;border:1px solid #dce5ef;border-radius:12px;padding:38px 42px;box-shadow:0 18px 50px #16395b18}h1{font-size:30px;margin:0 0 22px;color:#083b6d}label{display:block;margin:14px 0 6px;font-size:18px}input{box-sizing:border-box;width:100%;padding:14px 15px;border:1px solid #cbd8e5;border-radius:7px;font-size:17px}button{width:100%;margin-top:24px;border:0;border-radius:7px;background:#176fe8;color:#fff;padding:14px;font-size:18px;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:wait}#error{min-height:24px;color:#b42318;margin-top:12px;font-weight:600}#hint{color:#71849a;font-size:12px;margin-top:8px}</style></head><body><main class="box"><h1>CE质控系统内部登录</h1><form id="login" autocomplete="on"><label>用户名</label><input id="username" name="username" autocomplete="username" required><label>密码</label><input id="password" name="password" type="password" autocomplete="current-password" required><button id="submit" type="submit">登录</button><div id="error" role="alert"></div><div id="hint">本机登录 · ${V209_LOGIN_RELIABILITY_VERSION}</div></form></main>${inlineLoginScript()}</body></html>`);
}

export function wrapV209AccessIdentity(base){
  if(typeof base!=='function'||base[WRAPPED])return base;
  const wrapped=function v209AccessIdentityNoHang(req,res,next){
    try{
      const result=base(req,res,next);
      if(result&&typeof result.then==='function')result.catch(error=>{
        console.error('[CE-QC][V209_AUTH_REJECTION]',error?.stack||error);
        if(res.headersSent)return;
        if(req.path.startsWith('/api/'))return res.status(500).json({ok:false,code:'V209_AUTH_INTERNAL_ERROR',error:'登录服务发生内部错误，请重新打开系统后再试。',detail:String(error?.message||error)});
        res.status(500).type('html').send('<meta charset="utf-8"><h2>登录服务暂时异常</h2><p>请重新打开CE QC；系统已记录具体错误。</p>');
      });
      return result;
    }catch(error){
      console.error('[CE-QC][V209_AUTH_SYNC_ERROR]',error?.stack||error);
      if(res.headersSent)return;
      if(req.path.startsWith('/api/'))return res.status(500).json({ok:false,code:'V209_AUTH_INTERNAL_ERROR',error:'登录服务发生内部错误，请重新打开系统后再试。',detail:String(error?.message||error)});
      return res.status(500).type('html').send('<meta charset="utf-8"><h2>登录服务暂时异常</h2><p>请重新打开CE QC；系统已记录具体错误。</p>');
    }
  };
  Object.defineProperty(wrapped,WRAPPED,{value:true});
  return wrapped;
}

if(!express.application[INSTALLED]){
  Object.defineProperty(express.application,INSTALLED,{value:true});
  const previousUse=express.application.use;
  express.application.use=function v209LoginReliabilityUse(...args){
    const flattened=args.flat().filter(v=>typeof v==='function');
    const hasAccess=flattened.some(fn=>fn.name==='accessIdentity'||fn.name==='v209AccessIdentityNoHang');
    if(!hasAccess)return previousUse.apply(this,args);
    previousUse.call(this,v209LoginReliabilityPage);
    const mapped=args.map(value=>Array.isArray(value)?value.map(fn=>typeof fn==='function'&&(fn.name==='accessIdentity'||fn.name==='v209AccessIdentityNoHang')?wrapV209AccessIdentity(fn):fn):typeof value==='function'&&(value.name==='accessIdentity'||value.name==='v209AccessIdentityNoHang')?wrapV209AccessIdentity(value):value);
    return previousUse.apply(this,mapped);
  };
}

export const __test={hostOnly,ipOnly,hasSession,localLike,inlineLoginScript};
