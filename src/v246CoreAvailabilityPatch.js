import express from 'express';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getRuntimeConfig, getDb } from './db.js';
import { CEClient } from './ceClient.js';
import { __test as startupServiceProbe } from './v232LiveDataHealthGatePatch.js';
import { inspectV132WhppFastSummary } from './v132WhppFastIntegrationPatch.js';

export const V246_CORE_AVAILABILITY_VERSION='2026-08-20-v246-system-first-core-v1';
const INSTALLED=Symbol.for('ce-qc.v246-system-first-installed');
const CE_LOGIN_PATCHED=Symbol.for('ce-qc.v246-ce-login-bounded');
const FAST_COOKIE='ce_v213_fast_session';
const AUTH_PROXY_PATH='/api/v246/internal-auth/login';
const AUTH_PORT=Math.max(1024,Math.min(65535,Number(process.env.CE_QC_AUTH_SIDECAR_PORT||5179)));
const APP_PATHS=new Set(['/','/home','/ce','/ceaf','/tbkh','/ali1688','/shopeecn','/shopeevn','/whpp','/tracking','/exceptions','/reports','/import','/data-management','/settings','/logs','/carryover-center']);

function hostOnly(value=''){return String(value||'').trim().toLowerCase().replace(/^\[|\]$/g,'').split(':')[0];}
function ipOnly(value=''){return String(value||'').replace(/^::ffff:/,'');}
function privateV4(value=''){return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(String(value||''));}
function localChannel(req){
  const host=hostOnly(req.hostname||req.get?.('host')||''),ip=ipOnly(req.socket?.remoteAddress||'');
  if(['127.0.0.1','localhost','::1'].includes(host)&&(ip==='127.0.0.1'||ip==='::1'))return 'LOCAL';
  if(net.isIP(host)===4&&privateV4(host)&&privateV4(ip))return 'LAN';
  return '';
}
function cookieValue(req,name){return String(req.get?.('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1)||'';}
function sessionSecret(){
  const env=String(process.env.CE_QC_LOCAL_SESSION_SECRET||'').trim();
  if(env.length>=32)return env;
  try{return fs.readFileSync(path.join(getRuntimeConfig().tokenDir,'v213_local_fast_session.secret'),'utf8').trim();}catch{return '';}
}
function verifyToken(token,secret=sessionSecret()){
  try{
    if(!secret)return null;
    const [body,sig,extra]=String(token||'').split('.');
    if(!body||!sig||extra)return null;
    const expected=crypto.createHmac('sha256',secret).update(body).digest('base64url');
    const a=Buffer.from(sig),b=Buffer.from(expected);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
    const payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    if(payload?.v!==213||!payload?.exp||Number(payload.exp)<=Date.now()||!payload?.user?.username||!payload?.user?.role)return null;
    return payload;
  }catch{return null;}
}
function signForChannel(payload,channel,secret=sessionSecret()){
  if(!secret||!channel)throw new Error('内部登录主会话密钥尚未就绪');
  const next={...payload,v:213,channel};
  const body=Buffer.from(JSON.stringify(next),'utf8').toString('base64url');
  const sig=crypto.createHmac('sha256',secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function validFastSession(req){
  const channel=localChannel(req);if(!channel)return false;
  const payload=verifyToken(cookieValue(req,FAST_COOKIE));
  return Boolean(payload&&payload.channel===channel);
}
function wantsHtml(req){return String(req.get?.('accept')||'').includes('text/html');}

async function readJson(response){
  const text=await response.text();
  try{return text?JSON.parse(text):{};}catch{return {ok:false,error:text||`HTTP ${response.status}`};}
}
async function proxyInternalLogin(req,res){
  const channel=localChannel(req);
  if(!channel)return res.status(403).json({ok:false,code:'V246_LOCAL_AUTH_ONLY',error:'内部账号仅允许本机或局域网登录。'});
  const username=String(req.body?.username||'').trim();
  const password=String(req.body?.password||'');
  if(!username||!password)return res.status(400).json({ok:false,code:'V246_CREDENTIALS_REQUIRED',error:'请输入用户名和密码。'});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),4500);
  try{
    const response=await fetch(`http://127.0.0.1:${AUTH_PORT}/api/v213/local-auth/login`,{
      method:'POST',cache:'no-store',headers:{'content-type':'application/json','accept':'application/json'},
      body:JSON.stringify({username,password}),signal:controller.signal
    });
    const payload=await readJson(response);
    if(!response.ok||payload?.ok===false)return res.status(response.status||401).json({ok:false,code:payload?.code||'V246_AUTH_REJECTED',error:payload?.error||payload?.message||'用户名或密码错误。'});
    const sidecarPayload=verifyToken(payload?.handoffToken);
    if(!sidecarPayload)return res.status(502).json({ok:false,code:'V246_AUTH_TOKEN_INVALID',error:'独立认证服务返回的登录凭证无效。'});
    return res.json({ok:true,handoffToken:signForChannel(sidecarPayload,channel),user:sidecarPayload.user,authMode:'V246_SAME_ORIGIN_AUTH_PROXY'});
  }catch(error){
    const timeout=error?.name==='AbortError';
    return res.status(503).json({ok:false,code:timeout?'V246_AUTH_TIMEOUT':'V246_AUTH_UNAVAILABLE',error:timeout?'内部账号认证超过4.5秒未响应，请重新打开CE QC。':`内部账号认证服务不可用：${error?.message||error}`});
  }finally{clearTimeout(timer);}
}

function loginPage(){return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CE质控系统内部登录</title><style>body{margin:0;background:#f3f6fa;color:#17324d;font:15px/1.6 system-ui,'Microsoft YaHei',sans-serif;display:grid;place-items:center;min-height:100vh}.box{width:min(600px,calc(100% - 48px));background:#fff;border:1px solid #dce5ef;border-radius:12px;padding:38px 42px;box-shadow:0 18px 50px #16395b18}h1{font-size:30px;margin:0 0 8px;color:#083b6d}.sub{color:#71849a;margin-bottom:20px}label{display:block;margin:14px 0 6px;font-size:18px}input{box-sizing:border-box;width:100%;padding:14px 15px;border:1px solid #cbd8e5;border-radius:7px;font-size:17px}button{width:100%;margin-top:24px;border:0;border-radius:7px;background:#176fe8;color:#fff;padding:14px;font-size:18px;font-weight:700;cursor:pointer}button:disabled{opacity:.65;cursor:wait}#status{min-height:28px;margin-top:12px;font-weight:600;color:#176fe8}#status.error{color:#b42318}</style></head><body><main class="box"><h1>CE质控系统内部登录</h1><div class="sub">同源认证，不再要求浏览器直接连接5179端口</div><form id="login"><label>用户名</label><input id="username" autocomplete="username" required><label>密码</label><input id="password" type="password" autocomplete="current-password" required><button id="submit" type="submit">登录</button><div id="status" role="status"></div></form></main><script>(function(){const f=document.getElementById('login'),b=document.getElementById('submit'),s=document.getElementById('status');const msg=(t,e=false)=>{s.textContent=t||'';s.classList.toggle('error',e)};async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {error:t||('HTTP '+r.status)}}}f.addEventListener('submit',async e=>{e.preventDefault();if(b.disabled)return;b.disabled=true;b.textContent='正在校验账号…';msg('正在连接内部认证服务…');const c=new AbortController(),timer=setTimeout(()=>c.abort(),6000);try{const r=await fetch('${AUTH_PROXY_PATH}',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({username:document.getElementById('username').value.trim(),password:document.getElementById('password').value}),signal:c.signal});const p=await parse(r);if(!r.ok||p.ok===false)throw new Error((p.error||p.message||('登录失败 HTTP '+r.status))+(p.code?' ['+p.code+']':''));b.textContent='正在建立系统会话…';msg('账号验证通过，正在进入系统…');const h=await fetch('/api/v223/fast-auth/accept',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({handoffToken:p.handoffToken})});const hp=await parse(h);if(!h.ok||hp.ok===false)throw new Error(hp.error||hp.message||'主程序会话建立失败');b.textContent='登录成功';location.replace('/?v246='+Date.now());}catch(err){msg(err.name==='AbortError'?'登录超过6秒没有响应，请重新打开CE QC。':String(err.message||err),true);b.disabled=false;b.textContent='登录';}finally{clearTimeout(timer)}});})();</script></body></html>`;}

async function exactServiceHealth(req,res){
  try{
    const services=await startupServiceProbe.inspectStartupServices();
    const ready=Boolean(services?.ready);
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-CE-QC-Health-Mode','LOOPBACK_READINESS_ONLY');
    res.setHeader('X-CE-QC-Startup-Gate','V246-CORE-SERVICES-FIRST');
    res.setHeader('X-CE-QC-Data-Gate','V246-DATA-DIAGNOSTIC-ONLY');
    const payload={ok:ready,ready,startupState:ready?'CORE_SERVICES_READY':'CORE_SERVICES_INCOMPLETE',dataReady:null,dataState:'NOT_REQUIRED_FOR_STARTUP',dataBlocking:false,startupServices:services,authRequired:true,scope:'LOOPBACK_READINESS_ONLY',version:V246_CORE_AVAILABILITY_VERSION,time:new Date().toISOString()};
    if(ready)console.log('[CE-QC][V246_STARTUP_PASS] 5177 core + 5179 auth + 5178 export ready; business data is diagnostic-only and cannot block login.');
    return res.status(ready?200:503).json(payload);
  }catch(error){
    return res.status(503).json({ok:false,ready:false,startupState:'CORE_SERVICES_ERROR',dataReady:null,dataBlocking:false,error:error?.message||String(error),scope:'LOOPBACK_READINESS_ONLY',version:V246_CORE_AVAILABILITY_VERSION});
  }
}
function isLoopback(req){
  const ip=ipOnly(req.socket?.remoteAddress||''),host=hostOnly(req.hostname||req.get?.('host')||'');
  return (ip==='127.0.0.1'||ip==='::1')&&['127.0.0.1','localhost','::1'].includes(host);
}

function injectClient(body){
  if(typeof body!=='string'||!body.includes('<html')||!body.includes('/app.js')||body.includes('/v246-core-usability.js'))return body;
  return body.replace('</body>','  <script src="/v246-core-usability.js?v=20260820-v246-1"></script>\n</body>');
}
function v246CoreMiddleware(req,res,next){
  if(req.method==='GET'&&req.path==='/api/health'&&isLoopback(req))return void exactServiceHealth(req,res);
  if(req.method==='POST'&&req.path===AUTH_PROXY_PATH)return void proxyInternalLogin(req,res);
  if(req.method==='GET'&&APP_PATHS.has(req.path)&&localChannel(req)&&wantsHtml(req)&&!validFastSession(req)){
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
    res.setHeader('X-CE-QC-Login-Reliability',V246_CORE_AVAILABILITY_VERSION);
    return res.status(200).type('html').send(loginPage());
  }
  if(req.method==='GET'&&APP_PATHS.has(req.path)){
    const send=res.send.bind(res);let transformed=false;
    res.send=function v246CoreClientInject(body){if(!transformed){transformed=true;body=injectClient(body);}return send(body);};
  }
  return next();
}

function latestWhppDate(){
  const db=getDb();
  const candidates=[];
  const probes=[
    ['business_final_rows',"SELECT COALESCE(MAX(reportDate),'') d FROM business_final_rows WHERE UPPER(COALESCE(businessType,''))='WHPP'"],
    ['business_daily_parse_rows',"SELECT COALESCE(MAX(reportDate),'') d FROM business_daily_parse_rows WHERE UPPER(COALESCE(businessType,''))='WHPP'"],
    ['business_daily_reports',"SELECT COALESCE(MAX(reportDate),'') d FROM business_daily_reports WHERE UPPER(COALESCE(businessType,''))='WHPP'"]
  ];
  for(const [table,sql] of probes){
    try{if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table))continue;const d=String(db.prepare(sql).get()?.d||'');if(/^\d{4}-\d{2}-\d{2}$/.test(d))candidates.push(d);}catch{}
  }
  return candidates.sort().at(-1)||'';
}
function v246WhppSummary(req,res){
  try{
    const explicit=String(req.query?.reportDate||req.query?.date||'').slice(0,10);
    const reportDate=/^\d{4}-\d{2}-\d{2}$/.test(explicit)?explicit:latestWhppDate();
    const payload=inspectV132WhppFastSummary(reportDate);
    return res.setHeader('Cache-Control','private, max-age=3').json({...payload,patchId:'2026-08-20-v246-whpp-stable-refresh-v1',resolvedReportDate:reportDate||''});
  }catch(error){return res.status(500).json({ok:false,code:'V246_WHPP_SUMMARY_FAILED',error:error?.message||String(error)});}
}

if(!CEClient.prototype[CE_LOGIN_PATCHED]){
  const original=CEClient.prototype.login;
  Object.defineProperty(CEClient.prototype,CE_LOGIN_PATCHED,{value:true});
  CEClient.prototype.login=async function v246BoundedCeLogin(...args){
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('CE API登录超过10秒未响应，请检查CE网络或账号后重试。');error.code='CE_LOGIN_TIMEOUT';reject(error);},10_000);});
    try{return await Promise.race([original.apply(this,args),timeout]);}finally{clearTimeout(timer);}
  };
}

if(!express.application[INSTALLED]){
  Object.defineProperty(express.application,INSTALLED,{value:true});
  const previousUse=express.application.use;
  let middlewareMounted=false;
  express.application.use=function v246SystemFirstUse(...args){
    const functions=args.flat().filter(value=>typeof value==='function');
    const access=functions.some(fn=>fn.name==='accessIdentity'||fn.name==='v209AccessIdentityNoHang');
    if(access&&!middlewareMounted){middlewareMounted=true;previousUse.call(this,v246CoreMiddleware);}
    return previousUse.apply(this,args);
  };
  const previousListen=express.application.listen;
  let whppMounted=false;
  express.application.listen=function v246SystemFirstListen(...args){
    if(!whppMounted){whppMounted=true;this.get('/api/v132/whpp-fast-summary',v246WhppSummary);}
    return previousListen.apply(this,args);
  };
}

console.log('[CE-QC][V246] system-first mode armed: startup/login are independent from business-data completeness; same-origin internal login, bounded CE API login, and authoritative WHPP refresh are enabled.');

export const __test={hostOnly,ipOnly,localChannel,verifyToken,signForChannel,validFastSession,isLoopback,latestWhppDate,injectClient};
