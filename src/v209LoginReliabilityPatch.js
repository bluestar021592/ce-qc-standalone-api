import express from 'express';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { getDb, getRuntimeConfig } from './db.js';

export const V209_LOGIN_RELIABILITY_VERSION='2026-08-19-v211-local-fast-auth-v1';
const INSTALLED=Symbol.for('ce-qc.v209-login-reliability-installed');
const WRAPPED=Symbol.for('ce-qc.v209-access-wrapped');
const FAST_COOKIE='ce_v211_fast_session';
const FAST_SESSION_HOURS=Math.max(1,Math.min(24,Number(process.env.CE_QC_LOCAL_FAST_SESSION_HOURS||8)));
let cachedSecret='';

function hostOnly(value=''){return String(value||'').trim().toLowerCase().replace(/^\[|\]$/g,'').split(':')[0];}
function ipOnly(value=''){return String(value||'').replace(/^::ffff:/,'');}
function cookieValue(req,name){return String(req.get?.('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1)||'';}
function hasSession(req){return Boolean(cookieValue(req,'ce_internal_session')||cookieValue(req,FAST_COOKIE));}
function privateV4(value=''){return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(String(value||''));}
function localChannel(req){
  const host=hostOnly(req.hostname||req.get?.('host')||''),ip=ipOnly(req.socket?.remoteAddress||'');
  if(['127.0.0.1','localhost','::1'].includes(host)&&(ip==='127.0.0.1'||ip==='::1'))return 'LOCAL';
  if(net.isIP(host)===4&&privateV4(host)&&privateV4(ip))return 'LAN';
  return '';
}
function localLike(req){return Boolean(localChannel(req));}
function wantsHtml(req){return String(req.get?.('accept')||'').includes('text/html');}
function cleanUsername(value){return String(value||'').trim().toLowerCase().replace(/[^a-z0-9_.-]/g,'').slice(0,60);}
function publicUser(row={}){return{id:row.id||'',username:row.username||'',email:row.email||'',displayName:row.displayName||'',department:row.departmentCompany||row.department||'',role:row.role||'VIEWER',businessScope:row.businessScope||'ALL',mustChangePassword:Boolean(row.mustChangePassword),devMode:true};}

function secretFile(){const cfg=getRuntimeConfig();fs.mkdirSync(cfg.tokenDir,{recursive:true});return path.join(cfg.tokenDir,'v211_local_fast_session.secret');}
function fastSecret(){
  if(cachedSecret)return cachedSecret;
  const env=String(process.env.CE_QC_LOCAL_SESSION_SECRET||'').trim();if(env.length>=32){cachedSecret=env;return cachedSecret;}
  const file=secretFile();
  try{const existing=fs.readFileSync(file,'utf8').trim();if(existing.length>=43){cachedSecret=existing;return cachedSecret;}}catch{}
  cachedSecret=crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file,cachedSecret,{encoding:'utf8',mode:0o600,flag:'wx'});
  return cachedSecret;
}
function signFastPayload(payload,secret=fastSecret()){
  const body=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');
  const sig=crypto.createHmac('sha256',secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyFastToken(token,secret=fastSecret()){
  try{
    const [body,sig,extra]=String(token||'').split('.');if(!body||!sig||extra)return null;
    const expected=crypto.createHmac('sha256',secret).update(body).digest('base64url');
    const a=Buffer.from(sig),b=Buffer.from(expected);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
    const payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    if(payload?.v!==211||!payload?.exp||Number(payload.exp)<=Date.now())return null;
    if(!payload?.user?.username||!payload?.user?.role)return null;
    return payload;
  }catch{return null;}
}
function readFastSession(req,channel){const payload=verifyFastToken(cookieValue(req,FAST_COOKIE));if(!payload||payload.channel!==channel)return null;return payload;}
function setFastCookie(res,row,channel){
  const expiresAt=Date.now()+FAST_SESSION_HOURS*60*60_000;
  const payload={v:211,iat:Date.now(),exp:expiresAt,channel,user:publicUser(row)};
  const token=signFastPayload(payload);
  res.setHeader('Set-Cookie',[
    'ce_internal_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    `${FAST_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${FAST_SESSION_HOURS*3600}`
  ]);
  res.setHeader('X-CE-QC-Auth-Mode','V211_STATELESS_LOCAL_FAST');
  return{payload,expiresAt:new Date(expiresAt).toISOString()};
}
function clearFastCookie(res){res.setHeader('Set-Cookie',`${FAST_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);}

async function v211FastLocalAuth(req,res,next){
  const channel=localChannel(req);if(!channel)return next();
  const fast=readFastSession(req,channel);
  if(fast){req.ceQcFastUser={...fast.user,devMode:channel==='LOCAL'};req.ceQcFastAccessMode=channel;}
  if(req.method==='POST'&&req.path==='/api/internal-auth/logout'&&fast){clearFastCookie(res);return res.json({ok:true,authMode:'V211_STATELESS_LOCAL_FAST'});}
  if(req.method!=='POST'||req.path!=='/api/internal-auth/login')return next();
  const username=cleanUsername(req.body?.username),password=String(req.body?.password||'');
  if(!username||!password)return res.status(400).json({ok:false,error:'请输入用户名和密码。'});
  try{
    // Critical reliability rule: local/LAN login performs only one small read from the
    // large QC database. It does NOT write users, audit_logs or user_sessions before
    // responding, so a long-running 20+ GiB SQLite writer cannot freeze the login.
    const row=getDb().prepare("SELECT id,username,displayName,departmentCompany,email,passwordHash,role,businessScope,enabled,status,expiresAt,mustChangePassword,lockedUntil FROM users WHERE username=? AND status='ACTIVE' LIMIT 1").get(username);
    if(!row)return res.status(401).json({ok:false,error:'用户名或密码错误。'});
    if(!Number(row.enabled))return res.status(403).json({ok:false,error:'该账号已停用。'});
    if(row.expiresAt&&Date.parse(row.expiresAt)<=Date.now())return res.status(403).json({ok:false,error:'该账号已过期。'});
    if(row.lockedUntil&&Date.parse(row.lockedUntil)>Date.now())return res.status(423).json({ok:false,error:'该账号暂时锁定，请稍后再试。'});
    const matched=await bcrypt.compare(password,String(row.passwordHash||''));
    if(!matched)return res.status(401).json({ok:false,error:'用户名或密码错误。'});
    const issued=setFastCookie(res,row,channel);
    return res.json({ok:true,user:issued.payload.user,mustChangePassword:Boolean(row.mustChangePassword),expiresAt:issued.expiresAt,authMode:'V211_STATELESS_LOCAL_FAST'});
  }catch(error){
    console.error('[CE-QC][V211_FAST_LOGIN_ERROR]',error?.stack||error);
    return res.status(500).json({ok:false,code:'V211_FAST_LOGIN_ERROR',error:'本机登录服务异常。',detail:String(error?.message||error)});
  }
}

function inlineLoginScript(){return `<script>(function(){'use strict';const form=document.getElementById('login'),button=document.getElementById('submit'),error=document.getElementById('error');if(!form||!button||!error)return;const message=text=>{error.textContent=String(text||'');};form.addEventListener('submit',async event=>{event.preventDefault();if(button.disabled)return;message('');button.disabled=true;const original=button.textContent;button.textContent='正在登录…';const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);try{const body={username:String(document.getElementById('username')?.value||'').trim(),password:String(document.getElementById('password')?.value||'')};const response=await fetch('/api/internal-auth/login',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(body),signal:controller.signal});const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{payload={error:text||('登录接口返回 HTTP '+response.status)};}if(!response.ok||payload.ok===false){message(payload.error||payload.message||('登录失败（HTTP '+response.status+'）'));return;}button.textContent='登录成功，正在进入…';location.replace('/?login='+Date.now());}catch(err){message(err?.name==='AbortError'?'登录接口15秒内没有响应。新版V211正常情况下不会进入这里，请把黑框最后30行发我。':'登录请求失败：'+(err?.message||err));}finally{clearTimeout(timer);if(!String(button.textContent).includes('成功')){button.disabled=false;button.textContent=original;}}});})();</script>`;}

export function v209LoginReliabilityPage(req,res,next){
  if(req.method!=='GET'||req.path.startsWith('/api/')||hasSession(req)||!localLike(req)||!wantsHtml(req))return next();
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  res.setHeader('X-CE-QC-Login-Reliability',V209_LOGIN_RELIABILITY_VERSION);
  return res.status(200).type('html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CE质控系统内部登录</title><style>
  body{margin:0;background:#f3f6fa;color:#17324d;font:15px/1.6 system-ui,'Microsoft YaHei',sans-serif;display:grid;place-items:center;min-height:100vh}.box{width:min(600px,calc(100% - 48px));background:#fff;border:1px solid #dce5ef;border-radius:12px;padding:38px 42px;box-shadow:0 18px 50px #16395b18}h1{font-size:30px;margin:0 0 22px;color:#083b6d}label{display:block;margin:14px 0 6px;font-size:18px}input{box-sizing:border-box;width:100%;padding:14px 15px;border:1px solid #cbd8e5;border-radius:7px;font-size:17px}button{width:100%;margin-top:24px;border:0;border-radius:7px;background:#176fe8;color:#fff;padding:14px;font-size:18px;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:wait}#error{min-height:24px;color:#b42318;margin-top:12px;font-weight:600}#hint{color:#71849a;font-size:12px;margin-top:8px}</style></head><body><main class="box"><h1>CE质控系统内部登录</h1><form id="login" autocomplete="on"><label>用户名</label><input id="username" name="username" autocomplete="username" required><label>密码</label><input id="password" name="password" type="password" autocomplete="current-password" required><button id="submit" type="submit">登录</button><div id="error" role="alert"></div><div id="hint">本机/LAN快速登录 · ${V209_LOGIN_RELIABILITY_VERSION}</div></form></main>${inlineLoginScript()}</body></html>`);
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
  express.application.use=function v211LoginReliabilityUse(...args){
    const flattened=args.flat().filter(v=>typeof v==='function');
    const hasAccess=flattened.some(fn=>fn.name==='accessIdentity'||fn.name==='v209AccessIdentityNoHang');
    if(!hasAccess)return previousUse.apply(this,args);
    previousUse.call(this,v209LoginReliabilityPage);
    previousUse.call(this,v211FastLocalAuth);
    const mapped=args.map(value=>Array.isArray(value)?value.map(fn=>typeof fn==='function'&&(fn.name==='accessIdentity'||fn.name==='v209AccessIdentityNoHang')?wrapV209AccessIdentity(fn):fn):typeof value==='function'&&(value.name==='accessIdentity'||value.name==='v209AccessIdentityNoHang')?wrapV209AccessIdentity(value):value);
    return previousUse.apply(this,mapped);
  };
}

export const __test={hostOnly,ipOnly,cookieValue,hasSession,localChannel,localLike,inlineLoginScript,signFastPayload,verifyFastToken,publicUser};
