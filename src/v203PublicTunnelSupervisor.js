import express from 'express';
import { spawn } from 'node:child_process';

export const V203_PUBLIC_TUNNEL_VERSION='2026-08-18-v204-named-or-quick-cloudflare-tunnel-supervisor-v2';
let child=null;
let status='DISABLED';
let lastError='';
let lastStartedAt='';
let lastExitAt='';
let restartTimer=null;
let stopping=false;
let mode='DISABLED';
let quickUrl='';

function token(){return String(process.env.CLOUDFLARE_TUNNEL_TOKEN||process.env.CF_TUNNEL_TOKEN||'').trim();}
function publicEnabled(){return String(process.env.CE_QC_PUBLIC_TUNNEL_ENABLED||'1').trim()!=='0';}
function quickEnabled(){return String(process.env.CE_QC_PUBLIC_QUICK_TUNNEL_ENABLED||'1').trim()!=='0';}
function enabled(){return publicEnabled()&&(Boolean(token())||quickEnabled());}
function binary(){return String(process.env.CLOUDFLARED_PATH||'cloudflared').trim()||'cloudflared';}
function restartDelay(){return Math.max(5000,Math.min(120000,Number(process.env.CE_QC_PUBLIC_TUNNEL_RESTART_MS||15000)));}
function localOrigin(){const port=Number(process.env.PORT||process.env.CE_QC_PORT||5177)||5177;return `http://127.0.0.1:${port}`;}
function parseQuickUrl(text=''){
  const match=String(text||'').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if(match){quickUrl=match[0];status='RUNNING';mode='QUICK';console.log(`[CE-QC][V204_PUBLIC_TUNNEL] quick tunnel ready ${quickUrl}`);}
}
function safeLog(text='',secret=''){return String(text||'').replaceAll(secret,'[REDACTED]');}
function startTunnel(){
  if(!enabled()){status='DISABLED';mode='DISABLED';quickUrl='';return;}
  if(child){status='RUNNING';return;}
  const secret=token();
  const named=Boolean(secret);
  try{
    status='STARTING';mode=named?'NAMED':'QUICK';lastError='';lastStartedAt=new Date().toISOString();if(named)quickUrl='';
    const args=named
      ? ['tunnel','--no-autoupdate','run','--token',secret]
      : ['tunnel','--no-autoupdate','--url',localOrigin()];
    child=spawn(binary(),args,{cwd:process.cwd(),env:{...process.env},windowsHide:true,detached:false,stdio:['ignore','pipe','pipe']});
    child.stdout?.on('data',buffer=>{const text=String(buffer||'').trim();if(!text)return;parseQuickUrl(text);console.log(`[CE-QC][V204_PUBLIC_TUNNEL] ${safeLog(text,secret)}`);});
    child.stderr?.on('data',buffer=>{const text=String(buffer||'').trim();if(!text)return;parseQuickUrl(text);console.warn(`[CE-QC][V204_PUBLIC_TUNNEL] ${safeLog(text,secret)}`);});
    child.once('spawn',()=>{if(named){status='RUNNING';mode='NAMED';}console.log(`[CE-QC][V204_PUBLIC_TUNNEL] ${named?'named':'quick'} tunnel process started pid=${child?.pid||'-'}; target=${localOrigin()}`);});
    child.once('error',error=>{lastError=error?.message||String(error);status='FAILED';console.error('[CE-QC][V204_PUBLIC_TUNNEL] start failed:',lastError);});
    child.once('exit',(code,signal)=>{child=null;lastExitAt=new Date().toISOString();status=stopping?'STOPPED':'WAITING_RESTART';if(!named)quickUrl='';console.warn(`[CE-QC][V204_PUBLIC_TUNNEL] exited code=${code??'null'}${signal?` signal=${signal}`:''}`);if(!stopping&&enabled()){clearTimeout(restartTimer);restartTimer=setTimeout(startTunnel,restartDelay());restartTimer.unref?.();}});
  }catch(error){child=null;status='FAILED';lastError=error?.message||String(error);console.error('[CE-QC][V204_PUBLIC_TUNNEL] start exception:',lastError);}
}
function stopTunnel(){stopping=true;clearTimeout(restartTimer);restartTimer=null;try{child?.kill();}catch{}child=null;status='STOPPED';}
process.once('exit',stopTunnel);process.once('SIGINT',stopTunnel);process.once('SIGTERM',stopTunnel);

let installed=false;const previousListen=express.application.listen;
express.application.listen=function v204PublicTunnelListen(...args){const server=previousListen.apply(this,args);if(!installed){installed=true;const kick=()=>setTimeout(startTunnel,1000).unref?.();if(server?.listening)kick();else server?.once?.('listening',kick);}return server;};

export function inspectV203PublicTunnel(){return{version:V203_PUBLIC_TUNNEL_VERSION,enabled:enabled(),publicEnabled:publicEnabled(),quickEnabled:quickEnabled(),configured:Boolean(token()),mode,status,pid:child?.pid||0,binary:binary(),localOrigin:localOrigin(),quickUrl,publicHostname:String(process.env.PUBLIC_HOSTNAME||''),lastStartedAt,lastExitAt,lastError,restartDelayMs:restartDelay()};}
