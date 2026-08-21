import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc11-golden-'));
const port=5577;
const exportPort=5578;
const origin=`http://127.0.0.1:${port}`;
const exportOrigin=`http://127.0.0.1:${exportPort}`;
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
  CE_QC_EXPORT_SIDECAR_PORT:String(exportPort),
  CE_QC_BACKGROUND_MAINTENANCE_ENABLED:'0',
  CE_QC_DISABLE_SHOPEE_DELIVERY_TRACKER:'1',
  DASHBOARD_CACHE_STARTUP_DELAY_MS:'120000'
};
const child=spawn(process.execPath,['bootstrap.js'],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
let log='';
child.stdout.on('data',d=>{log+=d.toString();});
child.stderr.on('data',d=>{log+=d.toString();});

async function stop(){
  const sidecarPid=Number(log.match(/V193 isolated export sidecar starting pid=(\d+)/)?.[1]||0);
  if(child.exitCode===null){
    if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});
    else{try{child.kill('SIGTERM');}catch{} await new Promise(r=>setTimeout(r,350)); if(child.exitCode===null)try{child.kill('SIGKILL');}catch{}}
  }
  if(process.platform!=='win32'&&sidecarPid>0){try{process.kill(sidecarPid,'SIGTERM');}catch{}}
}
function fail(message){throw new Error(`${message}\n--- runtime log ---\n${log.slice(-12000)}`);}
async function json(url,options={}){
  const res=await fetch(url,options);let body={};const text=await res.text();try{body=text?JSON.parse(text):{};}catch{}
  return{res,body,text};
}
async function waitUntil(label,probe,timeoutMs=45000){
  const end=Date.now()+timeoutMs;
  while(Date.now()<end){
    if(child.exitCode!==null)fail(`backend exited ${child.exitCode} while waiting for ${label}`);
    try{if(await probe())return;}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  fail(`${label} did not become ready`);
}

try{
  await waitUntil('golden direct-login loopback health',async()=>{
    const {res,body}=await json(`${origin}/api/health`,{headers:{Accept:'application/json'}});
    return res.status===200&&body.ok===true&&body.ready===true&&res.headers.get('x-ce-qc-health-mode')==='LOOPBACK_READINESS_ONLY';
  });
  await waitUntil('isolated export sidecar',async()=>{
    const {res,body}=await json(`${exportOrigin}/api/v194/export-ping`,{headers:{Accept:'application/json'}});
    return res.status===200&&body.ok===true&&body.statusTransport==='IPC_MEMORY_V195'&&Array.isArray(body.capabilities)&&body.capabilities.includes('ALL')&&body.capabilities.includes('SINGLE');
  });

  const bootstrap=await json(`${origin}/api/internal-auth/bootstrap`,{
    method:'POST',headers:{'content-type':'application/json','origin':origin},
    body:JSON.stringify({username:'qc11admin',displayName:'QC11 Admin',password:'Qc11Final!2026'})
  });
  if(bootstrap.res.status!==200||bootstrap.body.ok!==true)fail(`internal bootstrap failed ${bootstrap.res.status}: ${bootstrap.text}`);

  const wrongStarted=Date.now();
  const wrong=await json(`${origin}/api/internal-auth/login`,{
    method:'POST',headers:{'content-type':'application/json','origin':origin},
    body:JSON.stringify({username:'qc11admin',password:'wrong-password'})
  });
  if(wrong.res.status!==401||wrong.body.ok!==false)fail(`wrong-password login must return explicit 401, got ${wrong.res.status}: ${wrong.text}`);
  if(Date.now()-wrongStarted>5000)fail('wrong-password internal login exceeded 5 seconds');

  const loginStarted=Date.now();
  const login=await json(`${origin}/api/internal-auth/login`,{
    method:'POST',headers:{'content-type':'application/json','origin':origin},
    body:JSON.stringify({username:'qc11admin',password:'Qc11Final!2026'})
  });
  if(login.res.status!==200||login.body.ok!==true)fail(`direct internal login failed ${login.res.status}: ${login.text}`);
  if(Date.now()-loginStarted>5000)fail('correct internal login exceeded 5 seconds');
  const cookie=(login.res.headers.get('set-cookie')||'').split(';')[0];
  if(!/^ce_internal_session=/.test(cookie))fail('direct 5177 login did not issue ce_internal_session cookie');

  const session=await json(`${origin}/api/session`,{headers:{cookie,Accept:'application/json'}});
  if(session.res.status!==200||session.body?.user?.username!=='qc11admin'||session.body?.user?.role!=='ADMIN')fail(`authenticated session failed: ${session.text}`);

  const settings=await fetch(`${origin}/settings`,{headers:{cookie}});
  const html=await settings.text();
  if(settings.status!==200||!html.includes('CE EXPRESS')||!html.includes('v203-dashboard-integrity.js'))fail('authenticated settings shell is unavailable or missing final UI layer');

  const ceFeedbackStarted=Date.now();
  const ceFeedback=await json(`${origin}/api/ce-login`,{
    method:'POST',headers:{cookie,Accept:'application/json','content-type':'application/json','origin':origin},
    body:JSON.stringify({username:'',password:''})
  });
  if(ceFeedback.res.status!==400||ceFeedback.body.ok!==false||!/CE账号和密码/.test(String(ceFeedback.body.error||'')))fail(`CE API login route did not return immediate visible validation: ${ceFeedback.res.status} ${ceFeedback.text}`);
  if(Date.now()-ceFeedbackStarted>2500)fail('CE API login validation feedback exceeded 2.5 seconds');

  const attempt=await json(`${origin}/api/v203/attempt-summary?businessType=SHOPEECN`,{headers:{cookie,Accept:'application/json'}});
  if(attempt.res.status!==200||attempt.body.ok!==true)fail(`attempt-summary route failed: ${attempt.text}`);

  const whpp=await json(`${origin}/api/v132/whpp-fast-summary`,{headers:{cookie,Accept:'application/json'}});
  if(whpp.res.status!==200||whpp.body.ok!==true)fail(`WHPP fast summary failed: ${whpp.text}`);
  if(whpp.res.headers.get('x-ce-qc-whpp-authority')!=='V248-AFTER-ACCESS-BEFORE-LEGACY')fail(`WHPP route is not owned by V248 authority; header=${whpp.res.headers.get('x-ce-qc-whpp-authority')||'missing'}`);

  const network=await json(`${origin}/api/v203/network-access`,{headers:{cookie,Accept:'application/json'}});
  if(network.res.status!==200||network.body.ok!==true)fail(`network/settings route failed: ${network.text}`);

  const exportNoAuth=await json(`${exportOrigin}/api/v194/export-period/prepare`,{
    method:'POST',headers:{Accept:'application/json','content-type':'application/json','origin':origin},
    body:JSON.stringify({periodType:'daily',date:'',businessType:'ALL'})
  });
  if(exportNoAuth.res.status!==401)fail(`5178 prepare must reject missing internal session before payload validation: ${exportNoAuth.res.status} ${exportNoAuth.text}`);

  const exportAuth=await json(`${exportOrigin}/api/v194/export-period/prepare`,{
    method:'POST',
    headers:{cookie,Accept:'application/json','content-type':'application/json','origin':origin},
    body:JSON.stringify({periodType:'daily',date:'',businessType:'ALL'})
  });
  if(exportAuth.res.status!==400||exportAuth.body.code!=='V194_INVALID_DATE')fail(`5178 did not accept the direct 5177 session cookie and reach ALL-export payload validation: ${exportAuth.res.status} ${exportAuth.text}`);

  console.log('CE_QC_QC11_GOLDEN_HEALTH=PASS');
  console.log('CE_QC_QC11_DIRECT_INTERNAL_BAD_PASSWORD=PASS');
  console.log('CE_QC_QC11_DIRECT_INTERNAL_LOGIN=PASS');
  console.log('CE_QC_QC11_SESSION_SETTINGS=PASS');
  console.log('CE_QC_QC11_CE_API_LOGIN_FEEDBACK=PASS');
  console.log('CE_QC_QC11_ATTEMPT_ROUTE=PASS');
  console.log('CE_QC_QC11_WHPP_V248_AUTHORITY=PASS');
  console.log('CE_QC_QC11_EXPORT_SIDECAR_ALL_CAPABILITY=PASS');
  console.log('CE_QC_QC11_EXPORT_SIDECAR_AUTH=PASS');
}finally{
  await stop();
  fs.rmSync(tmp,{recursive:true,force:true});
}
