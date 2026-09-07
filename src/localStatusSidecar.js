import 'dotenv/config';
import http from 'node:http';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeConfig } from './db.js';
import {
  V418_STATUS_PROOF_FAST_PATH_ID,
  readV418CurrentMembershipCounts,
  readV418CcslProcessingProof,
  readV418BusinessSuccessCoverage
} from './v418StatusProofFastPath.js';

export const V441_LOCAL_STATUS_SIDECAR_ID='2026-09-07-v441-isolated-readonly-status-sidecar-v1';
export const V322_WEB_AVAILABILITY_ID='2026-09-02-v414-persisted-three-stage-status-v1';
export const V322_SEVEN_BUSINESS_STATUS_ID='2026-09-02-v414-one-read-seven-business-status-v1';
export const V322_WHPP_COMPLETION_PARITY_ID='2026-09-02-v414-whpp-success-evidence-parity-v1';
export const V322_COMPLETED_FAST_PATH_ID='2026-09-02-v322-unified-completed-snapshot-fast-path-v1';
export const V418_V322_LIGHTWEIGHT_COMPLETED_CLAIM_ID='2026-09-02-v418-v322-no-payload-completed-claim-v1';
export const V419_SCALAR_STATUS_PRIORITY_ID='2026-09-02-v419-scalar-status-priority-no-json-v1';
export const V419_STATUS_TIMING_ID='2026-09-02-v419-status-substage-timing-v1';
export const V424_SAME_LIFECYCLE_COMPLETION_FALLBACK_ID='2026-09-04-v424-same-lifecycle-completion-snapshot-v1';

