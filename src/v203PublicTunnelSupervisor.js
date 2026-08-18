import express from 'express';
import { spawn } from 'node:child_process';

export const V203_PUBLIC_TUNNEL_VERSION='2026-08-18-v203-named-cloudflare-tunnel-supervisor-v1';
let child=null;
let status='DISABLED';
let lastError='';
let lastStartedAt='';
let lastExitAt='';
let restartTimer=null;
let stopping=false;

function token(){return String(process.env.CLOUDFLARE_TUNNEL_TOKEN||process.env.CF_TUNNEL_TOKEN||'').trim();}
function enabled(){return Boolean(token())&&String(process.env.CE_QC_PUBLIC_TUNNEL_ENABLED||'1').trim()!=='0';}
function binary(){return String(process.env.CLOUDFLARED_PATH||'cloudflared').trim()||'cloudflared';}
function restartDelay(){return Math.max(5000,Math.min(120000,Number(process.env.CE_QC_PUBLIC_TUNNEL_RESTART_MS||15000)));}
function startTunnel(){
  if(!enabled()){status='DISABLED';return;}
  if(child){status='RUNNING';return;}
  const secret=token();
  try{
    status='STARTING';lastError='';lastStartedAt=new Date().toISOString();
    child=spawn(binary(),['tunnel','--no-autoupdate','run','--token',secret],{
      cwd:process.cwd(),env:{...process.env},windowsHide:true,detached:false,stdio:['ignore','pipe','pipe']
    });
    child.stdout?.on('data',buffer=>{const text=String(buffer||'').trim();if(text)console.log(`[CE-QC][V203_PUBLIC_TUNNEL] ${text.replace(secret,'[REDACTED]')}`);});
    child.stderr?.on('data',buffer=>{const text=String(buffer||'').trim();if(text)console.warn(`[CE-QC][V203_PUBLIC_TUNNEL] ${text.replace(secret,'[REDACTED]')}`);});
    child.once('spawn',()=>{status='RUNNING';console.log(`[CE-QC][V203_PUBLIC_TUNNEL] named tunnel started pid=${child?.pid||'-'}; PUBLIC_HOSTNAME=${process.env.PUBLIC_HOSTNAME||'not-set'}`);});
    child.once('error',error=>{lastError=error?.message||String(error);status='FAILED';console.error('[CE-QC][V203_PUBLIC_TUNNEL] start failed:',lastError);});
    child.once('exit',(code,signal)=>{child=null;lastExitAt=new Date().toISOString();status=stopping?'STOPPED':'WAITING_RESTART';console.warn(`[CE-QC][V203_PUBLIC_TUNNEL] exited code=${code??'null'}${signal?` signal=${signal}`:''}`);if(!stopping&&enabled()){clearTimeout(restartTimer);restartTimer=setTimeout(startTunnel,restartDelay());restartTimer.unref?.();}});
  }catch(error){child=null;status='FAILED';lastError=error?.message||String(error);console.error('[CE-QC][V203_PUBLIC_TUNNEL] start exception:',lastError);}
}
function stopTunnel(){stopping=true;clearTimeout(restartTimer);restartTimer=null;try{child?.kill();}catch{}child=null;status='STOPPED';}
process.once('exit',stopTunnel);process.once('SIGINT',stopTunnel);process.once('SIGTERM',stopTunnel);

let installed=false;const previousListen=express.application.listen;
express.application.listen=function v203PublicTunnelListen(...args){const server=previousListen.apply(this,args);if(!installed){installed=true;const kick=()=>setTimeout(startTunnel,1000).unref?.();if(server?.listening)kick();else server?.once?.('listening',kick);}return server;};

export function inspectV203PublicTunnel(){return{version:V203_PUBLIC_TUNNEL_VERSION,enabled:enabled(),configured:Boolean(token()),status,pid:child?.pid||0,binary:binary(),publicHostname:String(process.env.PUBLIC_HOSTNAME||''),lastStartedAt,lastExitAt,lastError,restartDelayMs:restartDelay()};}
