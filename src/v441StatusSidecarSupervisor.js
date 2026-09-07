import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

export const V441_STATUS_SIDECAR_SUPERVISOR_ID='2026-09-07-v441-status-sidecar-supervisor-v1';
export const V442_WHPP_STATUS_PARITY_ID='2026-09-07-v442-whpp-finalized-daily-status-parity-v1';
const V441_COMPAT_ENTRY='./localStatusSidecar.js';
const PORT=Math.max(1024,Math.min(65535,Number(process.env.CE_QC_STATUS_SIDECAR_PORT||5180)));
const APP_PORT=Math.max(1024,Math.min(65535,Number(process.env.PORT||5177)));
const HOST=String(process.env.CE_QC_STATUS_SIDECAR_HOST||'0.0.0.0');
const CHILD=String(process.env.CE_QC_STATUS_SIDECAR_CHILD||'')==='1';
const text=value=>String(value??'').trim();
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const normalizeDate=value=>{const s=text(value).replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const elapsed=start=>Math.max(0,Number(process.hrtime.bigint()-start)/1e6);
const tick=()=>process.hrtime.bigint();

let child=null;
let stopping=false;
let restartTimer=null;

function eligible(){
  if(CHILD)return false;
  if(String(process.env.CE_QC_EXPORT_SIDECAR_CHILD||'')==='1')return false;
  if(String(process.env.CE_QC_LOCAL_AUTH_CHILD||'')==='1')return false;
  if(String(process.env.NODE_ENV||'').toLowerCase()==='test')return false;
  return true;
}

function startSupervisor(){
  if(!eligible()||stopping||child)return;
  const file=fileURLToPath(import.meta.url);
  try{
    child=spawn(process.execPath,[file],{
      cwd:process.cwd(),
      env:{...process.env,CE_QC_STATUS_SIDECAR_CHILD:'1',CE_QC_STATUS_SIDECAR_PORT:String(PORT)},
      windowsHide:true,detached:false,stdio:['ignore','inherit','inherit']
    });
    console.log(`[CE-QC][V442_STATUS_SUPERVISOR] starting pid=${child.pid||'-'} port=${PORT} parity=${V442_WHPP_STATUS_PARITY_ID}`);
    child.once('error',error=>console.error('[CE-QC][V442_STATUS_SUPERVISOR] spawn failed:',error?.stack||error));
    child.once('exit',(code,signal)=>{
      console.log(`[CE-QC][V442_STATUS_SUPERVISOR] exited code=${code??'null'}${signal?` signal=${signal}`:''}`);
      child=null;
      if(!stopping){clearTimeout(restartTimer);restartTimer=setTimeout(startSupervisor,1000);restartTimer.unref?.();}
    });
  }catch(error){child=null;console.error('[CE-QC][V442_STATUS_SUPERVISOR] start failed:',error?.stack||error);}
}

function stopSupervisor(){
  stopping=true;clearTimeout(restartTimer);
  try{child?.kill();}catch{}
  child=null;
}

function hostOnly(value=''){return String(value||'').trim().toLowerCase().replace(/^\[|\]$/g,'').split(':')[0];}
function ipOnly(value=''){return String(value||'').replace(/^::ffff:/,'');}
function privateV4(value=''){return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(String(value||''));}
function localChannel(req){
  const host=hostOnly(req.headers.host||'');
  const ip=ipOnly(req.socket?.remoteAddress||'');
  if(['127.0.0.1','localhost','::1'].includes(host)&&(ip==='127.0.0.1'||ip==='::1'))return 'LOCAL';
  if(net.isIP(host)===4&&privateV4(host)&&privateV4(ip))return 'LAN';
  return '';
}
function allowedOrigin(req){
  const raw=String(req.headers.origin||'').trim();
  if(!raw)return{ok:true,origin:''};
  try{
    const url=new URL(raw);
    const requestHost=hostOnly(req.headers.host||'');
    return{ok:url.hostname.toLowerCase()===requestHost&&Number(url.port||(url.protocol==='https:'?443:80))===APP_PORT,origin:raw};
  }catch{return{ok:false,origin:raw};}
}
function responseHeaders(req,extra={}){
  const allowed=allowedOrigin(req);
  const headers={
    'cache-control':'no-store',
    'x-ce-qc-local-status':'2026-09-07-v441-isolated-readonly-status-sidecar-v1',
    'x-ce-qc-whpp-status-parity':V442_WHPP_STATUS_PARITY_ID,
    'access-control-allow-headers':'Accept, Content-Type',
    'access-control-allow-methods':'GET,OPTIONS',
    ...extra
  };
  if(allowed.origin){headers['access-control-allow-origin']=allowed.origin;headers.vary='Origin';}
  return{allowed,headers};
}
function sendJson(req,res,status,payload,extra={}){
  const {allowed,headers}=responseHeaders(req,{'content-type':'application/json; charset=utf-8',...extra});
  if(!allowed.ok){res.writeHead(403,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});return res.end(JSON.stringify({ok:false,error:'Origin denied.'}));}
  res.writeHead(status,headers);res.end(JSON.stringify(payload));
}
function safeJson(value){try{return typeof value==='string'?JSON.parse(value||'{}'):(value||{});}catch{return{};}}
function atOrAfter(value,boundary){const limit=Date.parse(text(boundary));if(!Number.isFinite(limit))return true;const actual=Date.parse(text(value));return Number.isFinite(actual)&&actual>=limit;}