const PORT=Math.max(1024,Math.min(65535,Number(process.env.CE_QC_STATUS_SIDECAR_PORT||5180)));
const APP_PORT=Math.max(1024,Math.min(65535,Number(process.env.PORT||5177)));
const HOST=String(process.env.CE_QC_STATUS_SIDECAR_HOST||'0.0.0.0');
const COMPLETE_LOCK=new Set(['finished','completed','done','success']);
const proofCache=new Map();
const INCOMPLETE_CACHE_MS=1200;
const COMPLETE_CACHE_MS=30000;
const text=v=>String(v??'').trim();
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const normalizeDate=v=>{const s=text(v).replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const elapsed=start=>Math.max(0,Number(process.hrtime.bigint()-start)/1e6);
const tick=()=>process.hrtime.bigint();
let db=null;
let dbFile='';
let standbyTimer=null;
let takeoverBusy=false;
let shuttingDown=false;

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
    'x-ce-qc-local-status':V441_LOCAL_STATUS_SIDECAR_ID,
    'access-control-allow-headers':'Accept, Content-Type',
    'access-control-allow-methods':'GET,OPTIONS',
    ...extra
  };
  if(allowed.origin){headers['access-control-allow-origin']=allowed.origin;headers.vary='Origin';}
  return{allowed,headers};
}
function json(req,res,status,payload,extra={}){
  const {allowed,headers}=responseHeaders(req,{'content-type':'application/json; charset=utf-8',...extra});
  if(!allowed.ok){res.writeHead(403,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});return res.end(JSON.stringify({ok:false,error:'Origin denied.'}));}
  res.writeHead(status,headers);res.end(JSON.stringify(payload));
}
function closeDb(){if(db){try{db.close();}catch{}db=null;dbFile='';}}
function getReadonlyDb(){
  const file=getRuntimeConfig().dbFile;
  if(db&&dbFile===file)return db;
  closeDb();
  const opened=new DatabaseSync(file,{readOnly:true});
  opened.exec('PRAGMA query_only=ON');
  opened.exec('PRAGMA busy_timeout=700');
  opened.exec('PRAGMA temp_store=FILE');
  db=opened;dbFile=file;
  return db;
}
function atOrAfter(value,boundary){const limit=Date.parse(text(boundary));if(!Number.isFinite(limit))return true;const actual=Date.parse(text(value));return Number.isFinite(actual)&&actual>=limit;}
function latestValid(database,reportDate=''){
  const date=normalizeDate(reportDate);
  try{return date
    ?database.prepare("SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC,rowid DESC LIMIT 1").get(date)||null
    :database.prepare("SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC,rowid DESC LIMIT 1").get()||null;
  }catch{return null;}
}
function currentLock(database,type,date,boundary=''){
  try{
    const row=type==='CCSL'
      ?database.prepare('SELECT runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedAt,updatedAt,completedAt FROM run_locks WHERE reportDate=? LIMIT 1').get(date)||null
      :database.prepare('SELECT runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedAt,updatedAt,completedAt FROM business_run_locks WHERE businessType=? AND reportDate=? LIMIT 1').get(type,date)||null;
    if(!row)return null;
    return atOrAfter(row.lockedAt||row.updatedAt,boundary)?row:null;
  }catch{return null;}
}
function currentCompletionSnapshot(database,type,date,runId,boundary=''){
  const id=text(runId);
  try{
    const exact=id
      ?(type==='CCSL'
        ?database.prepare("SELECT snapshotId,runId,generatedAt,status,reconciliationStatus FROM export_snapshots WHERE reportDate=? AND runId=? AND snapshotType='dashboard' AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED' ORDER BY id DESC LIMIT 1").get(date,id)||null
        :database.prepare("SELECT snapshotId,runId,generatedAt,status,reconciliationStatus FROM business_export_snapshots WHERE businessType='SHOPEE' AND reportDate=? AND runId=? AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED' ORDER BY id DESC LIMIT 1").get(date,id)||null)
      :null;
    if(exact&&atOrAfter(exact.generatedAt,boundary))return{...exact,claimSource:'CURRENT_RUN_ID'};
    const lifecycle=type==='CCSL'
      ?database.prepare("SELECT snapshotId,runId,generatedAt,status,reconciliationStatus FROM export_snapshots WHERE reportDate=? AND snapshotType='dashboard' AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED' ORDER BY generatedAt DESC,id DESC LIMIT 1").get(date)||null
      :database.prepare("SELECT snapshotId,runId,generatedAt,status,reconciliationStatus FROM business_export_snapshots WHERE businessType='SHOPEE' AND reportDate=? AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED' ORDER BY generatedAt DESC,id DESC LIMIT 1").get(date)||null;
    return lifecycle&&atOrAfter(lifecycle.generatedAt,boundary)?{...lifecycle,claimSource:'SAME_VALID_IMPORT_LIFECYCLE'}:null;
  }catch{return null;}
}
function unifiedCompletionClaim(database,batch){
  try{return text(database.prepare('SELECT status FROM unified_snapshots WHERE snapshotId=? AND reportDate=? LIMIT 1').get(text(batch?.snapshotId),normalizeDate(batch?.reportDate))?.status).toUpperCase()==='COMPLETED';}catch{return false;}
}
function emptyStage(type,date,total,boundary,lock=null){
  const status=text(lock?.status).toLowerCase();
  const interrupted=type==='WHPP'&&status==='failed'&&text(lock?.errorMessage).toUpperCase().includes('PROCESS_RESTART_INTERRUPTED');
  return{
    key:type,label:type==='SHOPEE'?'SHOPEE CN/VN':type==='WHPP'?'WHPP本土':'CCSL',reportDate:date,
    sourceTotal:Math.max(0,n(total)),sourceHeader:'V441_ISOLATED_CURRENT_MEMBERSHIP_SCALAR',sourceMembershipVerified:true,
    runId:text(lock?.runId),runStatus:interrupted?'restart_interrupted':status,phase:interrupted?'WHPP等待断点恢复':(text(lock?.currentStage)||(status==='running'?'处理中':'待处理')),
    batchIndex:n(lock?.batchIndex),totalBatches:n(lock?.totalBatches),lastMessage:interrupted?'PROCESS_RESTART_INTERRUPTED':text(lock?.errorMessage),
    running:status==='running',paused:status==='paused',failed:interrupted?false:status==='failed',
    scanDone:0,scanRetry:0,scanTotal:0,trackDone:0,trackRetry:0,trackTotal:0,done:0,retry:0,total:0,
    complete:false,zeroTicketDay:false,snapshotId:'',snapshotStatus:'PENDING',completionSource:'V415_CURRENT_MEMBER_PROCESSING_PROOF_REQUIRED',
    restartInterrupted:interrupted,restartRecovery:interrupted?{interrupted:true,reportDate:date,runId:text(lock?.runId),reason:'PROCESS_RESTART_INTERRUPTED',source:'business_run_locks'}:null,
    lifecycleBoundary:boundary,
    completionPolicy:type==='WHPP'?V322_WHPP_COMPLETION_PARITY_ID:undefined,
    statusSource:'V441_ISOLATED_READONLY_STATUS_SIDECAR',v419ScalarStatusId:V419_SCALAR_STATUS_PRIORITY_ID
  };
}
function completedStage(stage,snapshotId,completionClaimSource=''){
  return{...stage,complete:true,zeroTicketDay:n(stage.sourceTotal)===0,snapshotId:text(snapshotId),snapshotStatus:'COMPLETED',completionSource:'V418_CURRENT_MEMBER_PROCESSING_PROOF',completionClaimSource:text(completionClaimSource),runStatus:'completed',phase:'已完成',running:false,paused:false,failed:false,restartInterrupted:false,restartRecovery:null,statusSource:'V441_ISOLATED_READONLY_STATUS_SIDECAR',v419ScalarStatusId:V419_SCALAR_STATUS_PRIORITY_ID};
}
function buildScalarStatus(database,date,batch){
  const totalStarted=tick(),timing={id:V419_STATUS_TIMING_ID,sidecarId:V441_LOCAL_STATUS_SIDECAR_ID};
  const membershipStarted=tick();
  const counts=readV418CurrentMembershipCounts(database,batch||{});
  timing.membershipMs=Number(elapsed(membershipStarted).toFixed(3));
  const boundary=text(batch?.createdAt),snapshotId=text(batch?.snapshotId);

  const locksStarted=tick();
  const ccslLock=currentLock(database,'CCSL',date,boundary),shopeeLock=currentLock(database,'SHOPEE',date,boundary),whppLock=currentLock(database,'WHPP',date,boundary);
  timing.locksMs=Number(elapsed(locksStarted).toFixed(3));

  let CCSL=emptyStage('CCSL',date,counts.CCSL,boundary,ccslLock);
  let SHOPEE=emptyStage('SHOPEE',date,counts.SHOPEE,boundary,shopeeLock);
  let WHPP=emptyStage('WHPP',date,counts.WHPP,boundary,whppLock);

  const ccslStarted=tick();
  if(n(counts.CCSL)===0)CCSL=completedStage(CCSL,snapshotId,'ZERO_TICKET');
  else{
    const snapshot=currentCompletionSnapshot(database,'CCSL',date,text(ccslLock?.runId),boundary);
    if(snapshot){
      const proof=readV418CcslProcessingProof(database,{reportDate:date,snapshotId,boundary});
      if(proof?.ok&&proof.complete===true&&n(proof.source)===n(counts.CCSL)&&n(proof.covered)>=n(counts.CCSL))CCSL=completedStage(CCSL,text(snapshot.snapshotId),snapshot.claimSource);
      else CCSL={...CCSL,completionProof:{source:n(proof?.source),covered:n(proof?.covered),missing:n(proof?.missing),ok:Boolean(proof?.ok)}};
    }
  }
  timing.ccslMs=Number(elapsed(ccslStarted).toFixed(3));

  const shopeeStarted=tick();
  if(n(counts.SHOPEE)===0)SHOPEE=completedStage(SHOPEE,snapshotId,'ZERO_TICKET');
  else{
    const snapshot=currentCompletionSnapshot(database,'SHOPEE',date,text(shopeeLock?.runId),boundary);
    if(snapshot){
      const coverage=readV418BusinessSuccessCoverage(database,{businessType:'SHOPEE',date,snapshotId,boundary,memberTypes:['SHOPEECN','SHOPEEVN']});
      if(coverage?.ok&&n(coverage.count)>=n(counts.SHOPEE))SHOPEE=completedStage(SHOPEE,text(snapshot.snapshotId),snapshot.claimSource);
      else SHOPEE={...SHOPEE,completionProof:{covered:n(coverage?.count),missing:Math.max(0,n(counts.SHOPEE)-n(coverage?.count)),ok:Boolean(coverage?.ok)}};
    }
  }
  timing.shopeeMs=Number(elapsed(shopeeStarted).toFixed(3));

  const whppStarted=tick();
  const whppMembershipOk=counts._whppMembershipOk!==false;
  if(whppMembershipOk&&n(counts.WHPP)===0)WHPP=completedStage(WHPP,snapshotId,'ZERO_TICKET');
  else if(whppMembershipOk&&n(counts.WHPP)>0){
    const lockClaim=COMPLETE_LOCK.has(text(whppLock?.status).toLowerCase()),unifiedClaim=unifiedCompletionClaim(database,batch);
    if(lockClaim||unifiedClaim){
      const coverage=readV418BusinessSuccessCoverage(database,{businessType:'WHPP',date,snapshotId,boundary,memberTypes:['WHPP']});
      if(coverage?.ok&&n(coverage.count)>=n(counts.WHPP))WHPP=completedStage(WHPP,snapshotId,lockClaim?'CURRENT_FINISHED_RUN_LOCK':'UNIFIED_COMPLETED_SCALAR');
      else WHPP={...WHPP,completionProof:{covered:n(coverage?.count),missing:Math.max(0,n(counts.WHPP)-n(coverage?.count)),ok:Boolean(coverage?.ok),lockClaim,unifiedClaim}};
    }
  }
  WHPP={...WHPP,currentMembershipConsistent:whppMembershipOk,membershipReason:text(counts._whppMembershipReason),completionPolicy:V322_WHPP_COMPLETION_PARITY_ID};
  timing.whppMs=Number(elapsed(whppStarted).toFixed(3));
  timing.totalMs=Number(elapsed(totalStarted).toFixed(3));
  return{
    ok:true,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,whppCompletionPolicy:V322_WHPP_COMPLETION_PARITY_ID,
    completedFastPath:`${V322_COMPLETED_FAST_PATH_ID}+${V418_V322_LIGHTWEIGHT_COMPLETED_CLAIM_ID}+${V424_SAME_LIFECYCLE_COMPLETION_FALLBACK_ID}`,
    v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,v419ScalarStatusId:V419_SCALAR_STATUS_PRIORITY_ID,v424SameLifecycleCompletionId:V424_SAME_LIFECYCLE_COMPLETION_FALLBACK_ID,
    isolatedStatusId:V441_LOCAL_STATUS_SIDECAR_ID,reportDate:date,batchId:text(batch?.batchId),sourceSnapshotId:snapshotId,lifecycleBoundary:boundary,
    complete:[CCSL,SHOPEE,WHPP].every(stage=>stage.complete===true),stages:{CCSL,SHOPEE,WHPP},counts,statusDiagnostics:timing,generatedAt:new Date().toISOString()
  };
}
function readSevenBusinessStatus(database,reportDate=''){
  const requested=normalizeDate(reportDate),batch=latestValid(database,requested),date=requested||normalizeDate(batch?.reportDate);
  if(!date||!batch)return{ok:true,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,whppCompletionPolicy:V322_WHPP_COMPLETION_PARITY_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,v419ScalarStatusId:V419_SCALAR_STATUS_PRIORITY_ID,v424SameLifecycleCompletionId:V424_SAME_LIFECYCLE_COMPLETION_FALLBACK_ID,isolatedStatusId:V441_LOCAL_STATUS_SIDECAR_ID,reportDate:date||'',complete:false,stages:{CCSL:{key:'CCSL',complete:false},SHOPEE:{key:'SHOPEE',complete:false},WHPP:{key:'WHPP',complete:false,completionPolicy:V322_WHPP_COMPLETION_PARITY_ID}},statusDiagnostics:{id:V419_STATUS_TIMING_ID,totalMs:0,reason:'CURRENT_VALID_BATCH_MISSING',sidecarId:V441_LOCAL_STATUS_SIDECAR_ID},generatedAt:new Date().toISOString()};
  const cacheKey=`${date}:${text(batch.snapshotId)}`,cached=proofCache.get(cacheKey);
  if(cached&&Date.now()-cached.at<cached.ttl)return{...cached.value,cacheHit:true,statusDiagnostics:{...cached.value.statusDiagnostics,cacheHit:true,cacheAgeMs:Date.now()-cached.at}};
  const value=buildScalarStatus(database,date,batch),ttl=value.complete?COMPLETE_CACHE_MS:INCOMPLETE_CACHE_MS;
  proofCache.set(cacheKey,{value,at:Date.now(),ttl});
  if(proofCache.size>24){for(const [key,item] of proofCache){if(Date.now()-item.at>COMPLETE_CACHE_MS*2)proofCache.delete(key);}}
  return{...value,cacheHit:false};
}
function readRunProgress(database,businessType='ALL',reportDate=''){
  const type=text(businessType).toUpperCase(),all=readSevenBusinessStatus(database,reportDate);
  if(type==='ALL')return all;
  const key=type==='SHOPEE'?'SHOPEE':type==='WHPP'?'WHPP':'CCSL',stage=all.stages?.[key]||{};
  return{ok:true,version:all.version,statusVersion:all.statusVersion,whppCompletionPolicy:all.whppCompletionPolicy,v418FastPathId:all.v418FastPathId,v419ScalarStatusId:all.v419ScalarStatusId,v424SameLifecycleCompletionId:all.v424SameLifecycleCompletionId,isolatedStatusId:V441_LOCAL_STATUS_SIDECAR_ID,businessType:key,...stage,dailyTotal:n(stage.sourceTotal),statusDiagnostics:all.statusDiagnostics,generatedAt:all.generatedAt};
}

