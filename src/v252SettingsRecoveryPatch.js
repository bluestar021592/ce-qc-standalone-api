import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CEClient, normalizeLoginToken } from './ceClient.js';
import { loadToken, saveToken, summarizeToken } from './authStore.js';

export const V252_SETTINGS_RECOVERY_VERSION='2026-08-21-v252-settings-recovery-v1';
const INSTALLED=Symbol.for('ce-qc.v252-settings-recovery-installed');
const SHELL='/api/v252/settings-shell';
const CE_LOGIN='/api/v252/ce-login';
const APP_PATHS=new Set(['/','/home','/ce','/ceaf','/tbkh','/ali1688','/shopeecn','/shopeevn','/whpp','/tracking','/exceptions','/reports','/import','/data-management','/settings','/logs','/carryover-center']);

function localLike(req){return req.accessMode==='LOCAL'||req.accessMode==='LAN';}
function publicFastUser(user={}){return{id:user.id||'',username:user.username||'',email:user.email||'',displayName:user.displayName||'',department:user.department||user.departmentCompany||'',role:user.role||'VIEWER',businessScope:user.businessScope||'ALL'};}
function lanIp(){for(const list of Object.values(os.networkInterfaces()))for(const item of list||[])if(item&&item.family==='IPv4'&&!item.internal&&!String(item.address||'').startsWith('169.254.'))return item.address;return '';}
function networkInfo(req){const ip=lanIp();const publicHost=String(process.env.PUBLIC_HOSTNAME||'').trim();return{currentOrigin:`${req.protocol||'http'}://${req.get?.('host')||'127.0.0.1:5177'}`,lanUrl:ip?`http://${ip}:5177`:'',publicUrl:publicHost?`https://${publicHost}`:'',publicConfigured:Boolean(publicHost&&String(process.env.CF_ACCESS_TEAM_DOMAIN||'').trim()&&String(process.env.CF_ACCESS_AUD||'').trim())};}
function injectClient(body){if(typeof body!=='string'||!body.includes('</body>')||body.includes('/v252-settings-recovery.js'))return body;return body.replace('</body>','  <script src="/v252-settings-recovery.js?v=20260821-v252-1"></script>\n</body>');}

async function settingsShell(req,res){const token=await loadToken();return res.json({ok:true,version:V252_SETTINGS_RECOVERY_VERSION,user:publicFastUser(req.user),ceAuth:summarizeToken(token),network:networkInfo(req),dashboardRequired:false});}
async function ceLogin(req,res){
  if(!localLike(req)||!req.user?.username)return res.status(403).json({ok:false,code:'V252_LOCAL_SESSION_REQUIRED',error:'CE系统登录仅允许已登录的本机或局域网内部账号。'});
  const tenantId=String(req.body?.tenantId||'000000').trim()||'000000';
  const username=String(req.body?.username||'').trim();
  const password=String(req.body?.password||'');
  if(!username||!password)return res.status(400).json({ok:false,code:'V252_CE_CREDENTIALS_REQUIRED',error:'请输入CE账号和密码。'});
  if(!String(process.env.CE_AUTHORIZATION||'').trim())return res.status(503).json({ok:false,code:'V252_CE_AUTHORIZATION_MISSING',error:'CE基础认证配置缺失，当前无法连接CE登录接口。'});
  const started=Date.now();
  console.log(`[CE-QC][V252_CE_LOGIN_START] internalUser=${req.user.username} role=${req.user.role||'-'} ceUser=${username}`);
  try{
    const client=new CEClient();
    const raw=await client.login({tenantId,username,password,grant_type:'password',scope:'all',type:'account'});
    const token=normalizeLoginToken(raw,{tenantId,username});
    await saveToken(token);
    console.log(`[CE-QC][V252_CE_LOGIN_OK] internalUser=${req.user.username} ceUser=${username} ms=${Date.now()-started}`);
    return res.json({ok:true,version:V252_SETTINGS_RECOVERY_VERSION,authStatus:summarizeToken(token),elapsedMs:Date.now()-started});
  }catch(error){
    const timeout=/超过10秒|timeout|ETIMEDOUT/i.test(String(error?.message||error));
    console.error(`[CE-QC][V252_CE_LOGIN_FAILED] internalUser=${req.user.username} ms=${Date.now()-started} error=${error?.message||error}`);
    return res.status(timeout?504:502).json({ok:false,code:timeout?'V252_CE_LOGIN_TIMEOUT':'V252_CE_LOGIN_FAILED',error:String(error?.message||'CE登录失败'),elapsedMs:Date.now()-started});
  }
}
function v252SettingsRecovery(req,res,next){
  if(req.method==='GET'&&req.path===SHELL)return void settingsShell(req,res);
  if(req.method==='POST'&&req.path===CE_LOGIN)return void ceLogin(req,res);
  if(req.method==='GET'&&APP_PATHS.has(req.path)){
    const original=res.sendFile.bind(res);
    res.sendFile=function v252SendFile(file,...args){
      try{if(path.basename(String(file||''))==='index.html'){const html=fs.readFileSync(file,'utf8');res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');return res.status(200).type('html').send(injectClient(html));}}catch(error){console.error('[CE-QC][V252_HTML_INJECT_FAILED]',error?.message||error);}
      return original(file,...args);
    };
  }
  return next();
}

if(!express.application[INSTALLED]){
  Object.defineProperty(express.application,INSTALLED,{value:true});
  const previousUse=express.application.use;let mounted=false;
  express.application.use=function v252SettingsRecoveryUse(...args){
    const functions=args.flat().filter(v=>typeof v==='function');
    const access=functions.some(fn=>fn.name==='accessIdentity'||fn.name==='v209AccessIdentityNoHang');
    const result=previousUse.apply(this,args);
    if(access&&!mounted){mounted=true;previousUse.call(this,v252SettingsRecovery);}
    return result;
  };
}

console.log('[CE-QC][V252] settings recovery armed after authentication: settings/CE connector no longer wait for dashboard bootstrap.');
export const __test={SHELL,CE_LOGIN,injectClient,localLike,publicFastUser,networkInfo};
