import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc11-golden-'));
const port=5577;
const origin=`http://127.0.0.1:${port}`;
const env={
  ...process.env,
  NODE_ENV:'test',
  HOST:'127.0.0.1',
  PORT:String(port),
  ACCESS_MODE:'DUAL',
  DATA_DIR:tmp,
  DB_FILE:path.join(tmp,'qc11-e2e.db'),
  EXPORTS_DIR:path.join(tmp,'exports'),
  PUBLIC_HOSTNAME:'',
  CE_QC_BACKGROUND_MAINTENANCE_ENABLED:'0',
  CE_QC_DISABLE_SHOPEE_DELIVERY_TRACKER:'1',
  DASHBOARD_CACHE_STARTUP_DELAY_MS:'120000'
};
const child=spawn(process.execPath,['bootstrap.js'],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
let log='';
child.stdout.on('data',d=>{log+=d.toString();});
child.stderr.on('data',d=>{log+=d.toString();});

async function stop(){
  if(child.exitCode!==null)return;
  try{child.kill('SIGTERM');}catch{}
  await new Promise(r=>setTimeout(r,500));
  if(child.exitCode===null&&process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});
  else if(child.exitCode===null)try{child.kill('SIGKILL');}catch{}
}
function fail(message){throw new Error(`${message}\n--- runtime log ---\n${log.slice(-12000)}`);}
async function json(url,options={}){
  const res=await fetch(url,options);let body={};const text=await res.text();try{body=text?JSON.parse(text):{};}catch{}
  return{res,body,text};
}
async function waitHealth(){
  const end=Date.now()+45000;
  while(Date.now()<end){
    if(child.exitCode!==null)fail(`backend exited ${child.exitCode}`);
    try{
      const {res,body}=await json(`${origin}/api/health`,{headers:{Accept:'application/json'}});
      if(res.status===200&&body.ok===true&&body.ready===true&&res.headers.get('x-ce-qc-health-mode')==='LOOPBACK_READINESS_ONLY')return;
    }catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  fail('golden direct-login runtime did not reach exact loopback health');
}

try{
  await waitHealth();
  const bootstrap=await json(`${origin}/api/internal-auth/bootstrap`,{
    method:'POST',headers:{'content-type':'application/json','origin':origin},
    body:JSON.stringify({username:'qc11admin',displayName:'QC11 Admin',password:'Qc11Final!2026'})
  });
  if(bootstrap.res.status!==200||bootstrap.body.ok!==true)fail(`internal bootstrap failed ${bootstrap.res.status}: ${bootstrap.text}`);
  const cookie=(bootstrap.res.headers.get('set-cookie')||'').split(';')[0];
  if(!/^ce_internal_session=/.test(cookie))fail('direct 5177 login did not issue ce_internal_session cookie');

  const session=await json(`${origin}/api/session`,{headers:{cookie,Accept:'application/json'}});
  if(session.res.status!==200||session.body?.user?.username!=='qc11admin'||session.body?.user?.role!=='ADMIN')fail(`authenticated session failed: ${session.text}`);

  const settings=await fetch(`${origin}/settings`,{headers:{cookie}});
  const html=await settings.text();
  if(settings.status!==200||!html.includes('CE EXPRESS'))fail('authenticated settings shell is unavailable');

  const attempt=await json(`${origin}/api/v203/attempt-summary?businessType=SHOPEECN`,{headers:{cookie,Accept:'application/json'}});
  if(attempt.res.status!==200||attempt.body.ok!==true)fail(`attempt-summary route failed: ${attempt.text}`);

  const network=await json(`${origin}/api/v203/network-access`,{headers:{cookie,Accept:'application/json'}});
  if(network.res.status!==200||network.body.ok!==true)fail(`network/settings route failed: ${network.text}`);

  console.log('CE_QC_QC11_GOLDEN_HEALTH=PASS');
  console.log('CE_QC_QC11_DIRECT_INTERNAL_LOGIN=PASS');
  console.log('CE_QC_QC11_SESSION_SETTINGS=PASS');
  console.log('CE_QC_QC11_ATTEMPT_ROUTE=PASS');
}finally{
  await stop();
  fs.rmSync(tmp,{recursive:true,force:true});
}