const server=http.createServer((req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'127.0.0.1'}`);
  if(req.method==='OPTIONS'){
    const {allowed,headers}=responseHeaders(req);res.writeHead(allowed.ok?204:403,headers);return res.end();
  }
  if(req.method==='GET'&&url.pathname==='/api/local-status/health'){
    if(!localChannel(req))return json(req,res,403,{ok:false,error:'Status sidecar is limited to local/LAN access.'});
    try{getReadonlyDb();return json(req,res,200,{ok:true,id:V441_LOCAL_STATUS_SIDECAR_ID,dbReady:true,port:PORT,appPort:APP_PORT});}
    catch(error){return json(req,res,503,{ok:false,id:V441_LOCAL_STATUS_SIDECAR_ID,dbReady:false,error:text(error?.message||error)});}
  }
  if(req.method!=='GET'||url.pathname!=='/api/local-status/run-progress')return json(req,res,404,{ok:false,error:'Not found.'});
  const channel=localChannel(req);
  if(!channel)return json(req,res,403,{ok:false,error:'Status sidecar is limited to local/LAN access.'});
  const started=tick();
  try{
    const database=getReadonlyDb();
    const data=readRunProgress(database,url.searchParams.get('businessType')||'ALL',url.searchParams.get('reportDate')||'');
    const totalMs=Number(elapsed(started).toFixed(3));
    const d=data?.statusDiagnostics||{};
    return json(req,res,200,data,{'server-timing':`v441total;dur=${totalMs},membership;dur=${n(d.membershipMs)},locks;dur=${n(d.locksMs)},ccsl;dur=${n(d.ccslMs)},shopee;dur=${n(d.shopeeMs)},whpp;dur=${n(d.whppMs)}`});
  }catch(error){
    closeDb();
    return json(req,res,200,{ok:false,code:'V441_ISOLATED_STATUS_READ_FAILED',statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,isolatedStatusId:V441_LOCAL_STATUS_SIDECAR_ID,reportDate:normalizeDate(url.searchParams.get('reportDate')||''),error:text(error?.message||error),generatedAt:new Date().toISOString()});
  }
});
server.requestTimeout=12000;
server.headersTimeout=13000;
server.keepAliveTimeout=1000;

function probeExistingOwner(timeoutMs=700){
  return new Promise(resolve=>{
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;resolve(Boolean(value));};
    const request=http.get({host:'127.0.0.1',port:PORT,path:'/api/local-status/health',headers:{Host:`127.0.0.1:${PORT}`,Accept:'application/json'}},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{
        try{const payload=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');finish(response.statusCode===200&&payload?.ok===true&&payload?.id===V441_LOCAL_STATUS_SIDECAR_ID);}catch{finish(false);}
      });
    });
    request.setTimeout(timeoutMs,()=>{request.destroy();finish(false);});
    request.on('error',()=>finish(false));
  });
}
function armStandby(){
  if(standbyTimer||shuttingDown)return;
  console.log(`[CE-QC][V441_STATUS_SIDECAR] port=${PORT} already has a healthy V441 owner; duplicate child is standby-only.`);
  standbyTimer=setInterval(async()=>{
    if(shuttingDown||takeoverBusy)return;
    takeoverBusy=true;
    try{
      if(await probeExistingOwner())return;
      clearInterval(standbyTimer);standbyTimer=null;
      console.warn(`[CE-QC][V441_STATUS_SIDECAR] active owner disappeared; standby attempting takeover on ${PORT}.`);
      tryListen();
    }finally{takeoverBusy=false;}
  },1500);
}
function tryListen(){
  if(shuttingDown)return;
  server.listen(PORT,HOST,()=>{
    if(standbyTimer){clearInterval(standbyTimer);standbyTimer=null;}
    console.log(`[CE-QC][V441_STATUS_SIDECAR] READY http://${HOST}:${PORT} · app=${APP_PORT} · readonly · ${V441_LOCAL_STATUS_SIDECAR_ID}`);
  });
}
server.on('error',error=>{
  void(async()=>{
    if(error?.code==='EADDRINUSE'&&await probeExistingOwner()){armStandby();return;}
    console.error('[CE-QC][V441_STATUS_SIDECAR] START FAILED',error?.stack||error);
    process.exitCode=1;
  })();
});
function shutdown(){
  if(shuttingDown)return;shuttingDown=true;
  if(standbyTimer){clearInterval(standbyTimer);standbyTimer=null;}
  closeDb();
  try{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),500).unref?.();}catch{process.exit(0);}
}
process.once('SIGTERM',shutdown);
process.once('SIGINT',shutdown);
process.once('exit',closeDb);
tryListen();
