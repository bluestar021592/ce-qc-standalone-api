import express from 'express';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getRuntimeConfig } from './db.js';

export const V209_LOGIN_RELIABILITY_VERSION='2026-08-19-v213-auth-sidecar-login-v1';
const INSTALLED=Symbol.for('ce-qc.v209-login-reliability-installed');
const WRAPPED=Symbol.for('ce-qc.v209-access-wrapped');
const FAST_COOKIE='ce_v213_fast_session';
const LEGACY_V212_COOKIE='ce_v212_fast_session';
const AUTH_SIDECAR_PORT=Math.max(1024,Math.min(65535,Number(process.env.CE_QC_AUTH_SIDECAR_PORT||5179)));
let cachedV213Secret='';
let cachedV212Secret='';
let authSidecarChild=null;

function hostOnly(value=''){return String(value||'').trim().toLowerCase().replace(/^\[|\]$/g,'').split(':')[0];}
function ipOnly(value=''){return String(value||'').replace(/^::ffff:/,'');}
function cookieValue(req,name){return String(req.get?.('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1)||'';}
function hasSession(req){return Boolean(cookieValue(req,'ce_internal_session')||cookieValue(req,'ce_v211_fast_session')||cookieValue(req,LEGACY_V212_COOKIE)||cookieValue(req,FAST_COOKIE));}
function privateV4(value=''){return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(String(value||''));}
function localChannel(req){
  const host=hostOnly(req.hostname||req.get?.('host')||''),ip=ipOnly(req.socket?.remoteAddress||'');
  if(['127.0.0.1','localhost','::1'].includes(host)&&(ip==='127.0.0.1'||ip==='::1'))return 'LOCAL';
  if(net.isIP(host)===4&&privateV4(host)&&privateV4(ip))return 'LAN';
  return '';
}
function localLike(req){return Boolean(localChannel(req));}
function wantsHtml(req){return String(req.get?.('accept')||'').includes('text/html');}

function secretFile(version){const cfg=getRuntimeConfig();fs.mkdirSync(cfg.tokenDir,{recursive:true});return path.join(cfg.tokenDir,version===213?'v213_local_fast_session.secret':'v212_local_fast_session.secret');}
function sessionSecret(version=213){
  if(version===213&&cachedV213Secret)return cachedV213Secret;
  if(version===212&&cachedV212Secret)return cachedV212Secret;
  const env=String(process.env.CE_QC_LOCAL_SESSION_SECRET||'').trim();if(env.length>=32){if(version===213)cachedV213Secret=env;else cachedV212Secret=env;return env;}
  const file=secretFile(version);let value='';
  try{value=fs.readFileSync(file,'utf8').trim();}catch{}
  if(value.length<43)return '';
  if(version===213)cachedV213Secret=value;else cachedV212Secret=value;
  return value;
}
function verifyFastToken(token,version=213,secret=sessionSecret(version)){
  try{
    if(!secret)return null;
    const [body,sig,extra]=String(token||'').split('.');if(!body||!sig||extra)return null;
    const expected=crypto.createHmac('sha256',secret).update(body).digest('base64url');
    const a=Buffer.from(sig),b=Buffer.from(expected);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
    const payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    if(payload?.v!==version||!payload?.exp||Number(payload.exp)<=Date.now())return null;
    if(!payload?.user?.username||!payload?.user?.role)return null;
    return payload;
  }catch{return null;}
}
function readFastSession(req,channel){
  const v213=verifyFastToken(cookieValue(req,FAST_COOKIE),213);if(v213&&v213.channel===channel)return v213;
  const v212=verifyFastToken(cookieValue(req,LEGACY_V212_COOKIE),212);if(v212&&v212.channel===channel)return v212;
  return null;
}
function clearFastCookie(res){res.setHeader('Set-Cookie',[`${FAST_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,`${LEGACY_V212_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,'ce_v211_fast_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0','ce_internal_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0']);}

function shouldStartAuthSidecar(){
  if(String(process.env.CE_QC_AUTH_SIDECAR_CHILD||'')==='1')return false;
  const entry=path.basename(String(process.argv[1]||'')).toLowerCase();
  return entry==='bootstrap.js'||entry==='server.js';
}
function startAuthSidecar(){
  if(!shouldStartAuthSidecar()||authSidecarChild)return;
  const file=fileURLToPath(new URL('./v213AuthSidecar.js',import.meta.url));
  try{
    authSidecarChild=spawn(process.execPath,[file],{cwd:getRuntimeConfig().projectRoot,env:{...process.env,CE_QC_AUTH_SIDECAR_CHILD:'1',CE_QC_AUTH_SIDECAR_PORT:String(AUTH_SIDECAR_PORT)},windowsHide:true,detached:false,stdio:['ignore','inherit','inherit']});
    console.log(`[CE-QC][V213_AUTH_SIDECAR] starting pid=${authSidecarChild.pid||'-'} port=${AUTH_SIDECAR_PORT}`);
    authSidecarChild.once('error',error=>console.error('[CE-QC][V213_AUTH_SIDECAR] spawn failed:',error?.stack||error));
    authSidecarChild.once('exit',(code,signal)=>{console.log(`[CE-QC][V213_AUTH_SIDECAR] exited code=${code??'null'}${signal?` signal=${signal}`:''}`);authSidecarChild=null;});
  }catch(error){console.error('[CE-QC][V213_AUTH_SIDECAR] start failed:',error?.stack||error);}
}
process.once('exit',()=>{try{authSidecarChild?.kill();}catch{}});
startAuthSidecar();

async function v213FastIdentity(req,res,next){
  const channel=localChannel(req);if(!channel)return next();
  const fast=readFastSession(req,channel);
  if(fast){req.ceQcFastUser={...fast.user,devMode:channel==='LOCAL'};req.ceQcFastAccessMode=channel;}
  if(req.method==='POST'&&req.path==='/api/internal-auth/logout'&&fast){clearFastCookie(res);return res.json({ok:true,authMode:'V213_ISOLATED_AUTH_SIDECAR'});}
  if(req.method==='POST'&&req.path==='/api/internal-auth/login')return res.status(409).json({ok:false,code:'V213_USE_AUTH_SIDECAR',error:'本机登录已迁移到独立5179认证服务，请刷新登录页后重试。'});
  return next();
}

function inlineLoginScript(){return `<script>(function(){'use strict';const form=document.getElementById('login'),button=document.getElementById('submit'),error=document.getElementById('error'),hint=document.getElementById('hint');if(!form||!button||!error)return;const message=text=>{error.textContent=String(text||'');};const sidecar=location.protocol+'//'+location.hostname+':${AUTH_SIDECAR_PORT}';async function ping(){const c=new AbortController(),t=setTimeout(()=>c.abort(),1800);try{const r=await fetch(sidecar+'/api/v213/auth-ping',{credentials:'include',cache:'no-store',signal:c.signal});const p=await r.json();if(!r.ok||!p.ok)throw new Error('HTTP '+r.status);if(hint)hint.textContent='独立认证服务已就绪 · '+p.version;return true;}catch(e){message('独立登录服务5179没有响应。请重新打开CE QC；不要继续重复点登录。');return false;}finally{clearTimeout(t);}}form.addEventListener('submit',async event=>{event.preventDefault();if(button.disabled)return;message('');button.disabled=true;const original=button.textContent;button.textContent='正在连接独立登录服务…';try{if(!await ping())return;button.textContent='正在校验账号…';const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),4000);try{const body={username:String(document.getElementById('username')?.value||'').trim(),password:String(document.getElementById('password')?.value||'')};const response=await fetch(sidecar+'/api/v213/local-auth/login',{method:'POST',credentials:'include',cache:'no-store',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(body),signal:controller.signal});const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{payload={error:text||('登录服务返回 HTTP '+response.status)};}if(!response.ok||payload.ok===false){message((payload.error||payload.message||('登录失败（HTTP '+response.status+'）'))+(payload.code?' ['+payload.code+']':''));return;}button.textContent='登录成功，正在进入…';location.replace('/?login='+Date.now());}catch(err){message(err?.name==='AbortError'?'独立登录服务已连接，但账号校验4秒未完成。请看黑框 V213_AUTH_SIDECAR 的最后一行。':'登录请求失败：'+(err?.message||err));}finally{clearTimeout(timer);}}finally{if(!String(button.textContent).includes('成功')){button.disabled=false;button.textContent=original;}}});setTimeout(()=>{void ping();},100);})();</script>`;}

export function v209LoginReliabilityPage(req,res,next){
  if(req.method!=='GET'||req.path.startsWith('/api/')||hasSession(req)||!localLike(req)||!wantsHtml(req))return next();
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  res.setHeader('X-CE-QC-Login-Reliability',V209_LOGIN_RELIABILITY_VERSION);
  return res.status(200).type('html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CE质控系统内部登录</title><style>body{margin:0;background:#f3f6fa;color:#17324d;font:15px/1.6 system-ui,'Microsoft YaHei',sans-serif;display:grid;place-items:center;min-height:100vh}.box{width:min(600px,calc(100% - 48px));background:#fff;border:1px solid #dce5ef;border-radius:12px;padding:38px 42px;box-shadow:0 18px 50px #16395b18}h1{font-size:30px;margin:0 0 22px;color:#083b6d}label{display:block;margin:14px 0 6px;font-size:18px}input{box-sizing:border-box;width:100%;padding:14px 15px;border:1px solid #cbd8e5;border-radius:7px;font-size:17px}button{width:100%;margin-top:24px;border:0;border-radius:7px;background:#176fe8;color:#fff;padding:14px;font-size:18px;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:wait}#error{min-height:24px;color:#b42318;margin-top:12px;font-weight:600}#hint{color:#71849a;font-size:12px;margin-top:8px}</style></head><body><main class="box"><h1>CE质控系统内部登录</h1><form id="login" autocomplete="on"><label>用户名</label><input id="username" name="username" autocomplete="username" required><label>密码</label><input id="password" name="password" type="password" autocomplete="current-password" required><button id="submit" type="submit">登录</button><div id="error" role="alert"></div><div id="hint">独立认证通道 · ${V209_LOGIN_RELIABILITY_VERSION} · 5179</div></form></main>${inlineLoginScript()}</body></html>`);
}

export function wrapV209AccessIdentity(base){
  if(typeof base!=='function'||base[WRAPPED])return base;
  const wrapped=function v209AccessIdentityNoHang(req,res,next){
    if(req.ceQcFastUser){req.user=req.ceQcFastUser;req.accessMode=req.ceQcFastAccessMode||'LOCAL';req.cloudflareEmail='';return next();}
    try{
      const result=base(req,res,next);
      if(result&&typeof result.then==='function')result.catch(error=>{
        console.error('[CE-QC][V209_AUTH_REJECTION]',error?.stack||error);
        if(res.headersSent)return;
        if(req.path.startsWith('/api/'))return res.status(500).json({ok:false,code:'V209_AUTH_INTERNAL_ERROR',error:'登录服务发生内部错误。',detail:String(error?.message||error)});
        res.status(500).type('html').send('<meta charset="utf-8"><h2>登录服务暂时异常</h2><p>请重新打开CE QC；系统已记录具体错误。</p>');
      });
      return result;
    }catch(error){
      console.error('[CE-QC][V209_AUTH_SYNC_ERROR]',error?.stack||error);
      if(res.headersSent)return;
      if(req.path.startsWith('/api/'))return res.status(500).json({ok:false,code:'V209_AUTH_INTERNAL_ERROR',error:'登录服务发生内部错误。',detail:String(error?.message||error)});
      return res.status(500).type('html').send('<meta charset="utf-8"><h2>登录服务暂时异常</h2><p>请重新打开CE QC；系统已记录具体错误。</p>');
    }
  };
  Object.defineProperty(wrapped,WRAPPED,{value:true});return wrapped;
}

if(!express.application[INSTALLED]){
  Object.defineProperty(express.application,INSTALLED,{value:true});
  const previousUse=express.application.use;
  express.application.use=function v213LoginReliabilityUse(...args){
    const flattened=args.flat().filter(v=>typeof v==='function');
    const hasAccess=flattened.some(fn=>fn.name==='accessIdentity'||fn.name==='v209AccessIdentityNoHang');
    if(!hasAccess)return previousUse.apply(this,args);
    previousUse.call(this,v209LoginReliabilityPage);
    previousUse.call(this,v213FastIdentity);
    const mapped=args.map(value=>Array.isArray(value)?value.map(fn=>typeof fn==='function'&&(fn.name==='accessIdentity'||fn.name==='v209AccessIdentityNoHang')?wrapV209AccessIdentity(fn):fn):typeof value==='function'&&(value.name==='accessIdentity'||value.name==='v209AccessIdentityNoHang')?wrapV209AccessIdentity(value):value);
    return previousUse.apply(this,mapped);
  };
}

export const __test={hostOnly,ipOnly,cookieValue,hasSession,localChannel,localLike,inlineLoginScript,verifyFastToken,readFastSession,shouldStartAuthSidecar};
