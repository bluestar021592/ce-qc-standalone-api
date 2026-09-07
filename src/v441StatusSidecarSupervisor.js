import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

export const V441_STATUS_SIDECAR_SUPERVISOR_ID='2026-09-07-v441-status-sidecar-supervisor-v1';
export const V442_WHPP_STATUS_PARITY_ID='2026-09-07-v442-whpp-finalized-daily-status-parity-v1';
export const V443_WHPP_PRESERVED_FINALIZED_AUTHORITY_ID='2026-09-07-v443-whpp-preserved-finalized-daily-authority-v1';
export const V444_WHPP_EXACT_MEMBERSHIP_AUTHORITY_ID='2026-09-07-v444-whpp-exact-membership-finalized-status-v1';
export const V449_WHPP_ZERO_TICKET_STATUS_PARITY_ID='2026-09-07-v449-5180-zero-ticket-exact-unified-completion-v1';
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
const safeJson=value=>{try{return typeof value==='string'?JSON.parse(value||'{}'):(value||{});}catch{return{};}};
const bill=value=>text(typeof value==='string'?value:(value?.shipmentCode||value?.运单号||value?.waybill)).toUpperCase();
const billsOf=values=>[...new Set((values||[]).map(bill).filter(Boolean))].sort();
const sameBills=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);

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
    console.log(`[CE-QC][V449_STATUS_SUPERVISOR] starting pid=${child.pid||'-'} port=${PORT} zeroTicket=${V449_WHPP_ZERO_TICKET_STATUS_PARITY_ID} nonZero=${V444_WHPP_EXACT_MEMBERSHIP_AUTHORITY_ID}`);
    child.once('error',error=>console.error('[CE-QC][V449_STATUS_SUPERVISOR] spawn failed:',error?.stack||error));
    child.once('exit',(code,signal)=>{
      console.log(`[CE-QC][V449_STATUS_SUPERVISOR] exited code=${code??'null'}${signal?` signal=${signal}`:''}`);
      child=null;
      if(!stopping){clearTimeout(restartTimer);restartTimer=setTimeout(startSupervisor,1000);restartTimer.unref?.();}
    });
  }catch(error){child=null;console.error('[CE-QC][V449_STATUS_SUPERVISOR] start failed:',error?.stack||error);}
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
    'x-ce-qc-whpp-preserved-authority':V443_WHPP_PRESERVED_FINALIZED_AUTHORITY_ID,
    'x-ce-qc-whpp-exact-membership-authority':V444_WHPP_EXACT_MEMBERSHIP_AUTHORITY_ID,
    'x-ce-qc-whpp-zero-ticket-authority':V449_WHPP_ZERO_TICKET_STATUS_PARITY_ID,
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