async function startChildServer(){
  const [{getRuntimeConfig},{readV322SevenBusinessStatus},{readV418BusinessSuccessCoverage}]=await Promise.all([
    import('./db.js'),
    import('./v322WebAvailabilityPatch.js'),
    import('./v418StatusProofFastPath.js')
  ]);
  let db=null;
  let dbFile='';
  let shuttingDown=false;
  const closeDb=()=>{if(db){try{db.close();}catch{}db=null;dbFile='';}};
  const getReadonlyDb=()=>{
    const file=getRuntimeConfig().dbFile;
    if(db&&dbFile===file)return db;
    closeDb();
    const opened=new DatabaseSync(file,{readOnly:true});
    opened.exec('PRAGMA query_only=ON');
    opened.exec('PRAGMA busy_timeout=700');
    opened.exec('PRAGMA temp_store=FILE');
    db=opened;dbFile=file;
    return db;
  };

  function currentWhppCompletionClaim(database,payload){
    const date=normalizeDate(payload?.reportDate),boundary=text(payload?.lifecycleBoundary);
    if(!date)return null;
    try{
      const explicit=database.prepare(`SELECT snapshotId,runId,generatedAt,createdAt,status,reconciliationStatus
        FROM business_export_snapshots
        WHERE businessType='WHPP' AND reportDate=?
          AND UPPER(COALESCE(status,''))='VALID'
          AND UPPER(COALESCE(reconciliationStatus,''))='COMPLETED'
        ORDER BY COALESCE(NULLIF(generatedAt,''),createdAt) DESC,id DESC LIMIT 1`).get(date)||null;
      if(explicit&&atOrAfter(explicit.generatedAt||explicit.createdAt,boundary))return{...explicit,claimSource:'WHPP_VALID_COMPLETED_SNAPSHOT'};
    }catch{}
    try{
      const daily=database.prepare("SELECT totalCount,summaryJson,updatedAt FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date)||null;
      if(!daily)return null;
      const summary=safeJson(daily.summaryJson),status=text(summary.snapshotStatus||summary.reconciliationStatus).toUpperCase(),snapshotId=text(summary.finalizedSnapshotId);
      if(summary.completed!==true||!['COMPLETED','COMPLETED_WITH_RETRY'].includes(status)||!snapshotId)return null;
      const legacy=database.prepare(`SELECT snapshotId,runId,generatedAt,createdAt,status,reconciliationStatus
        FROM business_export_snapshots
        WHERE businessType='WHPP' AND reportDate=? AND snapshotId=?
          AND UPPER(COALESCE(status,''))<>'INVALID'
          AND UPPER(COALESCE(reconciliationStatus,''))<>'FAILED'
        LIMIT 1`).get(date,snapshotId)||null;
      if(!legacy)return null;
      const lifecycleTime=legacy.generatedAt||legacy.createdAt||daily.updatedAt;
      if(!atOrAfter(lifecycleTime,boundary)&&!atOrAfter(daily.updatedAt,boundary))return null;
      return{...legacy,claimSource:'WHPP_COMPLETED_DAILY_FINALIZED_SNAPSHOT',dailyTotal:n(daily.totalCount)};
    }catch{return null;}
  }

  function applyWhppCompletionParity(database,payload){
    const whpp=payload?.stages?.WHPP;
    if(!whpp||whpp.complete===true||n(whpp.sourceTotal)===0||whpp.currentMembershipConsistent===false)return payload;
    const claim=currentWhppCompletionClaim(database,payload);
    if(!claim)return payload;
    const coverage=readV418BusinessSuccessCoverage(database,{
      businessType:'WHPP',
      date:payload.reportDate,
      snapshotId:payload.sourceSnapshotId,
      boundary:payload.lifecycleBoundary,
      memberTypes:['WHPP']
    });
    const expected=n(whpp.sourceTotal),covered=n(coverage?.count);
    if(!coverage?.ok||covered<expected)return{
      ...payload,
      stages:{...payload.stages,WHPP:{...whpp,completionProof:{covered,missing:Math.max(0,expected-covered),ok:Boolean(coverage?.ok),completionClaimSource:claim.claimSource}}},
      statusDiagnostics:{...(payload.statusDiagnostics||{}),v442WhppClaimSource:claim.claimSource,v442WhppCoverage:covered,v442WhppExpected:expected}
    };
    const completedWhpp={
      ...whpp,
      complete:true,
      snapshotId:text(claim.snapshotId),
      snapshotStatus:'COMPLETED',
      completionSource:'V418_CURRENT_MEMBER_PROCESSING_PROOF',
      completionClaimSource:claim.claimSource,
      runStatus:'completed',phase:'已完成',running:false,paused:false,failed:false,
      restartInterrupted:false,restartRecovery:null,
      statusSource:'V442_WHPP_FINALIZED_DAILY_STATUS_PARITY',
      completionProof:{covered,missing:0,ok:true,completionClaimSource:claim.claimSource}
    };
    const stages={...payload.stages,WHPP:completedWhpp};
    return{
      ...payload,
      stages,
      complete:['CCSL','SHOPEE','WHPP'].every(key=>stages?.[key]?.complete===true),
      v442WhppStatusParityId:V442_WHPP_STATUS_PARITY_ID,
      statusDiagnostics:{...(payload.statusDiagnostics||{}),v442WhppClaimSource:claim.claimSource,v442WhppCoverage:covered,v442WhppExpected:expected}
    };
  }

  function readProgress(database,businessType,reportDate){
    const all=applyWhppCompletionParity(database,readV322SevenBusinessStatus({reportDate,db:database,force:true}));
    all.isolatedStatusId='2026-09-07-v441-isolated-readonly-status-sidecar-v1';
    all.v442WhppStatusParityId=V442_WHPP_STATUS_PARITY_ID;
    const type=text(businessType).toUpperCase();
    if(type==='ALL')return all;
    const key=type==='SHOPEE'?'SHOPEE':type==='WHPP'?'WHPP':'CCSL',stage=all.stages?.[key]||{};
    return{...all,stages:undefined,counts:undefined,businessType:key,...stage,dailyTotal:n(stage.sourceTotal)};
  }

  const server=http.createServer((req,res)=>{
    const url=new URL(req.url||'/',`http://${req.headers.host||'127.0.0.1'}`);
    if(req.method==='OPTIONS'){
      const {allowed,headers}=responseHeaders(req);res.writeHead(allowed.ok?204:403,headers);return res.end();
    }
    if(req.method==='GET'&&url.pathname==='/api/local-status/health'){
      if(!localChannel(req))return sendJson(req,res,403,{ok:false,error:'Status sidecar is limited to local/LAN access.'});
      try{getReadonlyDb();return sendJson(req,res,200,{ok:true,id:'2026-09-07-v441-isolated-readonly-status-sidecar-v1',parityId:V442_WHPP_STATUS_PARITY_ID,dbReady:true,port:PORT,appPort:APP_PORT});}
      catch(error){return sendJson(req,res,503,{ok:false,id:'2026-09-07-v441-isolated-readonly-status-sidecar-v1',parityId:V442_WHPP_STATUS_PARITY_ID,dbReady:false,error:text(error?.message||error)});}
    }
    if(req.method!=='GET'||url.pathname!=='/api/local-status/run-progress')return sendJson(req,res,404,{ok:false,error:'Not found.'});
    if(!localChannel(req))return sendJson(req,res,403,{ok:false,error:'Status sidecar is limited to local/LAN access.'});
    const started=tick();
    try{
      const database=getReadonlyDb();
      const data=readProgress(database,url.searchParams.get('businessType')||'ALL',url.searchParams.get('reportDate')||'');
      const totalMs=Number(elapsed(started).toFixed(3)),d=data?.statusDiagnostics||{};
      return sendJson(req,res,200,data,{'server-timing':`v442total;dur=${totalMs},membership;dur=${n(d.membershipMs)},locks;dur=${n(d.locksMs)},ccsl;dur=${n(d.ccslMs)},shopee;dur=${n(d.shopeeMs)},whpp;dur=${n(d.whppMs)}`});
    }catch(error){
      closeDb();
      return sendJson(req,res,200,{ok:false,code:'V442_ISOLATED_STATUS_READ_FAILED',statusVersion:'2026-09-02-v414-one-read-seven-business-status-v1',isolatedStatusId:'2026-09-07-v441-isolated-readonly-status-sidecar-v1',v442WhppStatusParityId:V442_WHPP_STATUS_PARITY_ID,reportDate:normalizeDate(url.searchParams.get('reportDate')||''),error:text(error?.message||error),generatedAt:new Date().toISOString()});
    }
  });
  server.requestTimeout=12000;server.headersTimeout=13000;server.keepAliveTimeout=1000;
  server.on('error',error=>{console.error('[CE-QC][V442_STATUS_SIDECAR] START FAILED',error?.stack||error);process.exitCode=1;});
  const shutdown=()=>{
    if(shuttingDown)return;shuttingDown=true;closeDb();
    try{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),500).unref?.();}catch{process.exit(0);}
  };
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);process.once('exit',closeDb);
  server.listen(PORT,HOST,()=>console.log(`[CE-QC][V442_STATUS_SIDECAR] READY http://${HOST}:${PORT} · app=${APP_PORT} · readonly · ${V442_WHPP_STATUS_PARITY_ID}`));
}

if(CHILD){
  await startChildServer();
}else{
  process.once('exit',stopSupervisor);
  startSupervisor();
}

export function inspectV441StatusSupervisor(){return{eligible:eligible(),running:Boolean(child),pid:child?.pid||0,port:PORT,id:V441_STATUS_SIDECAR_SUPERVISOR_ID,parityId:V442_WHPP_STATUS_PARITY_ID,compatEntry:V441_COMPAT_ENTRY};}
