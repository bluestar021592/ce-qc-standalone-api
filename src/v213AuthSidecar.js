import 'dotenv/config';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeConfig } from './db.js';

export const V213_AUTH_SIDECAR_VERSION='2026-08-19-v226-auth-sidecar-handoff-v2';
const PORT=Math.max(1024,Math.min(65535,Number(process.env.CE_QC_AUTH_SIDECAR_PORT||5179)));
const APP_PORT=Math.max(1024,Math.min(65535,Number(process.env.PORT||5177)));
const HOST=String(process.env.CE_QC_AUTH_SIDECAR_HOST||'0.0.0.0');
const COOKIE='ce_v213_fast_session';
const HOURS=Math.max(1,Math.min(24,Number(process.env.CE_QC_LOCAL_FAST_SESSION_HOURS||8)));
let cachedSecret='';

function hostOnly(value=''){return String(value||'').trim().toLowerCase().replace(/^\[|\]$/g,'').split(':')[0];}
function ipOnly(value=''){return String(value||'').replace(/^::ffff:/,'');}
function privateV4(value=''){return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(String(value||''));}
function localChannel(req){
  const host=hostOnly(req.headers.host||''),ip=ipOnly(req.socket?.remoteAddress||'');
  if(['127.0.0.1','localhost','::1'].includes(host)&&(ip==='127.0.0.1'||ip==='::1'))return 'LOCAL';
  if(net.isIP(host)===4&&privateV4(host)&&privateV4(ip))return 'LAN';
  return '';
}
function cleanUsername(value){return String(value||'').trim().toLowerCase().replace(/[^a-z0-9_.-]/g,'').slice(0,60);}
function publicUser(row={}){return{id:row.id||'',username:row.username||'',email:row.email||'',displayName:row.displayName||'',department:row.departmentCompany||'',role:row.role||'VIEWER',businessScope:row.businessScope||'ALL',mustChangePassword:Boolean(row.mustChangePassword),devMode:true};}
function secretFile(){const cfg=getRuntimeConfig();fs.mkdirSync(cfg.tokenDir,{recursive:true});return path.join(cfg.tokenDir,'v213_local_fast_session.secret');}
function secret(){
  if(cachedSecret)return cachedSecret;
  const env=String(process.env.CE_QC_LOCAL_SESSION_SECRET||'').trim();if(env.length>=32){cachedSecret=env;return cachedSecret;}
  const file=secretFile();
  try{const existing=fs.readFileSync(file,'utf8').trim();if(existing.length>=43){cachedSecret=existing;return cachedSecret;}}catch{}
  const created=crypto.randomBytes(48).toString('base64url');
  try{fs.writeFileSync(file,created,{encoding:'utf8',mode:0o600,flag:'wx'});cachedSecret=created;}
  catch(error){if(error?.code!=='EEXIST')throw error;cachedSecret=fs.readFileSync(file,'utf8').trim();}
  return cachedSecret;
}
function sign(payload){const body=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');const sig=crypto.createHmac('sha256',secret()).update(body).digest('base64url');return`${body}.${sig}`;}
function readAuthRow(username){
  const file=getRuntimeConfig().dbFile;
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    db.exec('PRAGMA query_only=ON');
    db.exec('PRAGMA busy_timeout=500');
    return db.prepare("SELECT id,username,displayName,departmentCompany,email,passwordHash,role,businessScope,enabled,status,expiresAt,mustChangePassword,lockedUntil FROM users WHERE username=? AND status='ACTIVE' LIMIT 1").get(username)||null;
  }finally{try{db.close();}catch{}}
}
function allowedOrigin(req){
  const raw=String(req.headers.origin||'').trim();if(!raw)return{ok:true,origin:''};
  try{const u=new URL(raw);const requestHost=hostOnly(req.headers.host||'');const sameHost=u.hostname.toLowerCase()===requestHost;const appPort=Number(u.port||80)===APP_PORT;return{ok:sameHost&&appPort,origin:raw};}catch{return{ok:false,origin:raw};}
}
function headers(req,res,status=200){
  const allowed=allowedOrigin(req);
  if(!allowed.ok){res.writeHead(403,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({ok:false,code:'V213_ORIGIN_DENIED',error:'独立登录服务拒绝跨主机请求。'}));return false;}
  const h={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-ce-qc-auth-sidecar':V213_AUTH_SIDECAR_VERSION};
  if(allowed.origin){h['access-control-allow-origin']=allowed.origin;h['access-control-allow-credentials']='true';h['vary']='Origin';}
  h['access-control-allow-headers']='Content-Type';h['access-control-allow-methods']='GET,POST,OPTIONS';res.writeHead(status,h);return true;
}
function json(req,res,status,payload,extra={}){
  const allowed=allowedOrigin(req);if(!allowed.ok){if(headers(req,res,403))res.end(JSON.stringify({ok:false,error:'Origin denied'}));return;}
  const h={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-ce-qc-auth-sidecar':V213_AUTH_SIDECAR_VERSION,...extra};
  if(allowed.origin){h['access-control-allow-origin']=allowed.origin;h['access-control-allow-credentials']='true';h['vary']='Origin';}
  h['access-control-allow-headers']='Content-Type';h['access-control-allow-methods']='GET,POST,OPTIONS';res.writeHead(status,h);res.end(JSON.stringify(payload));
}
function bodyJson(req){return new Promise((resolve,reject)=>{let total=0,chunks=[];req.on('data',chunk=>{total+=chunk.length;if(total>32768){reject(new Error('REQUEST_TOO_LARGE'));req.destroy();return;}chunks.push(chunk);});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'));}catch{reject(new Error('INVALID_JSON'));}});req.on('error',reject);});}
function cookieFor(row,channel){
  const exp=Date.now()+HOURS*60*60_000;const payload={v:213,iat:Date.now(),exp,channel,user:publicUser(row)};const token=sign(payload);
  const cookies=[
    'ce_internal_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    'ce_v211_fast_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    'ce_v212_fast_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${HOURS*3600}`
  ];
  return{cookies,payload,token,expiresAt:new Date(exp).toISOString()};
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'127.0.0.1'}`);
  if(req.method==='OPTIONS'){const allowed=allowedOrigin(req);if(!allowed.ok)return json(req,res,403,{ok:false,code:'V213_ORIGIN_DENIED'});const h={'access-control-allow-origin':allowed.origin||'*','access-control-allow-credentials':'true','access-control-allow-headers':'Content-Type','access-control-allow-methods':'GET,POST,OPTIONS','cache-control':'no-store'};res.writeHead(204,h);return res.end();}
  if(req.method==='GET'&&url.pathname==='/api/v213/auth-ping')return json(req,res,200,{ok:true,version:V213_AUTH_SIDECAR_VERSION,port:PORT,appPort:APP_PORT,pid:process.pid});
  if(req.method!=='POST'||url.pathname!=='/api/v213/local-auth/login')return json(req,res,404,{ok:false,code:'V213_NOT_FOUND'});
  const channel=localChannel(req);if(!channel)return json(req,res,403,{ok:false,code:'V213_CHANNEL_DENIED',error:'当前访问来源不允许使用本机/LAN登录。'});
  const started=Date.now();
  console.log(`[CE-QC][V213_AUTH_SIDECAR_LOGIN_START] channel=${channel}`);
  try{
    const body=await bodyJson(req);const username=cleanUsername(body?.username),password=String(body?.password||'');
    if(!username||!password)return json(req,res,400,{ok:false,code:'V213_CREDENTIALS_REQUIRED',error:'请输入用户名和密码。'});
    const row=readAuthRow(username);
    console.log(`[CE-QC][V213_AUTH_SIDECAR_READ_OK] user=${username} found=${Boolean(row)} ms=${Date.now()-started}`);
    if(!row)return json(req,res,401,{ok:false,code:'V213_INVALID_CREDENTIALS',error:'用户名或密码错误。'});
    if(!Number(row.enabled))return json(req,res,403,{ok:false,code:'V213_ACCOUNT_DISABLED',error:'该账号已停用。'});
    if(row.expiresAt&&Date.parse(row.expiresAt)<=Date.now())return json(req,res,403,{ok:false,code:'V213_ACCOUNT_EXPIRED',error:'该账号已过期。'});
    if(row.lockedUntil&&Date.parse(row.lockedUntil)>Date.now())return json(req,res,423,{ok:false,code:'V213_ACCOUNT_LOCKED',error:'该账号暂时锁定，请稍后再试。'});
    const matched=bcrypt.compareSync(password,String(row.passwordHash||''));
    console.log(`[CE-QC][V213_AUTH_SIDECAR_PASSWORD_CHECK] user=${username} matched=${matched} ms=${Date.now()-started}`);
    if(!matched)return json(req,res,401,{ok:false,code:'V213_INVALID_CREDENTIALS',error:'用户名或密码错误。'});
    const issued=cookieFor(row,channel);
    console.log(`[CE-QC][V213_AUTH_SIDECAR_LOGIN_OK] user=${username} channel=${channel} ms=${Date.now()-started}`);
    return json(req,res,200,{ok:true,user:issued.payload.user,expiresAt:issued.expiresAt,authMode:'V223_ISOLATED_AUTH_SIDECAR',handoffToken:issued.token}, {'set-cookie':issued.cookies});
  }catch(error){
    console.error(`[CE-QC][V213_AUTH_SIDECAR_ERROR] ms=${Date.now()-started}`,error?.stack||error);
    const busy=/SQLITE_BUSY|database is locked/i.test(String(error?.message||error));
    return json(req,res,busy?503:500,{ok:false,code:busy?'V213_AUTH_DB_BUSY':'V213_AUTH_SIDECAR_ERROR',error:busy?'账号只读校验遇到数据库锁，请稍后重试。':'独立登录服务异常。',detail:String(error?.message||error)});
  }
});
server.requestTimeout=5000;server.headersTimeout=6000;server.keepAliveTimeout=1000;
server.listen(PORT,HOST,()=>console.log(`[CE-QC][V213_AUTH_SIDECAR] READY http://${HOST}:${PORT} · main=${APP_PORT} · ${V213_AUTH_SIDECAR_VERSION} · login isolated from main event loop`));
server.on('error',error=>{console.error('[CE-QC][V213_AUTH_SIDECAR] START FAILED:',error?.stack||error);process.exitCode=1;});
function shutdown(){try{server.close();}catch{}}
process.once('SIGINT',()=>{shutdown();process.exit(0);});
process.once('SIGTERM',()=>{shutdown();process.exit(0);});
process.once('exit',shutdown);

export const __test={hostOnly,ipOnly,privateV4,localChannel,cleanUsername,allowedOrigin,readAuthRow};