function currentWhppMembership(database,date){
  let daily=null;
  try{daily=database.prepare("SELECT totalCount,summaryJson,updatedAt FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date)||null;}catch{return{ok:false,reason:'WHPP_DAILY_HEADER_READ_FAILED'};}
  if(!daily)return{ok:false,reason:'WHPP_DAILY_HEADER_MISSING'};
  const expected=Math.max(0,n(daily.totalCount));
  let dailyBills=[];
  try{dailyBills=billsOf(database.prepare("SELECT shipmentCode FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>'' ORDER BY UPPER(TRIM(shipmentCode))").all(date));}catch{return{ok:false,expected,reason:'WHPP_DAILY_MEMBERSHIP_READ_FAILED'};}
  if(dailyBills.length===expected)return{ok:true,expected,bills:dailyBills,source:'WHPP_STANDARD_DAILY',daily};
  if(dailyBills.length>0)return{ok:false,expected,actual:dailyBills.length,reason:'WHPP_STANDARD_DAILY_PARTIAL'};
  if(expected===0)return{ok:true,expected:0,bills:[],source:'WHPP_STANDARD_DAILY_ZERO',daily};

  try{
    const batch=database.prepare(`SELECT b.snapshotId
      FROM unified_import_batches b
      WHERE b.status='VALID' AND b.reportDate=?
        AND EXISTS(SELECT 1 FROM unified_import_rows u WHERE u.snapshotId=b.snapshotId AND u.reportDate=b.reportDate
          AND UPPER(TRIM(u.businessType))='WHPP' AND TRIM(COALESCE(u.shipmentCode,''))<>'')
      ORDER BY b.createdAt DESC,b.rowid DESC LIMIT 1`).get(date)||null;
    if(batch?.snapshotId){
      const unifiedBills=billsOf(database.prepare("SELECT shipmentCode FROM unified_import_rows WHERE snapshotId=? AND reportDate=? AND UPPER(TRIM(businessType))='WHPP' AND TRIM(COALESCE(shipmentCode,''))<>'' ORDER BY UPPER(TRIM(shipmentCode))").all(batch.snapshotId,date));
      if(unifiedBills.length===expected)return{ok:true,expected,bills:unifiedBills,source:'WHPP_LATEST_VALID_UNIFIED_DAILY',daily,unifiedSnapshotId:text(batch.snapshotId)};
      if(unifiedBills.length>0)return{ok:false,expected,actual:unifiedBills.length,reason:'WHPP_VALID_UNIFIED_MEMBERSHIP_MISMATCH'};
    }
  }catch{return{ok:false,expected,actual:0,reason:'WHPP_VALID_UNIFIED_MEMBERSHIP_READ_FAILED'};}
  return{ok:false,expected,actual:0,reason:'WHPP_CURRENT_MEMBERSHIP_UNRECOVERABLE'};
}

function snapshotMembership(row){
  const payload=safeJson(row?.payloadJson),state=payload?.state&&typeof payload.state==='object'?payload.state:{};
  const pnh=billsOf(state.pnhBills||[]);
  if(pnh.length)return pnh;
  return billsOf(state.dailyParseRows||[]);
}

export function readV444WhppFinalizedStatusAuthority(database,{reportDate=''}={}){
  const date=normalizeDate(reportDate);
  if(!database||!date)return null;
  const current=currentWhppMembership(database,date);
  if(!current.ok||current.expected<=0)return null;
  const summary=safeJson(current.daily?.summaryJson),summaryStatus=text(summary.snapshotStatus||summary.reconciliationStatus).toUpperCase();
  const attestedId=summary.completed===true&&['COMPLETED','COMPLETED_WITH_RETRY'].includes(summaryStatus)?text(summary.finalizedSnapshotId):'';
  let historyFinalized=false;
  try{historyFinalized=Boolean(database.prepare("SELECT 1 ok FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date)?.ok);}catch{}
  const candidates=[];
  try{
    if(attestedId){
      const row=database.prepare(`SELECT snapshotId,runId,generatedAt,createdAt,status,reconciliationStatus,payloadJson
        FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? AND snapshotId=?
          AND UPPER(COALESCE(status,''))<>'INVALID' AND UPPER(COALESCE(reconciliationStatus,''))<>'FAILED' LIMIT 1`).get(date,attestedId)||null;
      if(row)candidates.push(row);
    }
    const rows=database.prepare(`SELECT snapshotId,runId,generatedAt,createdAt,status,reconciliationStatus,payloadJson
      FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=?
        AND UPPER(COALESCE(status,''))<>'INVALID' AND UPPER(COALESCE(reconciliationStatus,''))<>'FAILED'
      ORDER BY COALESCE(NULLIF(generatedAt,''),createdAt) DESC,id DESC`).all(date);
    const seen=new Set(candidates.map(row=>text(row.snapshotId)));
    for(const row of rows){const id=text(row.snapshotId);if(id&&!seen.has(id)){seen.add(id);candidates.push(row);}}
  }catch{return null;}

  for(const row of candidates){
    const id=text(row.snapshotId),explicit=text(row.status).toUpperCase()==='VALID'&&text(row.reconciliationStatus).toUpperCase()==='COMPLETED';
    const attested=Boolean(attestedId&&id===attestedId);
    const legacyHistoryAttested=!explicit&&!attested&&historyFinalized;
    if(!explicit&&!attested&&!legacyHistoryAttested)continue;
    const snapshotBills=snapshotMembership(row);
    if(snapshotBills.length!==current.expected||!sameBills(snapshotBills,current.bills))continue;
    return{
      snapshotId:id,runId:text(row.runId),generatedAt:text(row.generatedAt),createdAt:text(row.createdAt),
      claimSource:attested?'WHPP_DAILY_FINALIZED_EXACT_MEMBERSHIP':(explicit?'WHPP_VALID_COMPLETED_EXACT_MEMBERSHIP_RECOVERY':'WHPP_LEGACY_FINALIZED_EXACT_MEMBERSHIP_HISTORY_RECOVERY'),
      exactMembership:true,dailySummaryAttested:attested,legacyHistoryAttested,expected:current.expected,currentCount:current.bills.length,
      snapshotCount:snapshotBills.length,currentMembershipSource:current.source,unifiedSnapshotId:text(current.unifiedSnapshotId),
      authorityId:V444_WHPP_EXACT_MEMBERSHIP_AUTHORITY_ID
    };
  }
  return null;
}

// V449 closes the exact gap seen in production: 5180 is the visible status owner,
// and V444 intentionally ignores expected=0 because it is a non-zero finalized
// membership authority. A zero-ticket WHPP day is allowed to complete here only
// when the exact selected/latest VALID unified snapshot is itself COMPLETED and
// contains zero WHPP members. No old date/snapshot can bleed across a new import.
export function readV449WhppZeroTicketStatusAuthority(database,{reportDate='',snapshotId=''}={}){
  const date=normalizeDate(reportDate),id=text(snapshotId);
  if(!database||!date||!id)return null;
  try{
    const latest=database.prepare("SELECT snapshotId FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC,rowid DESC LIMIT 1").get(date)||null;
    if(text(latest?.snapshotId)!==id)return null;
    const status=text(database.prepare('SELECT status FROM unified_snapshots WHERE snapshotId=? AND reportDate=? LIMIT 1').get(id,date)?.status).toUpperCase();
    if(status!=='COMPLETED')return null;
    const row=database.prepare("SELECT COUNT(DISTINCT UPPER(TRIM(shipmentCode))) count FROM unified_import_rows WHERE snapshotId=? AND reportDate=? AND UPPER(TRIM(businessType))='WHPP' AND TRIM(COALESCE(shipmentCode,''))<>''").get(id,date)||{};
    if(n(row.count)!==0)return null;
    return{snapshotId:id,reportDate:date,expected:0,claimSource:'UNIFIED_ZERO_TICKET_COMPLETED',authorityId:V449_WHPP_ZERO_TICKET_STATUS_PARITY_ID};
  }catch{return null;}
}

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

  function applyWhppCompletionParity(database,payload){
    const whpp=payload?.stages?.WHPP;
    if(!whpp||whpp.complete===true)return payload;

    const zeroClaim=readV449WhppZeroTicketStatusAuthority(database,{reportDate:payload?.reportDate,snapshotId:payload?.sourceSnapshotId});
    if(zeroClaim){
      const completedWhpp={
        ...whpp,
        sourceTotal:0,
        sourceHeader:'V449_EXACT_SELECTED_UNIFIED_ZERO_TICKET',
        sourceMembershipVerified:true,
        exactUnifiedZeroTicketVerified:true,
        complete:true,
        zeroTicketDay:true,
        snapshotId:text(zeroClaim.snapshotId),
        snapshotStatus:'COMPLETED',
        completionSource:'V449_EXACT_SELECTED_UNIFIED_ZERO_TICKET_AUTHORITY',
        completionClaimSource:zeroClaim.claimSource,
        runStatus:'completed',phase:'已完成',running:false,paused:false,failed:false,
        restartInterrupted:false,restartRecovery:null,
        statusSource:'V449_WHPP_ZERO_TICKET_EXACT_UNIFIED_STATUS'
      };
      const stages={...payload.stages,WHPP:completedWhpp};
      const counts={...(payload.counts||{}),WHPP:0};
      counts.TOTAL=n(counts.CCSL)+n(counts.SHOPEE);
      return{
        ...payload,
        stages,counts,
        complete:['CCSL','SHOPEE','WHPP'].every(key=>stages?.[key]?.complete===true),
        v449WhppZeroTicketStatusParityId:V449_WHPP_ZERO_TICKET_STATUS_PARITY_ID,
        statusDiagnostics:{...(payload.statusDiagnostics||{}),v449WhppZeroTicketClaimSource:zeroClaim.claimSource,v449WhppZeroTicketSnapshotId:zeroClaim.snapshotId}
      };
    }

    const claim=readV444WhppFinalizedStatusAuthority(database,{reportDate:payload?.reportDate});
    if(!claim)return payload;
    const coverage=readV418BusinessSuccessCoverage(database,{
      businessType:'WHPP',date:payload.reportDate,snapshotId:payload.sourceSnapshotId,boundary:'',memberTypes:['WHPP']
    });
    const expected=n(claim.expected),covered=n(coverage?.count);
    const completedWhpp={
      ...whpp,
      sourceTotal:expected,
      sourceHeader:'V444_EXACT_CURRENT_WHPP_MEMBERSHIP',
      sourceMembershipVerified:true,
      currentMembershipConsistent:true,
      membershipReason:claim.currentMembershipSource,
      complete:true,
      zeroTicketDay:false,
      snapshotId:text(claim.snapshotId),
      snapshotStatus:'COMPLETED',
      completionSource:'V444_EXACT_CURRENT_MEMBER_FINALIZED_AUTHORITY',
      completionClaimSource:claim.claimSource,
      runStatus:'completed',phase:'已完成',running:false,paused:false,failed:false,
      restartInterrupted:false,restartRecovery:null,
      statusSource:'V444_WHPP_EXACT_MEMBERSHIP_FINALIZED_STATUS',
      completionProof:{covered,missing:Math.max(0,expected-covered),coverageOk:Boolean(coverage?.ok),authorityOk:true,exactMembership:true,completionClaimSource:claim.claimSource}
    };
    const stages={...payload.stages,WHPP:completedWhpp};
    const counts={...(payload.counts||{}),WHPP:expected};
    counts.TOTAL=n(counts.CCSL)+n(counts.SHOPEE)+expected;
    return{
      ...payload,
      stages,counts,
      complete:['CCSL','SHOPEE','WHPP'].every(key=>stages?.[key]?.complete===true),
      v442WhppStatusParityId:V442_WHPP_STATUS_PARITY_ID,
      v443WhppPreservedAuthorityId:V443_WHPP_PRESERVED_FINALIZED_AUTHORITY_ID,
      v444WhppExactMembershipAuthorityId:V444_WHPP_EXACT_MEMBERSHIP_AUTHORITY_ID,
      v449WhppZeroTicketStatusParityId:V449_WHPP_ZERO_TICKET_STATUS_PARITY_ID,
      statusDiagnostics:{
        ...(payload.statusDiagnostics||{}),v444WhppClaimSource:claim.claimSource,v444WhppExpected:expected,
        v444WhppCurrentCount:n(claim.currentCount),v444WhppSnapshotCount:n(claim.snapshotCount),
        v444WhppCurrentMembershipSource:claim.currentMembershipSource,v444WhppDailySummaryAttested:Boolean(claim.dailySummaryAttested),
        v444WhppLegacyHistoryAttested:Boolean(claim.legacyHistoryAttested),v444WhppCoverage:covered
      }
    };
  }

  function readProgress(database,businessType,reportDate){
    const all=applyWhppCompletionParity(database,readV322SevenBusinessStatus({reportDate,db:database,force:true}));
    all.isolatedStatusId='2026-09-07-v441-isolated-readonly-status-sidecar-v1';
    all.v442WhppStatusParityId=V442_WHPP_STATUS_PARITY_ID;
    all.v443WhppPreservedAuthorityId=V443_WHPP_PRESERVED_FINALIZED_AUTHORITY_ID;
    all.v444WhppExactMembershipAuthorityId=V444_WHPP_EXACT_MEMBERSHIP_AUTHORITY_ID;
    all.v449WhppZeroTicketStatusParityId=V449_WHPP_ZERO_TICKET_STATUS_PARITY_ID;
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
      try{getReadonlyDb();return sendJson(req,res,200,{ok:true,id:'2026-09-07-v441-isolated-readonly-status-sidecar-v1',parityId:V442_WHPP_STATUS_PARITY_ID,preservedAuthorityId:V443_WHPP_PRESERVED_FINALIZED_AUTHORITY_ID,exactMembershipAuthorityId:V444_WHPP_EXACT_MEMBERSHIP_AUTHORITY_ID,zeroTicketAuthorityId:V449_WHPP_ZERO_TICKET_STATUS_PARITY_ID,dbReady:true,port:PORT,appPort:APP_PORT});}
      catch(error){return sendJson(req,res,503,{ok:false,id:'2026-09-07-v441-isolated-readonly-status-sidecar-v1',parityId:V442_WHPP_STATUS_PARITY_ID,preservedAuthorityId:V443_WHPP_PRESERVED_FINALIZED_AUTHORITY_ID,exactMembershipAuthorityId:V444_WHPP_EXACT_MEMBERSHIP_AUTHORITY_ID,zeroTicketAuthorityId:V449_WHPP_ZERO_TICKET_STATUS_PARITY_ID,dbReady:false,error:text(error?.message||error)});}
    }
    if(req.method!=='GET'||url.pathname!=='/api/local-status/run-progress')return sendJson(req,res,404,{ok:false,error:'Not found.'});
    if(!localChannel(req))return sendJson(req,res,403,{ok:false,error:'Status sidecar is limited to local/LAN access.'});
    const started=tick();
    try{
      const database=getReadonlyDb();
      const data=readProgress(database,url.searchParams.get('businessType')||'ALL',url.searchParams.get('reportDate')||'');
      const totalMs=Number(elapsed(started).toFixed(3)),d=data?.statusDiagnostics||{};
      return sendJson(req,res,200,data,{'server-timing':`v449total;dur=${totalMs},membership;dur=${n(d.membershipMs)},locks;dur=${n(d.locksMs)},ccsl;dur=${n(d.ccslMs)},shopee;dur=${n(d.shopeeMs)},whpp;dur=${n(d.whppMs)}`});
    }catch(error){
      closeDb();
      return sendJson(req,res,200,{ok:false,code:'V449_ISOLATED_STATUS_READ_FAILED',statusVersion:'2026-09-02-v414-one-read-seven-business-status-v1',isolatedStatusId:'2026-09-07-v441-isolated-readonly-status-sidecar-v1',v442WhppStatusParityId:V442_WHPP_STATUS_PARITY_ID,v443WhppPreservedAuthorityId:V443_WHPP_PRESERVED_FINALIZED_AUTHORITY_ID,v444WhppExactMembershipAuthorityId:V444_WHPP_EXACT_MEMBERSHIP_AUTHORITY_ID,v449WhppZeroTicketStatusParityId:V449_WHPP_ZERO_TICKET_STATUS_PARITY_ID,reportDate:normalizeDate(url.searchParams.get('reportDate')||''),error:text(error?.message||error),generatedAt:new Date().toISOString()});
    }
  });
  server.requestTimeout=12000;server.headersTimeout=13000;server.keepAliveTimeout=1000;
  server.on('error',error=>{console.error('[CE-QC][V449_STATUS_SIDECAR] START FAILED',error?.stack||error);process.exitCode=1;});
  const shutdown=()=>{
    if(shuttingDown)return;shuttingDown=true;closeDb();
    try{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),500).unref?.();}catch{process.exit(0);}
  };
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);process.once('exit',closeDb);
  server.listen(PORT,HOST,()=>console.log(`[CE-QC][V449_STATUS_SIDECAR] READY http://${HOST}:${PORT} · app=${APP_PORT} · readonly · zeroTicket=${V449_WHPP_ZERO_TICKET_STATUS_PARITY_ID} · nonZero=${V444_WHPP_EXACT_MEMBERSHIP_AUTHORITY_ID}`));
}

if(CHILD){
  await startChildServer();
}else{
  process.once('exit',stopSupervisor);
  startSupervisor();
}

export function inspectV441StatusSupervisor(){return{eligible:eligible(),running:Boolean(child),pid:child?.pid||0,port:PORT,id:V441_STATUS_SIDECAR_SUPERVISOR_ID,parityId:V442_WHPP_STATUS_PARITY_ID,preservedAuthorityId:V443_WHPP_PRESERVED_FINALIZED_AUTHORITY_ID,exactMembershipAuthorityId:V444_WHPP_EXACT_MEMBERSHIP_AUTHORITY_ID,zeroTicketAuthorityId:V449_WHPP_ZERO_TICKET_STATUS_PARITY_ID,compatEntry:V441_COMPAT_ENTRY};}
