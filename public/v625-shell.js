(()=>{
'use strict';

const page=document.body.dataset.page||'home';
const business=document.body.dataset.business||'';
const q=s=>document.querySelector(s);
const qa=s=>[...document.querySelectorAll(s)];
const byId=id=>document.getElementById(id);
const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const fmt=v=>v===null||v===undefined?'—':Number(v).toLocaleString('zh-CN');
const pct=v=>v===null||v===undefined?'—':Number(v).toFixed(2).replace(/\.00$/,'')+'%';
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const first=(obj,paths)=>{
  for(const path of paths){
    let cur=obj;
    for(const p of path.split('.'))cur=cur?.[p];
    if(cur!==undefined&&cur!==null&&cur!=='')return cur;
  }
  return null;
};
async function request(url,options={},timeout=12000){
  const controller=new AbortController();
  const bounded=Number(timeout)>0;
  const timer=bounded?setTimeout(()=>controller.abort(new Error('REQUEST_TIMEOUT_'+timeout)),timeout):null;
  try{
    const res=await fetch(url,{cache:'no-store',credentials:'same-origin',...options,signal:controller.signal});
    const type=String(res.headers.get('content-type')||'');
    const data=type.includes('application/json')?await res.json():{ok:res.ok,text:await res.text()};
    if(!res.ok||data?.ok===false){
      const e=new Error(data?.error||('HTTP '+res.status));e.payload=data;e.status=res.status;throw e;
    }
    return data;
  }catch(error){
    if(error?.name==='AbortError'||/^REQUEST_TIMEOUT_/.test(String(error?.message||error?.cause?.message||''))){
      const e=new Error('前端等待超时，但后台任务可能仍在继续；系统将以实时进度为准，不会把超时误报为业务失败。');
      e.code='CLIENT_WAIT_TIMEOUT';e.cause=error;throw e;
    }
    if(/Failed to fetch|NetworkError|Load failed|network request failed/i.test(String(error?.message||error))){
      const e=new Error('与本地后台的连接短暂中断，系统正在自动恢复连接并核对任务进度。');
      e.code='CLIENT_TRANSPORT_ERROR';e.cause=error;throw e;
    }
    throw error;
  }finally{if(timer)clearTimeout(timer);}
}
const json=(url,timeout=12000)=>request(url,{},timeout);
const post=(url,body={},timeout=120000)=>request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},timeout);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const isTransportLoss=error=>['CLIENT_TRANSPORT_ERROR','CLIENT_WAIT_TIMEOUT'].includes(String(error?.code||''))||/Failed to fetch|NetworkError|Load failed|network request failed/i.test(String(error?.message||error||''));
async function waitBackendReady(timeoutMs=120000){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    try{
      const res=await fetch('/api/session?reconnect='+Date.now(),{cache:'no-store',credentials:'same-origin'});
      if(res.ok)return true;
    }catch{}
    await sleep(1500);
  }
  throw new Error('本地后台连接在2分钟内没有恢复，请保持启动器窗口开启。');
}
async function readFamilyProgress(type,reportDate){
  const qs='?businessType='+encodeURIComponent(type)+(reportDate?'&reportDate='+encodeURIComponent(reportDate):'');
  return json('/api/v33/run-progress'+qs,15000);
}
function familyResumeEndpoint(type){return type==='SHOPEE'?'/api/shopee/run/resume':'/api/resume'}
async function recoverFamilyTransport(type,reportDate,retryEndpoint){
  const label=type==='SHOPEE'?'SHOPEE':'CCSL';
  appendLiveLog(label+'连接短暂中断，正在等待本地后台恢复并核对已保存进度…');
  await waitBackendReady();
  let resubmitted=false;
  const started=Date.now();
  while(Date.now()-started<900000){
    let progress=null;
    try{progress=await readFamilyProgress(type,reportDate)}catch(error){
      if(isTransportLoss(error)){await sleep(1500);continue}
      throw error;
    }
    if(familyComplete(progress)){
      appendLiveLog(label+'后台任务已确认完成，继续下一业务。');
      void refreshLiveProgress();
      return {ok:true,recoveredTransport:true,progress};
    }
    if(progress?.running){
      await sleep(1800);
      continue;
    }
    if(!resubmitted){
      resubmitted=true;
      appendLiveLog(label+'后台已恢复但任务未运行，自动从已保存断点继续一次。');
      try{
        await post(retryEndpoint||familyResumeEndpoint(type),{},0);
        void refreshLiveProgress();
        return {ok:true,recoveredTransport:true,resubmitted:true};
      }catch(error){
        const code=String(error?.payload?.code||'');
        if(error?.status===409&&['RUN_ALREADY_COMPLETED','RUN_NOT_RECOVERABLE'].includes(code)){
          const current=await readFamilyProgress(type,reportDate).catch(()=>null);
          if(current&&familyComplete(current))return {ok:true,recoveredTransport:true,progress:current};
        }
        if(isTransportLoss(error)){await waitBackendReady();continue}
        throw error;
      }
    }
    const status=String(progress?.runStatus||progress?.phase||'').toLowerCase();
    if(/failed|失败/.test(status))throw new Error(progress?.lastMessage||label+'后台任务失败，请查看启动日志。');
    await sleep(1800);
  }
  throw new Error(label+'连接恢复后等待任务完成超时，请查看启动日志。');
}
async function runFamilyRequest(type,endpoint,reportDate){
  v752LaunchingFamily=type;
  void refreshLiveProgress();
  try{return await post(endpoint,{reportDate},0)}
  catch(error){
    if(!isTransportLoss(error))throw error;
    return recoverFamilyTransport(type,reportDate,endpoint);
  }finally{
    if(v752LaunchingFamily===type)v752LaunchingFamily='';
    void refreshLiveProgress();
  }
}
function importedFamilyCounts(reportDate=''){
  return aggregateV755FamilyCounts(v755ImportCountTruth.get(String(reportDate||v626LatestImport?.reportDate||'').slice(0,10)));
}
async function waitFamilyTerminal(type,reportDate,timeoutMs=1800000){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    const progress=await readFamilyProgress(type,reportDate);
    if(familyComplete(progress))return progress;
    const status=String(progress?.runStatus||progress?.phase||'').toLowerCase();
    if(/failed|失败/.test(status))throw new Error(progress?.lastMessage||type+'后台任务失败');
    await sleep(1800);
  }
  throw new Error(type+'处理等待超时');
}
async function autoStartFamily(type,endpoint,reportDate,total){
  const label=type==='SHOPEE'?'SHOPEE CN/VN':'CCSL';
  if(Number(total||0)<=0){appendLiveLog(label+' 当日日报0票，自动跳过');return{ok:true,skipped:true,reason:'ZERO_TICKET'}}
  const existing=await readFamilyProgress(type,reportDate).catch(()=>null);
  if(existing&&familyComplete(existing)){appendLiveLog(label+' 已完成，自动跳过重复处理');return{ok:true,skipped:true,reason:'ALREADY_COMPLETED'}}
  if(existing?.running){
    appendLiveLog(label+' 已在后台处理中，继续等待现有任务');
    await waitFamilyTerminal(type,reportDate);
    return{ok:true,waited:true};
  }
  try{return await runFamilyRequest(type,endpoint,reportDate)}
  catch(error){
    const code=String(error?.payload?.code||'');
    if(error?.status===409&&code==='RUN_ALREADY_COMPLETED'){
      appendLiveLog(label+' 已完成，自动跳过重复处理');
      return{ok:true,skipped:true,reason:code};
    }
    if(error?.status===409&&code==='RUN_ALREADY_ACTIVE'){
      appendLiveLog(label+' 已在后台处理中，继续等待现有任务');
      await waitFamilyTerminal(type,reportDate);
      return{ok:true,waited:true};
    }
    throw error;
  }
}
const setText=(id,val)=>{const el=byId(id);if(el)el.textContent=val===undefined||val===null||val===''?'—':String(val)};
const showOnly=id=>qa('.v625-page').forEach(el=>el.hidden=el.id!==id);
const today=()=>new Date().toISOString().slice(0,10);
const dateTime=val=>{if(!val)return'—';const d=new Date(val);return Number.isNaN(d.getTime())?String(val):d.toLocaleString('zh-CN',{hour12:false})};
const currentParams=()=>new URLSearchParams(location.search);
const selectedReportDate=()=>{
  const p=currentParams();
  return p.get('reportDate')||p.get('toDate')||p.get('fromDate')||'';
};
function applyDashboardDate(date){
  const value=String(date||'').slice(0,10);
  if(!value)return;
  if(byId('v625FromDate'))byId('v625FromDate').value=value;
  if(byId('v625ToDate'))byId('v625ToDate').value=value;
}

qa('.v625-nav a[data-key]').forEach(a=>a.classList.toggle('active',a.dataset.key===page));
if(page==='home')showOnly('v625Home');
else if(business)showOnly('v625Business');
else if(page==='import')showOnly('v625Import');
else if(page==='tracking')showOnly('v625Tracking');
else if(page==='exceptions')showOnly('v625Exceptions');
else if(page==='reports')showOnly('v625Reports');
else if(page==='settings')showOnly('v625Settings');
else if(page==='logs')showOnly('v625Logs');
else if(page==='data-management')showOnly('v625DataManagement');
else if(page==='users')showOnly('v625Users');
else if(page==='roles')showOnly('v625Roles');
else if(page==='profile')showOnly('v625Profile');
else if(page==='not-found')showOnly('v625404');
else showOnly('v625404');

if(!business&& !['home'].includes(page))q('[data-dashboard-actions]')?.setAttribute('hidden','');
function dashboardContextUrl(rawTarget,reportDate='',snapshotId=''){
  const target=new URL(rawTarget,location.origin);
  target.searchParams.set('auth','v625');
  const date=String(reportDate||selectedReportDate()||v626LatestImport?.reportDate||'').slice(0,10);
  const snapshot=String(snapshotId||currentParams().get('snapshotId')||v626LatestImport?.snapshotId||'');
  if(date)target.searchParams.set('reportDate',date);
  if(snapshot)target.searchParams.set('snapshotId',snapshot);
  return target.pathname+'?'+target.searchParams.toString();
}
function syncDashboardNavigationContext(reportDate='',snapshotId=''){
  const date=String(reportDate||selectedReportDate()||v626LatestImport?.reportDate||'').slice(0,10);
  const snapshot=String(snapshotId||currentParams().get('snapshotId')||v626LatestImport?.snapshotId||'');
  const businessKeys=new Set(['ce','ceaf','tbkh','ali1688','whpp','shopeecn','shopeevn']);
  qa('.v625-nav a[data-key]').forEach(a=>{
    if(!businessKeys.has(a.dataset.key)&&a.dataset.key!=='exceptions')return;
    a.href=dashboardContextUrl(a.getAttribute('href')||'/',date,snapshot);
  });
}
const boardJump=byId('v625BoardJump');if(boardJump)boardJump.addEventListener('change',()=>location.href=dashboardContextUrl(boardJump.value));
const initialDashboardDate=selectedReportDate()||today();
byId('v625FromDate')&&(byId('v625FromDate').value=initialDashboardDate);
byId('v625ToDate')&&(byId('v625ToDate').value=initialDashboardDate);

function metricState(state={}){
  const total=num(first(state,['total','today','dashboard.metrics.total','dashboard.totalMonitored','dashboard.pnh','dailyParseSummary.totalRecognized']))??0;
  const pod=num(first(state,['pod','dashboard.metrics.pod','dashboard.todayPod','dashboard.metrics.todayPod']))??0;
  const pending=num(first(state,['dashboard.metrics.pendingNonContinuous','dashboard.metrics.pending1','dashboard.categories.pendingTotal','pending']))??0;
  const oc=num(first(state,['dashboard.metrics.ocCurrent','dashboard.metrics.oc1','dashboard.categories.ocTotal','oc']))??0;
  const unresolved=num(first(state,['dashboard.metrics.unresolved','dashboard.abnormalCount','unresolved']))??Math.max(0,total-pod);
  const returned=num(first(state,['dashboard.metrics.returned','returned']))??0;
  const returning=num(first(state,['dashboard.metrics.returnInProgress','dashboard.metrics.returning','returnInProgress','returning']))??0;
  const cancelled=num(first(state,['dashboard.metrics.cancelled','cancelled']))??0;
  const explicitDelivery=num(first(state,['dashboard.metrics.delivery','dashboard.metrics.deliveryStay','dashboard.categories.deliveryTotal']));
  const normalDiversion=num(first(state,['dashboard.metrics.normalDiversion']))??0;
  const shopTotal=num(first(state,['dashboard.metrics.shopTotal']))??0;
  const otherNormal=Math.max(0,cancelled+normalDiversion+shopTotal);
  // A missing authoritative delivery count must not classify TMS 80 returns
  // or normal diversions as parcels still out for delivery.
  const delivery=explicitDelivery??Math.max(0,total-pod-returned-returning-otherNormal);
  const avgDays=num(first(state,['dashboard.metrics.avgPodDays','avgPodDays','dashboard.avgPodDays']));
  return{total,pod,podRate:total?pod/total*100:0,pending,oc,unresolved,returned,returning,cancelled,delivery,normalDiversion,shopTotal,otherNormal,avgDays};
}

function renderTrend(rootId,points=[]){
  const root=byId(rootId);if(!root)return;
  const clean=points.slice(-7);
  if(!clean.length){root.innerHTML='<div class="v625-empty-state">暂无趋势数据</div>';return}
  const w=700,h=190,pad=18;
  const max=Math.max(1,...clean.map(x=>Number(x.value||0)));
  const step=(w-pad*2)/Math.max(1,clean.length-1);
  const coords=clean.map((x,i)=>({x:pad+i*step,y:h-28-(Number(x.value||0)/max)*(h-55),label:String(x.label||''),value:Number(x.value||0)}));
  const line=coords.map((p,i)=>(i?'L':'M')+p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' ');
  const circles=coords.map(p=>'<circle cx="'+p.x+'" cy="'+p.y+'" r="3.8"><title>'+esc(p.value)+'</title></circle>').join('');
  const labels=coords.map(p=>'<text class="axis-label" x="'+p.x+'" y="'+(h-6)+'" text-anchor="middle">'+esc(p.label.slice(5))+'</text>').join('');
  root.innerHTML='<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none"><defs><linearGradient id="v625TrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1677f2"/><stop offset="1" stop-color="#1677f2" stop-opacity="0"/></linearGradient></defs><path class="trend-area" d="'+line+' L'+coords.at(-1).x+' '+(h-28)+' L'+coords[0].x+' '+(h-28)+' Z"></path><path class="trend-line" d="'+line+'"></path>'+circles+labels+'</svg>';
}
function renderMiniTrend(rootId,points=[],tone='#1677f2'){
  const root=byId(rootId);if(!root)return;
  const clean=(points||[]).filter(x=>x&&x.avgDays!==null&&x.avgDays!==undefined).slice(-7);
  if(!clean.length){root.innerHTML='<div class="v625-empty-state" style="padding:28px 6px;font-size:10px">暂无签收趋势</div>';return}
  const w=300,h=86,padX=18,padTop=18,padBottom=17;
  const values=clean.map(x=>Number(x.avgDays||0));
  const min=Math.min(...values),max=Math.max(...values),span=Math.max(.5,max-min);
  const step=(w-padX*2)/Math.max(1,clean.length-1);
  const coords=clean.map((item,i)=>({
    x:padX+i*step,
    y:padTop+(max-Number(item.avgDays||0))/span*(h-padTop-padBottom-10),
    value:Number(item.avgDays||0),
    label:String(item.reportDate||'').slice(5)
  }));
  const line=coords.map((p,i)=>(i?'L':'M')+p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' ');
  const dots=coords.map(p=>'<circle class="mini-dot" cx="'+p.x+'" cy="'+p.y+'" r="3" style="fill:'+tone+'"></circle>').join('');
  const valuesText=coords.map(p=>'<text class="mini-value" x="'+p.x+'" y="'+Math.max(9,p.y-7)+'" text-anchor="middle">'+p.value.toFixed(1)+'</text>').join('');
  const labels=coords.map(p=>'<text class="mini-label" x="'+p.x+'" y="'+(h-3)+'" text-anchor="middle">'+esc(p.label)+'</text>').join('');
  root.innerHTML='<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none"><path class="mini-line" style="stroke:'+tone+'" d="'+line+'"></path>'+dots+valuesText+labels+'</svg>';
}

function renderDonut(m){
  // Keep mutually exclusive status slices; dashboard overlays (OC/Pending gaps)
  // must never be added as extra parcels on top of the same shipment.
  const total=Math.max(0,Number(m.total)||0);
  const count=value=>Math.max(0,Math.trunc(Number(value)||0));
  const returnCapable=['WHPP','SHOPEECN','SHOPEEVN'].includes(business);
  const parts=[
    ['派送中',count(m.delivery),'#1677f2'],
    ['已签收',count(m.pod),'#20b979'],
    ...(returnCapable?[
      ['已退回',count(m.returned),'#e98945'],
      ['退回中',count(m.returning),'#d97706']
    ]:[]),
    ['Pending',count(m.pending),'#f5a623'],
    ['异常',count(m.abnormal),'#ef4b50'],
    ['其他正常状态',count(m.otherNormal),'#8c9bab'],
    ['待核验',count(m.unprocessed),'#c5cfdb']
  ];
  const accounted=parts.reduce((sum,item)=>sum+item[1],0);
  const donut=byId('v625BusinessDonut');
  const legend=byId('v625BusinessLegend');
  if(accounted>total){
    if(donut)donut.style.background='var(--v625-border,#dce5ef)';
    if(legend)legend.textContent='状态分类存在重叠：已分类 '+fmt(accounted)+' / 总票 '+fmt(total)+'，等待核验';
    return;
  }
  if(total===0){
    if(donut)donut.style.background='var(--v625-border,#dce5ef)';
    if(legend)legend.textContent='暂无数据（所选日期和业务无有效日报成员）';
    return;
  }
  if(accounted<total)parts.find(part=>part[0]==='待核验')[1]+=total-accounted;
  const denominator=Math.max(1,total);
  let at=0;const stops=[];
  for(const[,value,color]of parts){
    const next=at+(value/denominator*100);
    if(value>0)stops.push(color+' '+at+'% '+next+'%');
    at=next;
  }
  if(donut)donut.style.background=stops.length?'conic-gradient('+stops.join(',')+')':'var(--v625-border,#dce5ef)';
  if(legend)legend.innerHTML=parts.filter(([,value])=>value>0).map(([name,value,color])=>'<div><i style="background:'+color+'"></i><span>'+esc(name)+' '+fmt(value)+'（'+pct(value/denominator*100)+'）</span></div>').join('');
}
async function loadSession(){
  try{
    const r=await json('/api/session',7000);const u=r.user||{};
    setText('v625UserName',u.displayName||u.username||'管理员');setText('v625UserRole',u.role||'VIEWER');setText('v625NotifyDot',r.unreadNotifications||0);
    setText('v625SettingsUser',u.displayName||u.username||'当前用户');setText('v625SettingsRole',u.role||'—');setText('v625SettingsEmail',u.email||u.username||'—');
    const display=u.displayName||u.username||'当前用户';
    setText('v625ProfileName',display);setText('v625ProfileEmail',u.email||u.username||'—');
    setText('v625ProfileRole',u.role||'—');setText('v625ProfileDisplayName',display);
    setText('v625ProfileLogin',u.username||u.email||'—');setText('v625ProfileRoleInfo',u.role||'—');
    setText('v625ProfileScope',u.businessScope||'ALL');
  }catch{}
}

let v626LatestImport=null;
// V788: only an explicit empty-date home-summary result can suppress stale
// progress warnings. Never infer absence from zero visible cards alone.
const v788EmptySelectedDates=new Set();
let settingsUsers=[];
// V762: the exact saved run-lock and 1:1 scan/final ledgers are the durable
// CCSL/SHOPEE completion owners, even if the 7-second light progress request
// returns stale/empty during local SQLite load.
// V765: small, bounded browser-session cache of *verified* completed run
// projections. Keyed by exact date + snapshot, never used for business actions.
const V765_PROOF_CACHE_PREFIX='CE_QC_V765_VERIFIED_';
const V765_PROOF_MAX_AGE_MS=10*60*1000;
function v765ProofCacheKey(date,snapshot){return V765_PROOF_CACHE_PREFIX+date+'|'+snapshot}
function v765RememberVerifiedFamilies(date,snapshot,proofs){
  if(!proofs?.CCSL||!proofs?.SHOPEE)return;
  try{sessionStorage.setItem(v765ProofCacheKey(date,snapshot),
    JSON.stringify({date,snapshot,verifiedAt:Date.now(),proofs}))}catch{}
}
function v765RestoreVerifiedFamilies(date,snapshot){
  try{
    const raw=sessionStorage.getItem(v765ProofCacheKey(date,snapshot));
    if(!raw)return null;
    const entry=JSON.parse(raw);
    const valid=entry?.date===date&&entry?.snapshot===snapshot
      &&Date.now()-Number(entry.verifiedAt||0)>=0
      &&Date.now()-Number(entry.verifiedAt||0)<V765_PROOF_MAX_AGE_MS
      &&['CCSL','SHOPEE'].every(type=>{
        const p=entry.proofs?.[type];
        return p?.reportDate===date&&p?.snapshotId===snapshot
          &&Number(p.sourceCount)>0&&Number(p.scanCount)===Number(p.sourceCount)
          &&Number(p.finalCount)===Number(p.sourceCount)
          &&['finished','completed'].includes(String(p.runStatus||''));
      });
    if(valid)return entry.proofs;
    sessionStorage.removeItem(v765ProofCacheKey(date,snapshot));
  }catch{}
  return null;
}
function v765InvalidateAllProofCache(){
  try{for(let i=sessionStorage.length-1;i>=0;i--){
    const key=sessionStorage.key(i);
    if(key?.startsWith(V765_PROOF_CACHE_PREFIX))sessionStorage.removeItem(key)
  }}catch{}
  try{for(let i=sessionStorage.length-1;i>=0;i--){
    const key=sessionStorage.key(i);
    if(key?.startsWith('CE_QC_V765_TRACK_'))sessionStorage.removeItem(key)
  }}catch{}
  v762FamilyTerminalProofs.clear();v762FamilyProofNextRead.clear();
}
const v762FamilyTerminalProofs=new Map();
const v762FamilyProofInflight=new Map();
const v762FamilyProofNextRead=new Map();
function v762RememberFamilyCompletionProof(proof,reportDate='',snapshotId=''){
  const date=String(reportDate||'').slice(0,10);
  const snapshot=String(snapshotId||'');
  if(!date||!snapshot||date!==String(proof?.reportDate||'').slice(0,10)
      ||snapshot!==String(proof?.snapshotId||''))return null;
  const accepted={};
  for(const name of ['CCSL','SHOPEE']){
    const record=proof?.businesses?.[name]||{};
    const total=Number(record.sourceCount||0),scan=Number(record.scanCount||0),final=Number(record.finalCount||0);
    const savedStatus=String(record.runStatus||'').trim().toLowerCase();
    // The run lock is already queried for this exact historical date; the active
    // application date may have moved since that old completed batch.
    if(record.action!=='DONE'||!['finished','completed'].includes(savedStatus)
       ||record.exactMemberVerified!==true||total<=0||scan!==total||final!==total)continue;
    accepted[name]={reportDate:date,snapshotId:snapshot,sourceCount:total,scanCount:scan,finalCount:final,
      runId:String(record.runId),runStatus:savedStatus};
  }
  if(!Object.keys(accepted).length)return null;
  const key=date+'|'+snapshot;
  const merged={...(v762FamilyTerminalProofs.get(key)||{}),...accepted};
  v762FamilyTerminalProofs.set(key,merged);
  v765RememberVerifiedFamilies(date,snapshot,merged);
  return accepted;
}
function v762VerifiedFamilyTruth(reportDate=''){
  const date=String(reportDate||'').slice(0,10);
  if(date!==String(v626LatestImport?.reportDate||'').slice(0,10))return null;
  const snapshotId=String(v626LatestImport?.snapshotId||'');
  if(!snapshotId)return null;
  const key=date+'|'+snapshotId;
  if(v762FamilyTerminalProofs.has(key))return v762FamilyTerminalProofs.get(key);
  const restored=v765RestoreVerifiedFamilies(date,snapshotId);
  if(restored)v762FamilyTerminalProofs.set(key,restored);
  return restored;
}
async function v762LoadFamilyTerminalTruth(reportDate=''){
  const date=String(reportDate||'').slice(0,10);
  const snapshot=String(v626LatestImport?.snapshotId||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!snapshot
     ||date!==String(v626LatestImport?.reportDate||'').slice(0,10))return null;
  const verified=v762VerifiedFamilyTruth(date);
  if(verified?.CCSL&&verified?.SHOPEE)return verified;
  const key=date+'|'+snapshot;
  if(v762FamilyProofInflight.has(key))return v762FamilyProofInflight.get(key);
  if(Date.now()<Number(v762FamilyProofNextRead.get(key)||0))return verified;
  v762FamilyProofNextRead.set(key,Date.now()+12000);
  const promise=(async()=>{
    try{
      const response=await json('/api/family-recovery-proof?reportDate='+encodeURIComponent(date)+'&snapshotId='+encodeURIComponent(snapshot),45000);
      const saved=v762RememberFamilyCompletionProof(response,date,snapshot);
      // V764: the slow historical 1:1 proof returns independently of the
      // light progress requests. Publish it exactly once on receipt, without
      // restarting scanning or issuing another proof request.
      if(saved&&date===String(v626LatestImport?.reportDate||'').slice(0,10)
         &&snapshot===String(v626LatestImport?.snapshotId||'')){
        void refreshLiveProgress();
      }
      return saved? v762FamilyTerminalProofs.get(key):null;
    }catch(error){
      console.warn('[CE-QC][V762] stored completion proof unavailable',date,error?.code||error?.message||error);
      return null;
    }finally{v762FamilyProofInflight.delete(key)}
  })();
  v762FamilyProofInflight.set(key,promise);
  return promise;
}
function v762ProjectSavedCompletion(existing,proof,date){
  if(!proof||proof.reportDate!==date)return existing;
  return {...existing,reportDate:date,runId:proof.runId,running:false,active:false,paused:false,
    complete:true,runStatus:'finished',outcome:'COMPLETED',phase:'完成',
    scanDone:proof.scanCount,scanTotal:proof.sourceCount,
    completionProjection:'V762_EXACT_SNAPSHOT_PERSISTED_RUN_AND_ROWS'};
}
const v759WhppCompletionProofs=new Map();
const v759WhppProofRequests=new Map();
function v759RememberWhppProof(response,requestedDate=''){
  const date=String(requestedDate||response?.reportDate||'').slice(0,10);
  const current=String(v626LatestImport?.reportDate||'').slice(0,10);
  const snapshotId=String(response?.snapshotId||'');
  if(!date||date!==String(response?.reportDate||'').slice(0,10)||date!==current
     ||!snapshotId||snapshotId!==String(v626LatestImport?.snapshotId||''))return false;
  const truth=response?.whppCompletion||{};
  const evidence=truth.terminalEvidenceCoverage||{};
  const total=Number(truth.canonicalTotal||0);
  // Snapshot + each exact member's scanned final terminal state must agree;
  // status='COMPLETED' from the aggregate import alone is never enough.
  const fullTerminal=truth.locked===true&&truth.snapshotLocked===true
    &&truth.membershipMatches===true&&total>0
    &&Number(truth.canonicalResolved||0)===total
    &&Number(truth.finalCount||0)===total
    &&Number(evidence.scanRows||0)===total
    &&Number(evidence.finalRows||0)===total
    &&Number(evidence.podRows||0)+Number(evidence.returnedRows||0)===total;
  // A complete WHPP scan/final job can legitimately contain open customer
  // states. It is not necessary to invent POD/return outcomes to show 3/3.
  const processingComplete=truth.locked===true&&truth.processingEvidenceVerified===true
    &&truth.membershipMatches===true&&total>0
    &&Number(truth.canonicalResolved||0)===total
    &&Number(truth.finalCount||0)===total
    &&Number(evidence.scanRows||0)===total&&Number(evidence.finalRows||0)===total;
  const complete=fullTerminal||processingComplete;
  const proofKey=date+'|'+snapshotId;
  const terminalCount=Number(evidence.podRows||0)+Number(evidence.returnedRows||0);
  // V763: preserve negative, read-only evidence. A past "finished" runtime or
  // aggregate snapshot must not make 186/188 terminal members appear 3/3.
  if(total>0&&Number(truth.canonicalResolved||0)===total
     &&(truth.terminalEvidenceVerified===false||terminalCount!==total)){
    const missing=Math.max(1,total-terminalCount,Number(evidence.unverifiedRows||0));
    v763WhppEvidenceGaps.set(proofKey,{
      reportDate:date,snapshotId,total,missing,terminalCount,
      bills:(truth.terminalEvidenceGaps||[]).map(row=>String(row.shipmentCode||'')).filter(Boolean)
    });
  }else v763WhppEvidenceGaps.delete(proofKey);
  if(!complete||(truth.terminalEvidenceVerified===false&&!processingComplete))return false;
  v759WhppCompletionProofs.set(date+'|'+snapshotId,{
    locked:true,reportDate:date,snapshotId,
    reason:String(truth.reason||''),
    completionSource:String(truth.completionSource||'')
  });
  return true;
}
const v763WhppEvidenceGaps=new Map();
const v763WhppEvidenceNextRead=new Map();
function v759PinnedWhppProof(date=''){
  const day=String(date||'').slice(0,10);
  if(day!==String(v626LatestImport?.reportDate||'').slice(0,10))return null;
  const snapshotId=String(v626LatestImport?.snapshotId||'');
  return snapshotId?v759WhppCompletionProofs.get(day+'|'+snapshotId)||null:null;
}
async function v759VerifyWhppCompletionOnce(date='',{force=false}={}){
  const day=String(date||'').slice(0,10);
  const snapshotId=String(v626LatestImport?.snapshotId||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!snapshotId
     ||day!==String(v626LatestImport?.reportDate||'').slice(0,10))return false;
  // The unified 515-ticket subset may have WHPP=0 while a separate
  // 156-ticket WHPP daily source exists. Never skip proof for this reason.
  if(v759PinnedWhppProof(day))return true;
  const key=day+'|'+snapshotId;
  if(v759WhppProofRequests.has(key))return v759WhppProofRequests.get(key);
  // Bounded once per date/snapshot in 30 seconds; never rescan CE remotely.
  if(!force&&Date.now()<Number(v763WhppEvidenceNextRead.get(key)||0))return false;
  v763WhppEvidenceNextRead.set(key,Date.now()+30000);
  const promise=(async()=>{
    try{
      const response=await json('/api/whpp/completion-proof?reportDate='+encodeURIComponent(day),20000);
      const verified=v759RememberWhppProof(response,day);
      // Also repaint on negative proof: a persisted "finished" UI state
      // must be replaced by the exact unmatched WHPP members.
      if(verified||v763WhppEvidenceGaps.has(key))void refreshLiveProgress();
      return verified;
    }catch(error){
      console.warn('[CE-QC][V759] WHPP completion proof unavailable',day,error?.code||error?.message||error);
      return false;
    }finally{v759WhppProofRequests.delete(key)}
  })();
  v759WhppProofRequests.set(key,promise);
  return promise;
}
let v631TimingMissing={};
let v700TimingAvailability={};
let v741TimingRepairStates={};
let v626OpenRows=[];
let v785OpenSourceVerified=false;
let v785OpenExpectedCount=0;
let v785OpenTotal=0;
let v785OpenEarliestDate='';
let v626OpenFilter='all';
let v626ProgressTimer=null;
let v626TrackingJobId='';
let v752LaunchingFamily='';
const v752TerminalProgressLogs=new Set();
const v756ProgressSnapshots=new Map();
function v756ProgressDescriptor(family,value={}){
  const label=familyProgressLabel(value);
  const scanDone=Number(value.scanDone||0),scanTotal=Number(value.scanTotal||0);
  const trackDone=Number(value.trackDone||0),trackTotal=Number(value.trackTotal||0);
  if(familyComplete(value))return '完成';
  if(value.running||value.active){
    if(/轨迹/.test(label))return label;
    if(scanTotal>0)return '扫描 '+scanDone+'/'+scanTotal;
    if(trackTotal>0&&scanDone>=scanTotal)return '轨迹 '+trackDone+'/'+trackTotal;
    return label||'处理中';
  }
  return label||'待处理';
}
function v756LogProgressChange(reportDate,family,value={}){
  if(!(value.running||value.active)||familyComplete(value))return;
  const descriptor=v756ProgressDescriptor(family,value);
  const key=String(reportDate||'')+'|'+family;
  const signature=[descriptor,Number(value.scanDone||0),Number(value.scanTotal||0),Number(value.trackDone||0),Number(value.trackTotal||0)].join('|');
  const previous=v756ProgressSnapshots.get(key);
  if(!previous||previous.signature!==signature){
    v756ProgressSnapshots.set(key,{signature,changedAt:Date.now(),warnedAt:0});
    appendLiveLog(family+' · '+descriptor,new Date().toISOString());
    return;
  }
  if(Date.now()-previous.changedAt>=90000&&Date.now()-Number(previous.warnedAt||0)>=90000){
    previous.warnedAt=Date.now();
    appendLiveLog(family+' · '+descriptor+' · 进度90秒未变化，后台仍在运行',new Date().toISOString());
  }
}
const V755_BUSINESS_COUNT_TYPES=['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'];
const v755ImportCountTruth=new Map();
// Date/snapshot-scoped verified WHPP source count (independent daily parse may
// not appear among the 515 unified daily members). Do not treat an unknown
// WHPP count as zero.
const v785WhppCountProof=new Map();
function v785WhppProofFor(date=''){
  const day=String(date||'').slice(0,10);
  const proof=v785WhppCountProof.get(day);
  return proof?.snapshotId===String(v626LatestImport?.snapshotId||'')?proof:null;
}
function v785RememberWhppSource(truth){
  const day=String(truth?.reportDate||'').slice(0,10);
  const snapshotId=String(truth?.snapshotId||'');
  if(!day||!snapshotId||day!==String(v626LatestImport?.reportDate||'').slice(0,10)
    ||snapshotId!==String(v626LatestImport?.snapshotId||''))return null;
  if(!truth?.source?.balanced||truth?.display?.hasUnresolvedConflict)throw new Error('WHPP来源与统一日报有冲突，已停止自动完成');
  const n=Number(truth?.source?.counts?.WHPP||0)+Number(truth?.whppIndependent?.separateNotInImport||0);
  if(!Number.isSafeInteger(n)||n<0)throw new Error('WHPP成员数量无效');
  const proof={date:day,snapshotId,total:n,source:'EXACT_UNIFIED_PLUS_INDEPENDENT_WHPP'};
  v785WhppCountProof.set(day,proof);
  return proof;
}
async function v785ReadWhppSource(date='',snapshotId=''){
  const day=String(date||'').slice(0,10);
  const snap=String(snapshotId||v626LatestImport?.snapshotId||'');
  if(!day||!snap)throw new Error('无法确认WHPP独立来源快照');
  const payload=await json('/api/import/source-reconciliation?reportDate='+encodeURIComponent(day)+'&snapshotId='+encodeURIComponent(snap),15000);
  const result=v785RememberWhppSource(payload);
  if(!result)throw new Error('WHPP来源校验返回了其他日期或快照');
  return result;
}
function rememberV755ImportCounts(data={},source=''){
  const date=String(data?.reportDate||'').slice(0,10),raw=data?.classificationCounts;
  if(!date||!raw||typeof raw!=='object')return null;
  const explicitAll=V755_BUSINESS_COUNT_TYPES.every(type=>Object.prototype.hasOwnProperty.call(raw,type));
  const counts=Object.fromEntries(V755_BUSINESS_COUNT_TYPES.map(type=>[type,Number(raw[type]||0)]));
  const sum=V755_BUSINESS_COUNT_TYPES.reduce((total,type)=>total+counts[type],0);
  const expectedRaw=data?.summary?.validUniqueWaybills??data?.sourceReconciliation?.validUniqueWaybills??data?.sourceReconciliation?.total??null;
  const expected=expectedRaw===null||expectedRaw===undefined?null:Number(expectedRaw);
  const reconciled=data?.sourceReconciliation?.balanced===true||(explicitAll&&(expected===null||!Number.isFinite(expected)||sum===expected));
  if(!reconciled)return null;
  const truth={date,counts,sum,source:source||'IMPORT_COUNTS',reconciled:true};
  v755ImportCountTruth.set(date,truth);
  return truth;
}
function aggregateV755FamilyCounts(truth){
  if(!truth?.reconciled)return null;
  const counts=truth.counts||{};
  return{
    CCSL:Number(counts.CE||0)+Number(counts.CEAF||0)+Number(counts.TBKH||0)+Number(counts.ALI1688||0),
    SHOPEE:Number(counts.SHOPEECN||0)+Number(counts.SHOPEEVN||0),
    WHPP:Number(counts.WHPP||0),
    raw:counts,
    source:truth.source||''
  };
}
async function resolveV755FamilyCounts(reportDate='',explicitData=null){
  const date=String(reportDate||explicitData?.reportDate||v626LatestImport?.reportDate||'').slice(0,10);
  if(!date)throw new Error('无法确认当前日报日期，已阻止0票自动跳过。');
  if(explicitData)rememberV755ImportCounts(explicitData,'UPLOAD_RESPONSE');
  if(String(v626LatestImport?.reportDate||'').slice(0,10)===date)rememberV755ImportCounts(v626LatestImport,'LATEST_IMPORT_CACHE');
  let truth=v755ImportCountTruth.get(date)||null;
  if(!truth){
    try{
      const latest=await json('/api/import/unified-latest',7000);
      if(String(latest?.import?.reportDate||'').slice(0,10)===date)truth=rememberV755ImportCounts(latest.import,'UNIFIED_LATEST');
    }catch{}
  }
  if(!truth){
    try{
      const summary=await json('/api/home-quality-summary?fast=1&quick=1&reportDate='+encodeURIComponent(date),10000);
      const counts=summary?.classification?.counts||null;
      truth=rememberV755ImportCounts({
        reportDate:date,
        classificationCounts:counts,
        sourceReconciliation:{balanced:summary?.classification?.balanced===true},
        summary:{validUniqueWaybills:summary?.classification?.total}
      },'HOME_SUMMARY');
    }catch{}
  }
  const family=aggregateV755FamilyCounts(truth);
  if(!family)throw new Error('无法从服务器确认 '+date+' 的7业务票数；已阻止把未知票数误判成0票。');
  const snapshotId=String(explicitData?.snapshotId||v626LatestImport?.snapshotId||'');
  const proof=v785WhppProofFor(date)||await v785ReadWhppSource(date,snapshotId);
  family.WHPP=proof.total;
  family.whppSource=proof.source;
  return family;
}
let v640EvidenceRefreshTimer=null;
const v626LogKeys=new Set();

function scheduleHistoricalEvidenceRefresh(target='home'){
  if(v640EvidenceRefreshTimer)clearTimeout(v640EvidenceRefreshTimer);
  v640EvidenceRefreshTimer=setTimeout(()=>{
    v640EvidenceRefreshTimer=null;
    if(target==='business'&&page==='business')void loadBusiness();
    else if(page==='home'){
      // V804: historical evidence progress is auxiliary. Repainting the
      // whole home every 3s invalidated the independent exact-date timing
      // worker and could leave its cards forever in the "loading" state.
      void refreshLiveProgress();
    }
  },3000);
}
function stopHistoricalEvidenceRefresh(){
  if(v640EvidenceRefreshTimer){clearTimeout(v640EvidenceRefreshTimer);v640EvidenceRefreshTimer=null}
}
function cambodiaToday(){
  try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
  catch{return today()}
}
function addDaysKey(value,days){
  const d=new Date(String(value||'').slice(0,10)+'T12:00:00Z');
  if(Number.isNaN(d.getTime()))return cambodiaToday();
  d.setUTCDate(d.getUTCDate()+Number(days||0));return d.toISOString().slice(0,10);
}
function appendLiveLog(message,at=new Date().toISOString()){
  const text=String(message||'').trim();if(!text)return;
  const key=String(at||'').slice(0,19)+'|'+text;
  if(v626LogKeys.has(key))return;
  v626LogKeys.add(key);
  if(v626LogKeys.size>160){const firstKey=v626LogKeys.values().next().value;v626LogKeys.delete(firstKey)}
  for(const id of ['v626LiveLog','v626ImportLiveLog']){
    const root=byId(id);if(!root)continue;
    if(root.querySelector('.v625-empty-state'))root.replaceChildren();
    if(root.children.length===1&&root.textContent.includes('等待处理任务'))root.replaceChildren();
    const row=document.createElement('div');const time=document.createElement('time');const span=document.createElement('span');
    time.textContent=dateTime(at).split(' ').at(-1)||dateTime(at);span.textContent=text;row.append(time,span);root.appendChild(row);
    while(root.children.length>80)root.firstElementChild?.remove();
    root.scrollTop=root.scrollHeight;
  }
  setText('v626LogMeta','最近更新 '+dateTime(at));
}
async function latestImportContext(){
  try{
    const r=await json('/api/import/unified-latest',7000);
    const newest=r.import||null;
    // V766: do not replace a selected July-04 snapshot by a newer import
    // while a read-only July-04 proof is in flight.
    const selected=selectedReportDate();
    const active=String(v626LatestImport?.reportDate||'').slice(0,10);
    if(newest&&(selected&&selected!==String(newest.reportDate||'').slice(0,10)
      ||active&&active!==String(newest.reportDate||'').slice(0,10)))return v626LatestImport;
    if(newest)v626LatestImport=newest;
    return v626LatestImport;
  }catch{return v626LatestImport}
}
function progressPercent(done,total){return total>0?Math.max(0,Math.min(100,Math.round(done*100/total))):0}
function familyComplete(value={}){
  if(value.running===true||value.active===true)return false;
  return Boolean(value.complete)||/FINISHED|COMPLETED|完成/i.test(String(value.runStatus||value.outcome||value.phase||''));
}
function familyProgressLabel(value={}){
  const scanTotal=Number(value.scanTotal||0),scanDone=Number(value.scanDone||0),trackTotal=Number(value.trackTotal||0),trackDone=Number(value.trackDone||0);
  if(familyComplete(value))return '完成';
  if(value.running||value.active){
    if(/轨迹|track/i.test(String(value.phase||'')))return trackTotal?'轨迹 '+trackDone+'/'+trackTotal:'轨迹查询中';
    return scanTotal?'扫描 '+scanDone+'/'+scanTotal:'订单扫描中';
  }
  if(scanTotal||trackTotal)return '扫描 '+scanDone+'/'+scanTotal+' · 轨迹 '+trackDone+'/'+trackTotal;
  return String(value.phase||'待处理');
}
const v738WhppCompletionLatch=new Set();
async function fetchLiveProgress(reportDate=''){
  const date=reportDate||v626LatestImport?.reportDate||'';
  // V764: a long-running SQLite membership proof must never block each
  // dashboard paint. Read cached facts immediately; the scoped proof owners
  // refresh the same UI after they finish asynchronously.
  void v762LoadFamilyTerminalTruth(date);
  void v759VerifyWhppCompletionOnce(date);
  const [ccslR,shopeeR,whppR]=await Promise.allSettled([
    json('/api/v33/run-progress?businessType=CCSL'+(date?'&reportDate='+encodeURIComponent(date):''),7000),
    json('/api/v33/run-progress?businessType=SHOPEE'+(date?'&reportDate='+encodeURIComponent(date):''),7000),
    json('/api/whpp/progress'+(date?'?reportDate='+encodeURIComponent(date):''),7000)
  ]);
  let ccsl=ccslR.status==='fulfilled'?ccslR.value:{};
  let shopee=shopeeR.status==='fulfilled'?shopeeR.value:{};
  let whppPayload=whppR.status==='fulfilled'?whppR.value:null;
  const familyProof=v762VerifiedFamilyTruth(date);
  if(familyProof?.CCSL)ccsl=v762ProjectSavedCompletion(ccsl,familyProof.CCSL,date);
  if(familyProof?.SHOPEE)shopee=v762ProjectSavedCompletion(shopee,familyProof.SHOPEE,date);
  const sameLatestDate=Boolean(date&&String(v626LatestImport?.reportDate||'').slice(0,10)===date);
  const countTruth=v755ImportCountTruth.get(date)||null;
  const latestCounts=countTruth?.counts||{};
  const zeroCcsl=Boolean(countTruth)&&(Number(latestCounts.CE||0)+Number(latestCounts.CEAF||0)+Number(latestCounts.TBKH||0)+Number(latestCounts.ALI1688||0)===0);
  const zeroShopee=Boolean(countTruth)&&(Number(latestCounts.SHOPEECN||0)+Number(latestCounts.SHOPEEVN||0)===0);
  const independentWhpp=v785WhppProofFor(date);
  const effectiveWhppCount=independentWhpp?.total??Number(latestCounts.WHPP||0);
  const zeroWhpp=Boolean(independentWhpp)&&independentWhpp.total===0;
  const zeroComplete=(value,type)=>({...value,businessType:type,reportDate:date,running:false,active:false,complete:true,phase:'完成',runStatus:'completed',outcome:'COMPLETED',lastMessage:type+'当日日报0票，自动跳过',completionProjection:'ZERO_TICKET'});
  if(zeroCcsl)ccsl=zeroComplete(ccsl,'CCSL');
  if(zeroShopee)shopee=zeroComplete(shopee,'SHOPEE');
  if(zeroWhpp)whppPayload={...(whppPayload||{}),runtime:zeroComplete(whppPayload?.runtime||{},'WHPP'),completionLock:{...(whppPayload?.completionLock||{}),locked:true,finalized:true,reportDate:date,reason:'ZERO_TICKET'}};
  // V754: import/unified snapshot lifecycle is not a substitute for real business execution.
  // Only each family's own persisted run/progress truth may mark that family complete.
  if(whppPayload?.completionLock?.locked&&
     (zeroWhpp||Number(whppPayload.completionLock.canonicalTotal||0)>0))v738WhppCompletionLatch.add(date);
  if(effectiveWhppCount>0&&!v759PinnedWhppProof(date))v738WhppCompletionLatch.delete(date);
  if(v738WhppCompletionLatch.has(date)&&!whppPayload?.completionLock?.locked){
    whppPayload={...(whppPayload||{}),runtime:{...(whppPayload?.runtime||{}),active:false,reportDate:date,phase:'完成',outcome:'COMPLETED',lastMessage:'WHPP已完成（WHPP持久完成锁）'},completionLock:{...(whppPayload?.completionLock||{}),locked:true,finalized:true,reportDate:date,reason:'V754_WHPP_VERIFIED_DURABLE_COMPLETION'},summary:whppPayload?.summary||{},log:whppPayload?.log||[]};
  }
  whppPayload=whppPayload||{};
  const pinnedProof=v759PinnedWhppProof(date);
  if(pinnedProof&&!whppPayload.runtime?.active&&!whppPayload.completionLock?.locked){
    whppPayload={...whppPayload,completionLock:{
      ...whppPayload.completionLock,...pinnedProof,finalized:true,
      reason:'V759_EXACT_SNAPSHOT_WHPP_TERMINAL_PROOF'
    }};
  }
  const whppStatusUnavailable=whppR.status==='rejected'&&!whppPayload.completionLock?.locked;
  const whppLock=whppPayload.completionLock||{};
  let whpp={
    ...(whppPayload.runtime||{}),
    summary:whppPayload.summary||{},log:whppPayload.log||[],completionLock:whppLock,
    active:Boolean(whppPayload.runtime?.active)&&!whppLock.locked,
    complete:Boolean(whppLock.locked)||familyComplete(whppPayload.runtime||{}),
    outcome:whppLock.locked?'COMPLETED':String(whppPayload.runtime?.outcome||''),
    phase:whppLock.locked?'完成':whppStatusUnavailable?'完成状态核验中':String(whppPayload.runtime?.phase||'')
  };
  // Neither a stale runtime="finished" nor an old completion latch is
  // sufficient WHPP evidence. Until the read-only proof completes, show a
  // verification state rather than a false business completion.
  const whppProofPending=!zeroWhpp
    &&Boolean(effectiveWhppCount>0||Number(whppLock.canonicalTotal||0)>0||whppLock.locked||!independentWhpp)
    &&!v759PinnedWhppProof(date);
  if(whppProofPending){
    whpp={...whpp,complete:false,active:false,running:false,
      runStatus:'EVIDENCE_PENDING',outcome:'EVIDENCE_PENDING',phase:'终态核验中'};
  }
  const gap=v763WhppEvidenceGaps.get(date+'|'+String(v626LatestImport?.snapshotId||''));
  if(gap&&!zeroWhpp){
    const processingProof=v759PinnedWhppProof(date);
    if(processingProof){
      // The job is complete. The remaining POD/return states stay separately
      // visible and eligible for future tracking; never mutate their status.
      whpp={...whpp,evidenceGap:gap,complete:true,active:false,running:false,
        phase:'完成',runStatus:'finished',outcome:'COMPLETED'};
    }else{
      v738WhppCompletionLatch.delete(date);
      const incompletePhase='WHPP处理证据待核验（'+gap.missing+'票尚无POD/退回终态，需区分扫描是否已完成）';
      whpp={...whpp,complete:false,active:false,running:false,
        runStatus:'EVIDENCE_INCOMPLETE',outcome:'EVIDENCE_INCOMPLETE',phase:incompletePhase,
        evidenceGap:gap,
        completionLock:{...whpp.completionLock,locked:false,finalized:false,reason:'WHPP_TERMINAL_EVIDENCE_GAP'}
      };
    }
  }
  // The diagnostic is the authoritative owner for historical CCSL/SHOPEE.
  // While it is loading, do not conflate "not yet verified" with "not run".
  if(!zeroCcsl&&!familyProof?.CCSL&&!familyComplete(ccsl)&&Number(latestCounts.CE||0)+Number(latestCounts.CEAF||0)+Number(latestCounts.TBKH||0)+Number(latestCounts.ALI1688||0)>0){
    ccsl={...ccsl,phase:'历史证据核验中'};
  }
  if(!zeroShopee&&!familyProof?.SHOPEE&&!familyComplete(shopee)&&Number(latestCounts.SHOPEECN||0)+Number(latestCounts.SHOPEEVN||0)>0){
    shopee={...shopee,phase:'历史证据核验中'};
  }
  return{ccsl,shopee,whpp,reportDate:date};
}
function renderLiveProgress(bundle={}){
  // An explicitly unimported date has no business processing to verify.
  // Do not show stale "WHPP terminal verification in progress" or "0/3 failed".
  const emptyDate=String(bundle.reportDate||'').slice(0,10);
  if(emptyDate&&v788EmptySelectedDates.has(emptyDate)){
    for(const id of ['v626CcslProgress','v626ShopeeProgress','v626WhppProgress',
      'v626ImportCcsl','v626ImportShopee','v626ImportWhpp',
      'v626StageScan','v626StageTrack','v626StageDone',
      'v626ImportScan','v626ImportTrack','v626ImportDone'])setText(id,'等待日报');
    for(const id of ['v626ProcessBar','v626ImportBar']){
      const el=byId(id);if(el)el.style.width='0%';
    }
    const emptyText='所选日期尚未上传日报；上传后再核验扫描、轨迹与POD';
    setText('v626ProcessText',emptyText);
    setText('v626ImportProgressText',emptyText);
    setText('v626ProcessCount','等待日报');
    setText('v626ImportProgressCount','等待日报');
    const resumeBtn=byId('v625RunResume');
    if(resumeBtn)resumeBtn.style.setProperty('display','none','important');
    return;
  }
  const {ccsl={},shopee={},whpp={}}=bundle;
  const familyLabels={
    ccsl:familyProgressLabel(ccsl),
    shopee:familyProgressLabel(shopee),
    whpp:familyProgressLabel(whpp)
  };
  if(v752LaunchingFamily==='CCSL'&&!familyComplete(ccsl))familyLabels.ccsl='启动中';
  if(v752LaunchingFamily==='SHOPEE'&&!familyComplete(shopee))familyLabels.shopee='启动中';
  setText('v626CcslProgress',familyLabels.ccsl);setText('v626ShopeeProgress',familyLabels.shopee);setText('v626WhppProgress',familyLabels.whpp);
  setText('v626ImportCcsl',familyLabels.ccsl);setText('v626ImportShopee',familyLabels.shopee);setText('v626ImportWhpp',familyLabels.whpp);

  const scanDone=Number(ccsl.scanDone||0)+Number(shopee.scanDone||0);
  const scanTotal=Number(ccsl.scanTotal||0)+Number(shopee.scanTotal||0);
  const trackDone=Number(ccsl.trackDone||0)+Number(shopee.trackDone||0);
  const trackTotal=Number(ccsl.trackTotal||0)+Number(shopee.trackTotal||0);
  const whppBatch=Number(whpp.batchIndex||0),whppBatches=Number(whpp.totalBatches||0);
  const allRunning=Boolean(ccsl.running||shopee.running||whpp.active||v752LaunchingFamily);
  const completeFamilies=Object.values(familyLabels).filter(label=>label==='完成').length;
  const allComplete=completeFamilies===3;
  const sourceKnown=v788HomeSourceProof?.reportDate===String(bundle.reportDate||'').slice(0,10)
    &&Number(v788HomeSourceProof?.total||0)>0;
  const progressUnknown=Boolean(sourceKnown&&!allComplete&&!allRunning&&completeFamilies===0
    &&scanTotal===0&&trackTotal===0&&whppBatches===0);
  const historyVerifying=[familyLabels.ccsl,familyLabels.shopee].some(label=>String(label).includes('历史证据核验中'));
  const scanPct=allComplete?100:progressPercent(scanDone,scanTotal),trackPct=allComplete?100:progressPercent(trackDone,trackTotal);
  const whppPct=allComplete?100:progressPercent(whppBatch,whppBatches);
  const overall=allComplete?100:Math.round((scanPct+trackPct+(whppBatches?whppPct:(completeFamilies/3*100)))/3);
  for(const id of ['v626ProcessBar','v626ImportBar']){const el=byId(id);if(el)el.style.width=Math.max(0,Math.min(100,overall))+'%'}
  const activePhase=whpp.active?('WHPP · '+v756ProgressDescriptor('WHPP',whpp)):shopee.running?('SHOPEE · '+v756ProgressDescriptor('SHOPEE',shopee)):ccsl.running?('CCSL · '+v756ProgressDescriptor('CCSL',ccsl)):v752LaunchingFamily?(v752LaunchingFamily+'启动中'):'';
  const whppVerifying=String(familyLabels.whpp||'').includes('核验中');
  const phase=allComplete
    ?'全部处理完成'+(whpp.evidenceGap?' · WHPP '+whpp.evidenceGap.missing+'票状态待跟进':'')
    :progressUnknown?'历史日报已有来源成员，扫描/轨迹完成证据暂不可核验；请勿重新上传或重复扫描'
    :activePhase||(historyVerifying?'CCSL/SHOPEE历史证据核验中；无需重新上传或扫描，可正常切换看板':whpp.evidenceGap?'已完成'+completeFamilies+'/3业务 · WHPP '+whpp.evidenceGap.missing+'票状态待核验（无需重新上传）':whppVerifying?'WHPP完成状态核验中，请勿重复扫描':completeFamilies===2&&familyLabels.whpp!=='完成'?'已完成 2/3 业务 · WHPP待处理，请点击“继续未完成处理”':completeFamilies?('已完成 '+completeFamilies+'/3 业务，等待下一业务处理'):'等待开始处理');
  // V785: "WHPP 0 tickets auto-skipped" belongs to the task engine's old
  // unified sub-count; it cannot describe a separately verified 156-member
  // WHPP daily source. Display the customer terminal gap independently.
  const whppSource=v785WhppProofFor(bundle.reportDate||'');
  const whppRealMembers=Number(whppSource?.total??0);
  const verifiedWhppProcessing=Boolean(v759PinnedWhppProof(bundle.reportDate||''));
  const whppPendingCustomer=whpp.evidenceGap?.missing||0;
  const whppStatusNote=whppRealMembers>0
    ?' · WHPP独立来源 '+fmt(whppRealMembers)+'票；'+
      (verifiedWhppProcessing?'扫描/最终记录处理完成':'扫描/最终记录仍待核验')+
      (whppPendingCustomer?'，未POD/退回终态待查 '+fmt(whppPendingCustomer)+'票':'')
    :'';
  setText('v626ProcessText',phase+whppStatusNote);setText('v626ImportProgressText',phase+whppStatusNote);
  const progressCount=progressUnknown?'历史处理证据待核验':historyVerifying?'历史核验中（当前已确认 '+completeFamilies+'/3 业务）'
    :(scanTotal+trackTotal)>0?((scanDone+trackDone)+' / '+(scanTotal+trackTotal)):(completeFamilies+'/3 业务完成');
  const reconciledCount=whpp.evidenceGap?progressCount+' · WHPP已确认终态 '+whpp.evidenceGap.terminalCount+'/'+whpp.evidenceGap.total:progressCount;
  setText('v626ProcessCount',reconciledCount);setText('v626ImportProgressCount',reconciledCount);
  const scanStage=allComplete?'完成':progressUnknown?'待核验':historyVerifying?'历史核验中':(/轨迹|track/i.test(activePhase)?'完成':allRunning?'处理中':completeFamilies?('已完成 '+completeFamilies+'/3业务'):'等待');
  const trackStage=allComplete?'完成':progressUnknown?'待核验':historyVerifying?'历史核验中':(/轨迹|track/i.test(activePhase)?'处理中':allRunning?'等待扫描完成':completeFamilies?('已完成 '+completeFamilies+'/3业务'):'等待');
  const doneStage=allComplete?'完成':progressUnknown?'待核验':historyVerifying?'历史核验中':allRunning?'处理中':completeFamilies?('已完成 '+completeFamilies+'/3业务'):'等待';
  setText('v626StageScan',scanStage);setText('v626StageTrack',trackStage);setText('v626StageDone',doneStage);
  setText('v626ImportScan',scanStage);setText('v626ImportTrack',trackStage);setText('v626ImportDone',doneStage);
  const badge=byId('v626ProcessState');if(badge){badge.textContent=completeFamilies>=3?'已完成':(progressUnknown||historyVerifying)?'待核验':allRunning?'处理中':'待处理';badge.className='v625-badge '+(completeFamilies>=3?'success':allRunning?'warning':'warning')}
  const resumeBtn=byId('v625RunResume');if(resumeBtn){
    // V790: historical verification is a display state, not an active worker.
    // Existing dispatcher checks exact date, snapshot and saved evidence.
    resumeBtn.disabled=allComplete||allRunning||runBusy;
    resumeBtn.hidden=allComplete||allRunning||runBusy;
    resumeBtn.style.setProperty('display',resumeBtn.disabled?'none':'inline-flex','important');
  }
  const progressLogs=[
    ['CCSL',ccsl,ccsl.generatedAt||new Date().toISOString(),ccsl.phase||ccsl.lastMessage],
    ['SHOPEE',shopee,shopee.generatedAt||new Date().toISOString(),shopee.phase||shopee.lastMessage],
    ['WHPP',whpp,whpp.heartbeatAt||whpp.finishedAt||new Date().toISOString(),whpp.lastMessage||whpp.phase]
  ];
  for(const [family,value,at,message] of progressLogs){
    if(value.running||value.active){
      v756LogProgressChange(bundle.reportDate||value.reportDate||'',family,value);
      continue;
    }
    if(!message)continue;
    if(familyComplete(value)){
      const key=[bundle.reportDate||value.reportDate||'',family,String(message)].join('|');
      if(v752TerminalProgressLogs.has(key))continue;
      v752TerminalProgressLogs.add(key);
    }
    appendLiveLog(message,at);
  }
  for(const log of whpp.log||[])appendLiveLog(log.message||'',log.at||new Date().toISOString());
}
async function refreshLiveProgress(){
  const date=selectedReportDate()||v626LatestImport?.reportDate||'';
  if(date&&v788EmptySelectedDates.has(date)){
    const empty={reportDate:date};
    renderLiveProgress(empty);
    return empty;
  }
  const bundle=await fetchLiveProgress(date);
  renderLiveProgress(bundle);return bundle;
}
function startProgressPolling(){
  stopProgressPolling();void refreshLiveProgress();
  v626ProgressTimer=setInterval(()=>{void refreshLiveProgress()},3000);
}
function stopProgressPolling(){if(v626ProgressTimer){clearInterval(v626ProgressTimer);v626ProgressTimer=null}}

function renderOpenPodRows(){
  const latestDate=v626LatestImport?.reportDate||'';
  const rows=v626OpenRows.filter(row=>{
    if(v626OpenFilter==='today')return String(row.reportDate||row.sourceReportDate||'').slice(0,10)===latestDate;
    if(v626OpenFilter==='retry')return String(row.queryStatus||'').includes('重试')||String(row.apiStatus||'').includes('失败');
    return true;
  });
  setText('v626OpenAll',v785OpenSourceVerified?v785OpenTotal:'待核验');
  setText('v626OpenToday',v785OpenSourceVerified?v626OpenRows.filter(row=>String(row.reportDate||row.sourceReportDate||'').slice(0,10)===latestDate).length:'—');
  setText('v626OpenRetry',v785OpenSourceVerified?v626OpenRows.filter(row=>String(row.queryStatus||'').includes('重试')||String(row.apiStatus||'').includes('失败')).length:'—');
  const targets=[['v626OpenPodRows',5],['v626ImportOpenRows',6]];
  for(const [id,cols] of targets){
    const tbody=byId(id);if(!tbody)continue;tbody.replaceChildren();
    if(!v785OpenSourceVerified){
      const isUnimported=v788EmptySelectedDates.has(selectedReportDate());
      tbody.innerHTML='<tr><td colspan="'+cols+'">'+
        (isUnimported?'所选日期暂无日报；导入后再核验未完成POD。'
          :'未完成POD来源尚未核验，不能按0票判定；请核对已保存的当日成员。')+'</td></tr>';
      continue;
    }
    if(!rows.length){tbody.innerHTML='<tr><td colspan="'+cols+'">已核对 '+fmt(v785OpenExpectedCount)+' 票来源成员，当前没有需要继续查询的未完结运单。</td></tr>';continue}
    for(const row of rows.slice(0,300)){
      const tr=document.createElement('tr');
      const values=cols===5
        ? [row.shipmentCode,row.businessType,row.currentState||row.category||row.queryStatus||'未完成',row.lastEventTime||row.lastCheckedAt||'—']
        : [row.shipmentCode,row.businessType,row.currentState||row.category||'未完成',row.queryStatus||'需更新',row.lastEventTime||row.lastCheckedAt||'—'];
      for(const value of values){const td=document.createElement('td');td.textContent=value||'—';tr.appendChild(td)}
      const td=document.createElement('td');
      const code=String(row.shipmentCode||'').trim().toUpperCase();
      const date=String(row.sourceReportDate||row.reportDate||'').slice(0,10);
      const type=String(row.businessType||'').trim().toUpperCase();
      if(code&&/^\d{4}-\d{2}-\d{2}$/.test(date)
        &&['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'].includes(type)){
        const a=document.createElement('a');
        a.href='/tracking?auth=v625&code='+encodeURIComponent(code)
          +'&reportDate='+encodeURIComponent(date)
          +'&businessType='+encodeURIComponent(type);
        a.textContent='查看该票轨迹';td.appendChild(a);
      }else td.textContent='单号/日期/业务待核验';
      tr.appendChild(td);tbody.appendChild(tr);
    }
  }
}
async function loadOpenPod(){
  if(v788EmptySelectedDates.has(selectedReportDate())){
    // Keep source-unverified status; neutral placeholder, not a falsely verified 0.
    v785OpenSourceVerified=false;
    v785OpenExpectedCount=0;
    v785OpenTotal=0;
    v785OpenEarliestDate='';
    v626OpenRows=[];
    renderOpenPodRows();
    note('v626RefreshPodMessage','所选日期暂无已导入日报；待上传后进行来源核验。');
    return null;
  }
  try{
    const latest=v626LatestImport||await latestImportContext();
    const selected=String(selectedReportDate()||'').slice(0,10);
    const proof=v788HomeSourceProof?.reportDate===selected?v788HomeSourceProof:null;
    const reportDate=selected||String(latest?.reportDate||'').slice(0,10);
    const snapshotId=String(proof?.snapshotId||(
      String(latest?.reportDate||'').slice(0,10)===reportDate?latest?.snapshotId:'')||'');
    if(!reportDate||!snapshotId)throw new Error('当前日报日期与来源快照未匹配，不能使用其他日期的未完成POD清单');
    const params=new URLSearchParams({scope:'open',reportDate,snapshotId});
    note('v626RefreshPodMessage','正在只读核对 '+reportDate+' 的未完成POD来源；不会调用TMS…');
    const r=await json('/api/tracking-workspace?'+params.toString(),30000);
    if(String(r.reportDate||'').slice(0,10)!==reportDate)
      throw new Error('未完成POD返回的日报日期与选择日期不一致');
    if(!r.openSourceCoverage?.complete){
      const gap=r.openSourceCoverage||{};
      throw new Error('来源核验不完整：应有'+fmt(gap.expected||0)+'票，已读'+fmt(gap.observed||0)
        +'票，缺失'+fmt(gap.missing||0)+'票，多余'+fmt(gap.extra||0)+'票'
        +(gap.error?'；'+gap.error:''));
    }
    v785OpenSourceVerified=true;
    v785OpenExpectedCount=Number(r.openSourceCoverage.expected||0);
    v785OpenTotal=Number(r.openRowCount||0);
    v785OpenEarliestDate=String(r.openSourceCoverage.earliestCarryDate||r.reportDate||'').slice(0,10);
    v626OpenRows=(r.rows||[]).filter(row=>!row.isClosed);
    renderOpenPodRows();
    if(r.truncated)note('v626RefreshPodMessage','未完结共'+fmt(v785OpenTotal)+'票，页面当前最多显示前5000票。请缩小日期范围进行详细核对。');
    else note('v626RefreshPodMessage','已逐票核对 '+fmt(v785OpenExpectedCount)+' 个来源成员；未完结 '+fmt(v785OpenTotal)+'票。');
    return r;
  }catch(error){
    v785OpenSourceVerified=false;
    v785OpenEarliestDate='';
    v626OpenRows=[];
    renderOpenPodRows();
    note('v626RefreshPodMessage','未完成POD暂不可验收：'+error.message,'error');
    return null;
  }
}
async function pollTrackingJob(jobId){
  v626TrackingJobId=jobId;
  for(let i=0;i<900;i++){
    const r=await json('/api/v246/tracking/job/'+encodeURIComponent(jobId),12000);
    const job=r.job||{};
    const message=job.message||job.phase||'更新未完成POD';
    note('v626RefreshPodMessage',message,job.status==='FAILED'?'error':'');
    appendLiveLog(message,job.updatedAt||new Date().toISOString());
    if(['COMPLETED','FAILED'].includes(String(job.status||''))){
      if(job.status==='FAILED')throw new Error(job.error||job.message||'未完成POD更新失败');
      return job;
    }
    await new Promise(resolve=>setTimeout(resolve,1200));
  }
  throw new Error('未完成POD更新超时');
}
async function refreshOpenPodNow(){
  if(runBusy)return;
  const latest=v626LatestImport||await latestImportContext();if(!latest?.reportDate){note('v626RefreshPodMessage','请先上传综合日报。','error');return}
  const reportDate=selectedReportDate()||latest.reportDate;
  note('v626RefreshPodMessage','正在补查 '+reportDate+' 当日报表未完成POD与签收轨迹…');
  try{
    if(!v785OpenSourceVerified)await loadOpenPod();
    if(!v785OpenSourceVerified)throw new Error('未完成来源尚未核验，不能启动批量轨迹处理。');
    const fromDate=v785OpenEarliestDate&&v785OpenEarliestDate<reportDate?v785OpenEarliestDate:reportDate;
    const r=await post('/api/v246/tracking/reconcile',{businessType:'ALL',fromDate,toDate:reportDate},30000);
    const job=await pollTrackingJob(r.job?.jobId||'');
    // V786: a completed HTTP task is NOT a completed business publication.
    // Re-read the dated source and current OPEN queue before announcing success.
    const verified=await loadOpenPod();
    if(!verified?.openSourceCoverage?.complete)
      throw new Error('接口刷新结束，但未能重新核对全部原始成员和未完结队列，不能宣称业务闭环');
    await Promise.all([page==='home'?loadHome({skipAux:true}):Promise.resolve(),
      page==='business'?loadBusiness({skipQualityRefresh:true}):Promise.resolve()]);
    const retryCount=Number(job.failed||0);
    note('v626RefreshPodMessage',reportDate+' 定向补查完成：已复核来源 '+fmt(v785OpenExpectedCount)+
      '票；当前仍未完结 '+fmt(v785OpenTotal)+'票；成功刷新 '+fmt(job.refreshed||0)+
      '票，待重试 '+fmt(retryCount)+'票。'+(retryCount?'部分运单仍需继续补查。':'最新状态已保存并重新核对。'),
      retryCount?'warning':'success');
  }catch(error){note('v626RefreshPodMessage','更新失败：'+error.message,'error')}
}

async function scanWhppPending(){
  if(runBusy)return;
  const reportDate=selectedReportDate()||v626LatestImport?.reportDate||(await latestImportContext())?.reportDate||'';
  if(!reportDate){return}
  runBusy=true;
  const btn=byId('v641WhppScanPending');if(btn){btn.disabled=true;btn.textContent='WHPP扫描中…'}
  startProgressPolling();
  try{
    appendLiveLog('开始WHPP '+reportDate+' 待扫描成员处理');
    await safeWhppRun('resume',reportDate);
    appendLiveLog('WHPP '+reportDate+' 扫描/轨迹处理完成');
    await Promise.all([refreshLiveProgress(),loadBusiness(),loadOpenPod()]);
  }catch(error){
    appendLiveLog('WHPP处理未完成：'+error.message);
    const meta=byId('v637BusinessIntegrity');if(meta)meta.textContent=(meta.textContent||'')+' · WHPP处理失败：'+error.message;
  }finally{
    runBusy=false;stopProgressPolling();
    if(btn){
      btn.disabled=false;
      const currentText=String(byId('v637BusinessIntegrity')?.textContent||'');
      const match=currentText.match(/待扫描\s*([\d,]+)/);
      const waiting=Number(String(match?.[1]||'0').replace(/,/g,''));
      const showWhppScan=business==='WHPP'&&waiting>0;
      btn.hidden=!showWhppScan;
      btn.style.setProperty('display',showWhppScan?'inline-flex':'none','important');
      btn.textContent=waiting>0?'扫描WHPP待处理 '+fmt(waiting)+' 票':'扫描WHPP待处理票';
    }
  }
}
// V788: independent exact-date returns cannot be held hostage by slow
// historical timing. An unverified count remains explicitly unknown.
let v801VerifiedReturnsProof=null;
function v788RenderVerifiedHomeReturns(payload,reportDate,snapshotId){
  if(page!=='home'||String(selectedReportDate()||reportDate)!==reportDate)return false;
  if(!payload||payload.ok!==true||payload.selectionMatched!==true
    ||String(payload.reportDate)!==reportDate||String(payload.snapshotId)!==snapshotId)return false;
  v801VerifiedReturnsProof={reportDate,snapshotId,returns:payload.returns||{}};
  for(const type of ['WHPP','SHOPEECN','SHOPEEVN']){
    const result=payload.returns?.[type];
    const verified=result?.verified===true&&Number.isFinite(result?.count)
      &&Number.isFinite(result?.rate)&&Number(result?.total)>=Number(result.count)
      &&Number(result.count)>=0&&Number(result.rate)>=0&&Number(result.rate)<=100;
    setText('v626Return'+type,verified?fmt(result.count):'待核验');
    setText('v626ReturnRate'+type,verified?pct(result.rate):'待核验');
    if(verified){
      setText('v626Timing'+type+'Return',fmt(result.count));
      setText('v626Timing'+type+'ReturnRate',pct(result.rate));
    }
  }
  v801RenderVerifiedReturns(payload);
  return true;
}
let v788HomeViewSequence=0;
let v788HomeSourceProof=null;
async function loadHome(options={}){
  // V803: the async full summary is a second paint of the SAME view,
  // not another navigation; preserve exact-date timing worker ownership.
  const viewSequence=options.summaryOverride&&options.expectedViewSequence
    ?options.expectedViewSequence:++v788HomeViewSequence;
  const requestedDate=selectedReportDate();
  if(!options.summaryOverride)v801SetTimingWaiting(requestedDate);
  const summaryUrl='/api/home-quality-summary?fast=1'+(requestedDate?'&reportDate='+encodeURIComponent(requestedDate):'');
  const summaryQuickUrl=summaryUrl+'&quick=1';
  // V765: summary is the first paint authority. History metadata is
  // decorative and must not hold the home view for up to seven seconds.
  const summaryPromise=options.summaryOverride
    ?Promise.resolve(options.summaryOverride)
    :json(summaryQuickUrl,12000).catch(()=>null);
  // Start optional history after the fast SQL summary request, to avoid
  // competing for the SQLite event-loop before first KPI paint.
  const historyPromise=options.skipHistory?Promise.resolve(null)
    :new Promise(resolve=>setTimeout(resolve,1200))
      .then(()=>json('/api/unified-history?limit=7',7000).catch(()=>null));
  const summary=await summaryPromise;
  // Display the actual saved selected date as soon as the lightweight
  // classification response arrives. URL may contain only ?auth=v625.
  if(viewSequence===v788HomeViewSequence&&page==='home'){
    if(summary?.selectionMatched&&summary?.reportDate)
      setText('v801TimingStatus','日报 '+summary.reportDate+' · 正在读取当天可信签收时间');
    else if(!summary)
      setText('v801TimingStatus','首页日报来源读取失败，签收时效无法核验，请检查后台状态');
    else
      setText('v801TimingStatus',requestedDate
        ?'所选日期 '+requestedDate+' 尚无有效日报，请选择已导入日期'
        :'暂无已导入的有效日报，不能计算签收时效');
  }
  // V788: explicit absent-day response only. A visible 0 is not a purge proof.
  if(requestedDate&&summary?.selectionMatched===false
    &&!summary?.snapshotId&&Number(summary?.classification?.total||0)===0){
    v788EmptySelectedDates.add(requestedDate);
    // Replace the prior fetch's red 0/0 source warning after empty-day proof.
    v785OpenSourceVerified=false;
    v626OpenRows=[];
    renderOpenPodRows();
    note('v626RefreshPodMessage','所选日期尚未导入日报；暂无待核验的来源成员。');
    void refreshLiveProgress();
  }else if(requestedDate&&summary&&(summary?.snapshotId
    ||Number(summary?.classification?.total||0)>0)){
    v788EmptySelectedDates.delete(requestedDate);
  }
  if(viewSequence!==v788HomeViewSequence||page!=='home')return;
  // V766: never hold the menu while 30 days of signing and return SQL runs.
  // The first response holds only verified source classification counts.
  // The completed full result is applied only if the exact original
  // report-date and snapshot are still selected.
  if(summary?.quickOnly&&summary.selectionMatched&&summary.snapshotId){
    const proofDate=String(summary.reportDate||''),proofSnapshot=String(summary.snapshotId||'');
    // V802: selected-day timing is a separate worker, not blocked by
    // history trend or 30-day full summary; scope every response to the
    // exact source date and snapshot to block stale multi-day UI updates.
    const timingUrl='/api/home-timing-summary?reportDate='+encodeURIComponent(proofDate)
      +'&snapshotId='+encodeURIComponent(proofSnapshot);
    setTimeout(()=>{
      if(viewSequence!==v788HomeViewSequence||page!=='home'
        ||String(selectedReportDate()||proofDate)!==proofDate)return;
      const timingStarted=Date.now();
      const diagnostic=setTimeout(()=>{
        if(viewSequence===v788HomeViewSequence&&page==='home'
          &&String(selectedReportDate()||proofDate)===proofDate)
          setText('v801TimingStatus','日报 '+proofDate+' · 正在独立核对可信POD时间（已运行10秒）；七业务分类不受影响');
      },10000);
      void json(timingUrl,45000).then(payload=>{
        if(viewSequence!==v788HomeViewSequence||page!=='home'
          ||String(selectedReportDate()||proofDate)!==proofDate
          ||String(payload?.reportDate||'')!==proofDate
          ||String(payload?.snapshotId||'')!==proofSnapshot)return;
        if(!v802RenderSelectedTiming(payload))
          setText('v801TimingStatus','日报 '+proofDate+' · 签收来源与所选快照不一致，不能显示假签收天数');
      }).catch(error=>{
        if(viewSequence===v788HomeViewSequence&&page==='home'
          &&String(selectedReportDate()||proofDate)===proofDate)
          setText('v801TimingStatus','日报 '+proofDate+' · 签收时效读取失败（已用时'+Math.round((Date.now()-timingStarted)/1000)
            +'秒）：'+String(error?.message||'本机数据库只读核验未返回').slice(0,110)
            +'；分类数据不受影响，不会将缺失显示为0天');
      }).finally(()=>clearTimeout(diagnostic));
    },100);
    // Independent short read does not depend on HOME_FULL's 30-day timing.
    const returnsUrl='/api/home-return-summary?reportDate='+encodeURIComponent(proofDate)
      +'&snapshotId='+encodeURIComponent(proofSnapshot);
    setTimeout(()=>{
      if(viewSequence!==v788HomeViewSequence||page!=='home'
        ||String(selectedReportDate()||proofDate)!==proofDate)return;
      void json(returnsUrl,30000).then(payload=>{
        if(viewSequence===v788HomeViewSequence)
          v788RenderVerifiedHomeReturns(payload,proofDate,proofSnapshot);
      }).catch(()=>{
        if(viewSequence===v788HomeViewSequence&&page==='home')
          setText('v625HomeStatus','七业务源票可用；退回率只读核验暂未完成，不能以横杠或0%作为业务结论。');
      });
    },250);
    const url='/api/home-quality-summary?fast=1&reportDate='+encodeURIComponent(proofDate)+
      '&snapshotId='+encodeURIComponent(proofSnapshot);
    setTimeout(()=>{
      if(viewSequence!==v788HomeViewSequence||page!=='home'||String(selectedReportDate()||proofDate)!==proofDate)return;
      void json(url,70000).then(full=>{
        if(!full||viewSequence!==v788HomeViewSequence||String(full.reportDate||'')!==proofDate
          ||String(full.snapshotId||'')!==proofSnapshot
          ||String(selectedReportDate()||proofDate)!==proofDate)return;
        void loadHome({summaryOverride:full,expectedViewSequence:viewSequence,skipHistory:true,skipAux:true});
      }).catch(()=>{
        // The slow historical summary is optional: it must never replace a
        // concurrent independently verified selected-day timing status.
        if(page==='home'&&viewSequence===v788HomeViewSequence
          &&String(selectedReportDate()||proofDate)===proofDate)
          setText('v625HomeStatus','分类概览可用；历史汇总仍待核验。指定日期签收统计由独立任务负责。');
      });
    },1200);
  }
  const historyRows=[];
  void historyPromise.then(history=>{
    if(page!=='home')return;
    const date=String(summary?.reportDate||requestedDate||'').slice(0,10);
    const item=(history?.rows||[]).find(row=>String(row.reportDate||'').slice(0,10)===date);
    if(!item||date!==String(v626LatestImport?.reportDate||'').slice(0,10))return;
    // Never override an active/newer snapshot with old history metadata.
    if(summary?.snapshotId&&item.snapshotId&&String(summary.snapshotId)!==String(item.snapshotId))return;
    v626LatestImport={...(v626LatestImport||{}),snapshotStatus:item.snapshotStatus||item.status||'',
      sourceName:item.sourceName||v626LatestImport?.sourceName};
    setText('v626ProcessDateSource','当前查看日报：'+date+
      (v626LatestImport.snapshotStatus?' · '+v626LatestImport.snapshotStatus:''));
  });
  const integrity=null;
  const activeReportDate=summary?.reportDate||requestedDate||'';
  const selectedBatch=historyRows.find(row=>String(row.reportDate||'').slice(0,10)===String(activeReportDate||'').slice(0,10))||null;
  if(selectedBatch){
    v626LatestImport={...(v626LatestImport||{}),...selectedBatch};
  }else if(summary?.snapshotId||summary?.reportDate){
    v626LatestImport={...(v626LatestImport||{}),snapshotId:summary.snapshotId,reportDate:summary.reportDate};
  }
  syncDashboardNavigationContext(summary?.reportDate||requestedDate||'',summary?.snapshotId||selectedBatch?.snapshotId||'');
  const historicalRunning=summary?.historicalEvidenceRecovery?.state==='RUNNING';
  const timingRepairRunning=Boolean(summary?.timingEvidenceRepair?.active);
  if(historicalRunning||timingRepairRunning)scheduleHistoricalEvidenceRefresh('home');
  else if(summary?.historicalEvidenceRecovery?.state==='COMPLETED'||summary?.timingEvidenceRepair)stopHistoricalEvidenceRefresh();
  if(summary?.reportDate&&!selectedReportDate())applyDashboardDate(summary.reportDate);
  const classification=summary?.classification||{};
  const counts=classification.counts||{};
  const returns=summary?.returns||{};
  const types=['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'];
  const sevenBusinessTotal=types.reduce((sum,type)=>sum+Number(counts[type]||0),0);
  const grand=Number(classification.total||sevenBusinessTotal||0);
  v788HomeSourceProof={reportDate:String(summary?.reportDate||requestedDate||'').slice(0,10),
    snapshotId:String(summary?.snapshotId||''),total:grand};
  setText('v632GrandTotal',fmt(grand));
  setText('v632GrandTotalCheck',fmt(sevenBusinessTotal));
  const totalCard=q('[data-card="TOTAL"]');
  if(totalCard)totalCard.classList.toggle('v632-total-mismatch',grand!==sevenBusinessTotal);
  setText('v637HomeIntegrity',summary?.selectionMatched===false
    ?'所选日期暂无已导入日报，请选择实际导入日期（历史任务不会丢失）'
    :(summary?.quickOnly?'七业务源票 '+fmt(grand)+' · 分类概览已就绪；时效统计后台补充中'
      :'七业务源票 '+fmt(grand)+' · 明细在对应业务看板按需读取'));
  const fastIntegrityBar=byId('v637HomeIntegrityBar');if(fastIntegrityBar){fastIntegrityBar.classList.remove('error');fastIntegrityBar.classList.add('ok')}

  for(const type of types){
    const card=q('[data-card="'+type+'"]');if(!card)continue;
    const value=Number(counts[type]||0);
    card.querySelector(':scope>strong').textContent=fmt(value);
    const ratio=grand?value/grand*100:0;
    card.querySelector('[data-ratio]').textContent=pct(ratio);
    card.querySelector('.v625-card-foot em').style.width=Math.min(100,ratio)+'%';
    const base=card.getAttribute('href')?.split('?')[0]||'/';
    const params=new URLSearchParams({auth:'v625'});
    if(summary?.snapshotId)params.set('snapshotId',summary.snapshotId);
    if(summary?.reportDate)params.set('reportDate',summary.reportDate);
    card.href=base+'?'+params.toString();
  }
  if(!summary?.quickOnly)for(const type of ['WHPP','SHOPEECN','SHOPEEVN']){
    setText('v626Return'+type,fmt(returns[type]?.count||0));
    setText('v626ReturnRate'+type,pct(returns[type]?.rate||0));
  }

  setText('v625HomeDateMeta',summary?.reportDate?'今日数据统计（'+summary.reportDate+'）':'今日数据统计');
  setText('v626ProcessReportDate',summary?.reportDate||requestedDate||'等待日报');
  const processDate=summary?.reportDate||requestedDate||'';
  const processExists=Boolean(processDate&&(selectedBatch||summary?.snapshotId||Number(classification.total||0)>0));
  setText('v626ProcessFile',processExists?(v626LatestImport?.sourceName||('综合日报 '+processDate)):'尚未上传综合日报');
  setText('v626ProcessDateSource',processExists?('当前查看日报：'+processDate+(selectedBatch?.snapshotStatus?' · '+selectedBatch.snapshotStatus:'')):'日报日期将由系统自动识别');
  setText('v626StageParse',summary?.reportDate?'完成':'等待');setText('v626StageClassify',classification.balanced?'完成':'待核验');
  const dataHealthy=Boolean(classification.balanced);
  setText('v625HomeStatusTitle',summary?.selectionMatched===false?'所选日期没有日报'
    :dataHealthy?'七业务分类概览已就绪':'分类数据待核验');
  setText('v625HomeStatus',summary?.selectionMatched===false?'该日期没有有效日报记录；请选择已导入日报日期。'
    :summary?.quickOnly?'七业务源票已加载，POD、退回与平均签收天数仍在后台核验；可正常切换看板。'
    :dataHealthy?'七业务分类总量已守恒；明细按需读取。'
    :'当前分类总量与综合日报未完全守恒，请检查分类结果。');
  setText('v625DataStatus',dataHealthy?'正常':'待核验');
  setText('v625UpdatedAt',summary?.generatedAt?dateTime(summary.generatedAt):new Date().toLocaleString('zh-CN',{hour12:false}));

  setText('v625ClassTotal',fmt(classification.total||0));setText('v625ClassAuto',fmt(classification.autoRecognized||0));
  setText('v625ClassUnknown',fmt(classification.unrecognized||0));setText('v625ClassConflict',fmt(classification.conflicts||0));
  setText('v625ClassAccuracy',pct(classification.accuracyRate||0));
  setText('v625ClassAutoShare','占比 '+pct(grand?(classification.autoRecognized||0)*100/grand:0));
  setText('v625ClassUnknownShare','占比 '+pct(grand?(classification.unrecognized||0)*100/grand:0));
  setText('v625ClassConflictShare','占比 '+pct(grand?(classification.conflicts||0)*100/grand:0));
  setText('v625ClassBalanced',classification.balanced?'七业务总量守恒':'分类总量未守恒');setText('v625RecognitionMeta',summary?.reportDate||'本次日报');

  const tbody=byId('v625RecognitionRows');
  if(tbody){tbody.replaceChildren();const labels={CE:'CE',CEAF:'CEAF空运',TBKH:'TBKH',ALI1688:'ALI1688',WHPP:'WHPP本土',SHOPEECN:'SHOPEE CN',SHOPEEVN:'SHOPEE VN'};const businesses=classification.businesses||[];
    if(!businesses.length)tbody.innerHTML='<tr><td colspan="4">暂无分类数据</td></tr>';
    else for(const row of businesses){const tr=document.createElement('tr');for(const value of [labels[row.businessType]||row.businessType,fmt(row.count),pct(row.share)]){const td=document.createElement('td');td.textContent=value;tr.appendChild(td)}const statusTd=document.createElement('td');const status=document.createElement('span');status.className='v625-recognition-status';status.textContent=row.status||'已分类';statusTd.appendChild(status);tr.appendChild(statusTd);tbody.appendChild(tr)}
  }

  if(!summary?.quickOnly){
  const timing=v803MergeFullWithExactTiming(summary?.timing||{},summary?.reportDate||requestedDate||'',summary?.snapshotId||'');
  const timingTrend=summary?.timingTrend||{};
  v801RenderTimingSummary(timing,summary?.reportDate||requestedDate||'');
  const timingRepairTypes=summary?.timingEvidenceRepair?.types||{};
  v741TimingRepairStates=timingRepairTypes;
  v700TimingAvailability=Object.fromEntries(Object.entries(timingRepairTypes).map(([type,state])=>[type,String(state?.status||'').toUpperCase()]));
  v631TimingMissing=Object.fromEntries(Object.entries(timing).map(([type,data])=>[type,data?.evidence?.missingBills||[]]));
  const timingMeta=[
    ['TBKH','v625TimingTBKH','#f4931b'],
    ['WHPP','v625TimingWHPP','#ef5757'],
    ['SHOPEECN','v625TimingSHOPEECN','#ef6a3a'],
    ['SHOPEEVN','v625TimingSHOPEEVN','#ed4b61']
  ];
  const showDays=value=>value===null||value===undefined?'—':Number(value).toFixed(2).replace(/\.00$/,'')+'天';
  let exhaustedMissingCount=0,repairableMissingCount=0,totalMissingCount=0;
  for(const [type,prefix,tone] of timingMeta){
    const data=timing[type]||{};
    const missingCount=Number(data.evidence?.missing||data.overall?.missingEvidenceCount||0);
    totalMissingCount+=missingCount;
    const exhausted=v700TimingAvailability[type]==='HISTORICAL_EVIDENCE_UNAVAILABLE'&&missingCount>0;
    if(exhausted)exhaustedMissingCount+=missingCount;
    else if(missingCount>0)repairableMissingCount+=missingCount;
    if(!exhausted&&missingCount===0&&Number(data.overall?.podCount||0)>0)v700TimingAvailability[type]='AVAILABLE';
    const totalPod=Number(data.overall?.totalPodCount||0);
    setText(prefix+'Overall',showDays(data.overall?.avgDays));
    const verifiedWhppTotal=type==='WHPP'?Number(v785WhppProofFor(summary?.reportDate||'')?.total??summary?.classification?.counts?.WHPP??0):0;
    const hasWhppSource=type==='WHPP'&&verifiedWhppTotal>0;
    setText(prefix+'Pod',totalPod===0
      ?(hasWhppSource?('WHPP '+fmt(verifiedWhppTotal)+'票；已确认POD 0票，暂不能计算签收天数。请核对WHPP只读终态诊断与后续日报签收时间。'):'当日无POD')
      :(exhausted
        ?('日报时效 '+fmt(data.overall?.podCount||0)+' / POD总数 '+fmt(totalPod)+' 票 · 待后续日报回补 '+fmt(missingCount))
        :('有效时效 '+fmt(data.overall?.podCount||0)+' / POD总数 '+fmt(totalPod)+' 票')));
    setText(prefix+'PP',showDays(data.pp?.avgDays));setText(prefix+'PPPod',fmt(data.pp?.podCount||0)+' / '+fmt(data.pp?.totalPodCount||0)+'票');
    setText(prefix+'PV',showDays(data.pv?.avgDays));setText(prefix+'PVPod',fmt(data.pv?.podCount||0)+' / '+fmt(data.pv?.totalPodCount||0)+'票');
    renderMiniTrend('v625TimingTrend'+type,timingTrend[type]||[],tone);
    setText('v626Timing'+type+'Missing',fmt(missingCount));
    setText('v626Timing'+type+'Valid',fmt(data.evidence?.valid||data.overall?.podCount||0));
    const missingButton=q('[data-timing-missing="'+type+'"]');
    if(missingButton){
      const counter=byId('v626Timing'+type+'Missing');
      for(const node of [...missingButton.childNodes])if(node!==counter)node.remove();
      missingButton.insertBefore(document.createTextNode(exhausted?'待后续日报回补 ':'待补轨迹 '),counter||null);
      missingButton.title=exhausted?'POD状态已确认；当前已上传日报还没有最终派件时间，后续日报出现该运单最新Y/POD记录后会自动回补签收天数。':'查看缺失轨迹明细';
    }
    if(['WHPP','SHOPEECN','SHOPEEVN'].includes(type)){
      const proof=v801VerifiedReturnsProof;
      const exact=proof?.reportDate===summary?.reportDate&&proof?.snapshotId===summary?.snapshotId
        ?proof?.returns?.[type]:null;
      const verified=exact?.verified===true&&Number.isFinite(Number(exact.count))
        &&Number.isFinite(Number(exact.total))&&Number(exact.count)>=0
        &&Number(exact.total)>=Number(exact.count);
      setText('v626Timing'+type+'Return',verified?fmt(exact.count):'待核验');
      setText('v626Timing'+type+'ReturnRate',verified&&Number(exact.total)>0?pct(Number(exact.count)/Number(exact.total)*100):'待核验');
    }
  }
  const timingRepairBtn=byId('v734TimingRepairNow');
  const noMoreRepair=totalMissingCount===0||(exhaustedMissingCount>0&&repairableMissingCount===0);
  if(timingRepairBtn){
    timingRepairBtn.disabled=noMoreRepair;
    timingRepairBtn.hidden=noMoreRepair;
    timingRepairBtn.style.setProperty('display',noMoreRepair?'none':'inline-flex','important');
  }
  setText('v625TimingPeriod',summary?.reportDate
    ?('统计日报 '+summary.reportDate+(totalMissingCount===0?' · 最新日报记录：下单时间→派件时间（含首日）':(noMoreRepair?' · 已读日报时效；缺失票等待后续日报自动回补':' · 日报派件时间 / 轨迹补充证据')))
    :'统计当前日报POD');

  }else{
    setText('v625TimingPeriod',summary?.selectionMatched===false?'所选日期暂无日报':'签收天数及退回统计后台核验中；业务导航可以立即使用');
  }
  const history=historyRows;
  renderTrend('v625HomeTrend',history.slice().reverse().map(r=>({label:r.reportDate,value:Object.values(r.classificationCounts||{}).reduce((a,b)=>a+Number(b||0),0)})));
  if(!options.skipAux){void refreshLiveProgress();void loadOpenPod()}
}

function timingMissingReason(code=''){
  return {POD_TRACK_TIME_MISSING:'缺少80/POD轨迹时间',DELIVERY_START_MISSING:'缺少60/70派送起点',INVALID_TRACK_TIME_RANGE:'轨迹时间顺序异常',TRACK_EVIDENCE_MISSING:'缺少完整轨迹证据'}[code]||code||'缺少完整轨迹证据';
}
async function runTimingRepairNow(){
  const btn=byId('v734TimingRepairNow');
  const missingTypes=Object.entries(v631TimingMissing||{}).filter(([,rows])=>(rows||[]).length>0);
  const repairable=missingTypes.some(([type])=>String(v700TimingAvailability?.[type]||'').toUpperCase()!=='HISTORICAL_EVIDENCE_UNAVAILABLE');
  if(missingTypes.length&&!repairable){
    if(btn){btn.disabled=true;btn.hidden=true;btn.style.setProperty('display','none','important')}
    const date=selectedReportDate()||v626LatestImport?.reportDate||'';
    setText('v625TimingPeriod','统计日报 '+date+' · 当前无需重复查接口；缺失票等待后续日报自动回补');
    return;
  }
  const latest=v626LatestImport||await latestImportContext();
  const reportDate=selectedReportDate()||latest?.reportDate||'';
  if(!reportDate){if(btn)btn.textContent='请先选择日报';return}
  if(btn){btn.disabled=true;btn.textContent='正在启动补证…'}
  setText('v625TimingPeriod','统计日报 '+reportDate+' · 正在补齐真实轨迹与已保存POD时间证据');
  try{
    const started=await post('/api/timing-repair/start',{reportDate},15000);
    const snapshotId=String(started?.snapshotId||latest?.snapshotId||'');
    for(let i=0;i<450;i++){
      const qs='?reportDate='+encodeURIComponent(reportDate)+(snapshotId?'&snapshotId='+encodeURIComponent(snapshotId):'');
      const status=await json('/api/timing-repair/status'+qs,15000);
      const states=Object.values(status?.states||{});
      const activeStates=states.filter(state=>['QUEUED','RUNNING'].includes(String(state?.status||'').toUpperCase()));
      const total=states.reduce((sum,state)=>sum+Number(state?.total||0),0);
      const done=states.reduce((sum,state)=>sum+Number(state?.completed||0),0);
      if(btn)btn.textContent=activeStates.length?('补证中 '+fmt(done)+'/'+fmt(total)):'补齐签收时效';
      if(!activeStates.length){
        await loadHome({skipAux:true});
        const exhausted=states.filter(state=>String(state?.status||'').toUpperCase()==='HISTORICAL_EVIDENCE_UNAVAILABLE').length;
        setText('v625TimingPeriod','统计日报 '+reportDate+(exhausted?' · 补证完成，部分运单无可用历史轨迹':' · 签收时效补证完成'));
        return;
      }
      await sleep(2000);
    }
    throw new Error('签收时效补证等待超过15分钟，请查看当前补证状态。');
  }catch(error){
    setText('v625TimingPeriod','统计日报 '+reportDate+' · 签收时效补证失败：'+String(error?.message||error));
  }finally{
    if(btn){btn.disabled=false;btn.textContent='补齐签收时效'}
  }
}

function renderTimingMissing(type){
  const rows=v631TimingMissing?.[type]||[],panel=byId('v631TimingMissingPanel'),tbody=byId('v631TimingMissingRows');if(!panel||!tbody)return;
  const historicalUnavailable=v700TimingAvailability?.[type]==='HISTORICAL_EVIDENCE_UNAVAILABLE';
  const repairState=v741TimingRepairStates?.[type]||{};
  const podConfirmedNoTime=historicalUnavailable&&Number(repairState.confirm85||0)>0&&Number(repairState.confirm85WithTime||0)===0;
  setText('v631TimingMissingTitle',(type==='SHOPEECN'?'SHOPEE CN':type==='SHOPEEVN'?'SHOPEE VN':type)+(historicalUnavailable?' 待后续日报回补':' 待补轨迹'));
  setText('v631TimingMissingMeta',(selectedReportDate()||byId('v625ToDate')?.value||'')+' · '+rows.length+' 票'+(historicalUnavailable?' · POD已确认，等待后续日报最终派件时间':''));
  tbody.replaceChildren();
  if(!rows.length)tbody.innerHTML='<tr><td colspan="4">当前没有待补轨迹运单</td></tr>';
  else for(const row of rows){
    const tr=document.createElement('tr');
    const exhaustedReason=podConfirmedNoTime?'POD已确认（orderStatus=85），当前已上传日报尚无最终派件时间；后续日报更新后自动回补':'POD已确认，当前日报尚无最终派件时间；后续日报更新后自动回补';
    for(const value of [row.shipmentCode,type,historicalUnavailable?exhaustedReason:timingMissingReason(row.reason)]){const td=document.createElement('td');td.textContent=value||'—';tr.appendChild(td)}
    const td=document.createElement('td'),a=document.createElement('a');
    a.href='/tracking?auth=v625&code='+encodeURIComponent(row.shipmentCode||'')+'&reportDate='+encodeURIComponent(selectedReportDate()||byId('v625ToDate')?.value||'')+'&businessType='+encodeURIComponent(type)+(historicalUnavailable?'&source=timing-backfill':'');
    a.textContent=historicalUnavailable?'查看轨迹/状态':'查看轨迹';td.appendChild(a);tr.appendChild(td);tbody.appendChild(tr);
  }
  panel.hidden=false;panel.scrollIntoView({behavior:'smooth',block:'start'});
}
let v628BusinessWorkspaceRows=[];
let v630BusinessDetailTabs={};
let v631BusinessAccounting={rowsByKind:{},total:0,accounted:0,difference:0};
function applyVerifiedBusinessKpis(kinds={},total=0,targetBusiness=''){
  const denominator=Number(total);
  const parts=['delivery','pod','returned','returning','pending','abnormal','otherNormal','unprocessed'];
  if(!Number.isSafeInteger(denominator)||denominator<=0)return false;
  if(parts.some(key=>!Number.isSafeInteger(Number(kinds[key]??0))||Number(kinds[key]??0)<0))return false;
  const assigned=parts.reduce((sum,key)=>sum+Number(kinds[key]||0),0);
  if(assigned!==denominator)return false;
  setText('kpiDelivery',fmt(kinds.delivery||0));
  setText('kpiPod',fmt(kinds.pod||0));
  setText('kpiPodRate',pct(Number(kinds.pod||0)*100/denominator));
  setText('kpiPending',fmt(kinds.pending||0));
  setText('kpiOtherNormal',fmt(kinds.otherNormal||0));
  if(['WHPP','SHOPEECN','SHOPEEVN'].includes(targetBusiness)){
    setText('kpiReturned',fmt(kinds.returned||0));
    setText('kpiReturnRate',pct(Number(kinds.returned||0)*100/denominator));
  }
  return true;
}
let v628BusinessMetricState={};
let v628BusinessReportDate='';
let v748QualityRows={shopArrived:[],pendingGap:[],oc2Plus:[]};
const v748QualityRefreshKeys=new Set();
function businessTypeMatches(row){
  const t=String(row?.businessType||'').toUpperCase();
  return business.startsWith('SHOPEE')?t===business||t===business.replace('SHOPEE',''):t===business;
}
function tabRows(...keys){
  for(const key of keys){
    const value=v630BusinessDetailTabs?.[key];
    if(Array.isArray(value))return value;
    if(Array.isArray(value?.rows))return value.rows;
  }
  return [];
}
function detailCode(row={}){return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase()}
function uniqueDetailRows(rows=[]){const map=new Map();for(const row of rows){const code=detailCode(row);if(code&&!map.has(code))map.set(code,row)}return[...map.values()]}
function rowText(row={}){return [row.primaryCategory,row.主分类,row.异常分类,row.currentState,row.scanNormalizedState,row.退回状态,row.specialState,row.shopState,row.最后节点,row.latestEventDesc,row.QC判断].map(v=>String(v||'')).join(' ').toUpperCase()}
function rowTmsStatus(row={}){return String(row?.shipmentStatus??row?.shipmentTrack?.shipmentStatus??'').trim()}
function rowHasTmsConflict(row={}){
  const code=rowTmsStatus(row),state=String(row?.currentState||'').trim().toUpperCase();
  return row?.shipmentStatusConflict===true||row?.truthEvidence?.tmsContradiction===true
    ||state==='PENDING_VERIFICATION'
    ||(code==='60'&&['RETURNED','RETURN_COMPLETED','RETURN_IN_PROGRESS','RETURNING'].includes(state))
    ||(code==='81'&&state==='POD')
    ||(code==='80'&&['POD','RETURNED','RETURN_COMPLETED'].includes(state));
}
function rowIsPod(row={}){
  if(rowHasTmsConflict(row))return false;
  const code=rowTmsStatus(row);
  if(code==='60')return true;
  if(code==='80'||code==='81')return false;
  const text=rowText(row);
  return row.是否POD==='是'||String(row.orderStatus||'')==='85'
    ||/(^|\s)(POD|已签收|签收成功|已妥投|DELIVERED|SIGNED)(\s|$)/i.test(text)&&!/未签收|未妥投|签收失败/.test(text);
}
function rowIsReturned(row={}){
  if(rowHasTmsConflict(row))return false;
  const code=rowTmsStatus(row);
  if(code==='81')return true;
  if(code==='60'||code==='80')return false;
  const text=rowText(row);
  return !/未退回|非退回|待退回|退回处理中|NOT_RETURNED|PENDING_RETURN/i.test(text)
    &&/(已退回|退回完成|RETURN_COMPLETED|RETURNED)/i.test(text);
}
// TMS shipmentStatus 80 is RETURNING, never signed or completed return.
// Do not read tracking eventCode 80 here: that code means POD in a different API.
function rowIsReturning(row={}){
  if(rowHasTmsConflict(row))return false;
  const code=rowTmsStatus(row);
  if(code==='80')return true;
  if(code==='60'||code==='81')return false;
  const state=String(row?.currentState||'').trim().toUpperCase();
  return state==='RETURN_IN_PROGRESS'||state==='RETURNING'
    ||/^(退回中|退回处理中|正在退回|返仓途中)$/.test(String(row?.退回状态||'').trim());
}
function rowIsPending(row={}){return Number(row.Pending次数||row.Pending天数||row.pendingDistinctDayCount||0)>0||/(^|\s)PENDING(\s|$)|Pending/i.test(rowText(row))}
function rowIsAbnormal(row={}){
  const text=rowText(row);
  return Number(row.OC天数||row.ocDays||0)>0||Number(row.盘点天数||row.盘点次数||0)>0||
    row.入库无扫描节点==='是'||/(OC|异常|盘点|工单|入库无扫描|节点未更新|无轨迹|失败待重试|严重超时|滞留)/i.test(text);
}
function rowIsOtherNormal(row={}){
  const text=rowText(row),special=String(row.specialState||'').toUpperCase(),shop=String(row.shopState||'').toUpperCase();
  return ['SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION','CCSL580_DIVERSION'].includes(special)||
    row.matchedRule==='NORMAL_FINAL_HUB'||/正常分流|自提|CECN|CEZT|580/.test(text)||
    /^SHOP_/.test(shop)||/门店途中|到达门店|门店入库/.test(text)||/订单取消|已取消|CANCELLED|CANCELED/.test(text);
}
function buildWhppCanonicalAccounting(state={},fallback={}){
  const tabs=state?.detailTabs||state?.dashboard?.detailTabs||{};
  const metrics=state?.dashboard?.metrics||{};
  const all=uniqueDetailRows(tabs?.all?.rows||[]);
  const unresolved=uniqueDetailRows(tabs?.unresolved?.rows||[]);
  const conflicted=uniqueDetailRows([...all,...unresolved].filter(rowHasTmsConflict));
  const conflictBills=new Set(conflicted.map(detailCode));
  // The all-member row is the canonical source for direct TMS 60/80/81.
  // Individual POD/return tabs can lag behind it after a terminal refresh.
  const allByCode=new Map(all.map(row=>[detailCode(row),row]));
  const directKinds=new Set(['60','80','81']);
  const allowedTerminal=(row,wanted)=>{
    const current=allByCode.get(detailCode(row));
    const currentStatus=rowTmsStatus(current||{});
    const rowStatus=rowTmsStatus(row);
    if(rowHasTmsConflict(current||row)||rowHasTmsConflict(row))return false;
    if(directKinds.has(currentStatus)&&currentStatus!==wanted)return false;
    if(directKinds.has(rowStatus)&&rowStatus!==wanted)return false;
    return true;
  };
  const returning=uniqueDetailRows([
    ...all.filter(rowIsReturning),
    ...unresolved.filter(rowIsReturning),
    ...(tabs?.returnInProgress?.rows||[]).filter(rowIsReturning),
    ...(tabs?.returning?.rows||[]).filter(rowIsReturning)
  ]).filter(row=>allowedTerminal(row,'80'));
  const returningBills=new Set(returning.map(detailCode));
  for(const code of conflictBills)returningBills.add(code);
  const excludeReturning=rows=>uniqueDetailRows(rows||[]).filter(row=>!returningBills.has(detailCode(row)));
  // Promote explicitly verified terminal states from the canonical all-tab.
  // Otherwise a stale POD tab can display a newer 81 as still signed, or a
  // newer 60 can be invisible when the POD tab has not caught up.
  const pod=uniqueDetailRows([
    ...all.filter(row=>rowTmsStatus(row)==='60'&&allowedTerminal(row,'60')),
    ...excludeReturning(tabs?.pod?.rows).filter(row=>allowedTerminal(row,'60'))
  ]);
  const podBills=new Set(pod.map(detailCode));
  const returned=uniqueDetailRows([
    ...all.filter(row=>rowTmsStatus(row)==='81'&&allowedTerminal(row,'81')),
    ...excludeReturning(tabs?.returned?.rows).filter(row=>allowedTerminal(row,'81'))
  ]).filter(row=>!podBills.has(detailCode(row)));
  const terminalBills=new Set([...returning,...pod,...returned,...conflicted].map(detailCode));
  const excludeTerminal=rows=>uniqueDetailRows(rows||[]).filter(row=>!terminalBills.has(detailCode(row)));
  const cancelled=excludeTerminal(tabs?.cancelled?.rows);
  const normalDiversion=excludeTerminal(tabs?.normalDiversion?.rows);
  const shops=excludeTerminal([
    ...(tabs?.phnomPenhShop?.rows||[]),
    ...(tabs?.provinceShop?.rows||[]),
    ...(tabs?.unknownShop?.rows||[])
  ]);
  const assigned=new Set([...returning,...pod,...returned,...cancelled,...normalDiversion,...shops].map(detailCode));
  const pending=[],abnormal=[],delivery=[],unprocessed=[];
  for(const row of unresolved){
    if(assigned.has(detailCode(row)))continue;
    if(rowHasTmsConflict(row)){unprocessed.push(row);assigned.add(detailCode(row));continue;}
    if(rowIsPending(row))pending.push(row);
    else if(rowIsAbnormal(row))abnormal.push(row);
    else if(Number(row.派送中停留天数||row.派送中天数||0)>0||/派送中/.test(rowText(row)))delivery.push(row);
    else unprocessed.push(row);
    assigned.add(detailCode(row));
  }
  for(const row of all){
    const code=detailCode(row);
    if(code&&!assigned.has(code)){unprocessed.push(row);assigned.add(code)}
  }
  const otherNormal=uniqueDetailRows([...cancelled,...normalDiversion,...shops]);
  const rowsByKind={total:all,pod,returned,returning,pending,abnormal,otherNormal,delivery,unprocessed};
  const total=Number(metrics.total||fallback.total||all.length||0);
  const accounted=['pod','returned','returning','pending','abnormal','otherNormal','delivery','unprocessed'].reduce((n,key)=>n+rowsByKind[key].length,0);
  return{total,accounted,difference:total-accounted,rowsByKind,canonical:true};
}
function buildBusinessAccounting(state={},fallback={}){
  const authoritativeRows=
    (Array.isArray(state.finalRows)&&state.finalRows.length?state.finalRows:null)||
    state?.detailTabs?.all?.rows||
    state?.detailTabs?.allData?.rows||
    state?.detailTabs?.dashboard?.rows||
    [];
  const source=uniqueDetailRows(authoritativeRows||[]);
  const total=Number(fallback.total||source.length||0);
  if(!source.length)return{total,accounted:0,difference:total,rowsByKind:{total:[],pod:[],returned:[],returning:[],pending:[],abnormal:[],otherNormal:[],delivery:[],unprocessed:[]}};
  const rowsByKind={total:source,pod:[],returned:[],returning:[],pending:[],abnormal:[],otherNormal:[],delivery:[],unprocessed:[]};
  const returnCapable=['WHPP','SHOPEECN','SHOPEEVN'].includes(business);
  for(const row of source){
    if(rowHasTmsConflict(row))rowsByKind.unprocessed.push(row);
    // Return states are only defined for WHPP/Shopee. On other businesses,
    // preserve the parcel as a visible verification exception instead of
    // hiding it in an undisplayed return slice or mislabelling it as delivery.
    else if(!returnCapable&&(rowIsReturning(row)||rowIsReturned(row)))rowsByKind.unprocessed.push(row);
    else if(returnCapable&&rowIsReturning(row))rowsByKind.returning.push(row);
    else if(row.finalRowAvailable===false)rowsByKind.unprocessed.push(row);
    else if(rowIsPod(row))rowsByKind.pod.push(row);
    else if(returnCapable&&rowIsReturned(row))rowsByKind.returned.push(row);
    else if(rowIsPending(row))rowsByKind.pending.push(row);
    else if(rowIsAbnormal(row))rowsByKind.abnormal.push(row);
    else if(rowIsOtherNormal(row))rowsByKind.otherNormal.push(row);
    else rowsByKind.delivery.push(row);
  }
  const accounted=['pod','returned','returning','pending','abnormal','otherNormal','delivery','unprocessed'].reduce((n,key)=>n+rowsByKind[key].length,0);
  return{total:total||source.length,accounted,difference:(total||source.length)-accounted,rowsByKind};
}
function v628MetricRows(kind){
  if(['shopArrived','pendingGap','oc2Plus'].includes(kind)){
    const quality=v748QualityRows?.[kind];
    return Array.isArray(quality)?quality:[];
  }
  const exact=v631BusinessAccounting?.rowsByKind?.[kind];
  if(Array.isArray(exact)&&exact.length)return exact;
  if(kind==='total'&&Array.isArray(v631BusinessAccounting?.rowsByKind?.total))return v631BusinessAccounting.rowsByKind.total;
  return [];
}
// V788: keep drilldown DOM bounded while retaining the full canonical count.
const V788_KPI_PAGE_SIZE=100;
let v788KpiKind='',v788KpiPage=0;
function renderKpiDetail(kind,requestedPage=0,shouldScroll=true){
  const panel=byId('v628KpiDetailPanel'),tbody=byId('v628KpiDetailRows');if(!panel||!tbody)return;
  const labels={total:'总票数',delivery:'派送中',pod:'已签收(POD)',pending:'Pending',abnormal:'异常',returned:'已退回',returning:'退回中',otherNormal:'其他正常状态',unprocessed:'待处理',shopArrived:'到达门店',pendingGap:'Pending不连续',oc2Plus:'OC 2天+'};
  const rows=v628MetricRows(kind);
  const pages=Math.max(1,Math.ceil(rows.length/V788_KPI_PAGE_SIZE));
  const pageIndex=Math.min(pages-1,Math.max(0,Math.trunc(Number(requestedPage)||0)));
  const start=pageIndex*V788_KPI_PAGE_SIZE;
  const visible=rows.slice(start,start+V788_KPI_PAGE_SIZE);
  v788KpiKind=kind;v788KpiPage=pageIndex;
  const prev=byId('v788KpiDetailPrevious'),next=byId('v788KpiDetailNext');
  if(prev)prev.disabled=pageIndex===0||rows.length===0;
  if(next)next.disabled=pageIndex>=pages-1||rows.length===0;
  qa('[data-kpi-detail]').forEach(el=>el.classList.toggle('active',el.dataset.kpiDetail===kind));
  setText('v628KpiDetailTitle',(labels[kind]||'指标')+'明细');
  setText('v628KpiDetailMeta',v628BusinessReportDate+' · '+business+' · 共 '+rows.length+' 票'+
    (rows.length?' · 显示 '+(start+1)+'–'+(start+visible.length)+' 票 · 第 '+(pageIndex+1)+'/'+pages+' 页':''));
  tbody.replaceChildren();
  if(!rows.length)tbody.innerHTML='<tr><td colspan="7">'+
    (Number(v628BusinessMetricState?.[kind]??0)>0?'指标有票数，但缺少对应逐票证据；不能视为0票。':'当前指标暂无对应运单。')+
    '</td></tr>';
  else for(const row of visible){
    const tr=document.createElement('tr');
    const code=detailCode(row);
    const qualityStatus=kind==='shopArrived'
      ?('到达门店'+(row.shopName||row.shopCode?' · '+[row.shopName,row.shopCode].filter(Boolean).join(' / '):''))
      :kind==='pendingGap'
        ?('Pending不连续 · '+fmt(row.pendingDistinctDayCount||0)+'个自然日')
        :kind==='oc2Plus'
          ?('OC '+fmt(row.ocDays||0)+'天')
          :'';
    const status=qualityStatus||row.category||row.primaryCategory||row.主分类||row.异常分类||row.latestNode||row.最后节点||row.queryStatus||row.scanStatus||row.currentState||'—';
    const latestNode=row.latestNode||row.latestEventDesc||row.最后节点||row.lastEventDesc||(kind==='shopArrived'?(row.shopName||row.shopCode||'门店到达'):'—');
    const latestTime=(kind==='shopArrived'?(row.shopArrivedAt||''):'')||row.latestTime||row.latestEventTime||row.最后节点时间||row.lastEventTime||'—';
    const region=row.region||row.regionCode||row.区域||'—';
    for(const value of [code,row.businessType||business,region,status,latestNode,latestTime]){
      const td=document.createElement('td');td.textContent=value||'—';tr.appendChild(td);
    }
    const action=document.createElement('td'),a=document.createElement('a');
    if(code){
      a.href='/tracking?auth=v625&code='+encodeURIComponent(code)+'&reportDate='+encodeURIComponent(v628BusinessReportDate||'')+'&businessType='+encodeURIComponent(business);
      a.textContent='查看该票轨迹';action.appendChild(a);
    }else action.textContent='无运单号 · 待核验';
    tr.appendChild(action);tbody.appendChild(tr);
  }
  panel.hidden=false;
  if(shouldScroll)panel.scrollIntoView({behavior:'smooth',block:'start'});
}
function applyV748QualitySignals(payload={}){
  const q=payload.qualitySignals||{};
  v748QualityRows={
    shopArrived:Array.isArray(payload.qualityRows?.shopArrived)?payload.qualityRows.shopArrived.filter(businessTypeMatches):[],
    pendingGap:Array.isArray(payload.qualityRows?.pendingGap)?payload.qualityRows.pendingGap.filter(businessTypeMatches):[],
    oc2Plus:Array.isArray(payload.qualityRows?.oc2Plus)?payload.qualityRows.oc2Plus.filter(businessTypeMatches):[]
  };
  setText('kpiShopArrived',fmt(q.shopArrived||0));
  setText('kpiPendingGap',fmt(q.pendingGap||0));
  setText('kpiOc2Plus',fmt(q.oc2Plus||0));
}
async function refreshV748BusinessTrackQuality(reportDate=''){
  const date=String(reportDate||'').slice(0,10);
  if(!date||!business)return;
  const key=business+'|'+date;
  if(v748QualityRefreshKeys.has(key))return;
  v748QualityRefreshKeys.add(key);
  setText('v748QualityRefreshMeta','正在按 '+business+' 未终态运单精准补抓最新轨迹…');
  try{
    const requestedBusiness=business;
    const started=await post('/api/v246/tracking/reconcile',{businessType:requestedBusiness,fromDate:date,toDate:date},30000);
    const jobId=String(started?.job?.jobId||'');
    if(!jobId)throw new Error('轨迹补抓任务未返回任务号');
    const actualBusiness=String(started?.job?.selection?.businessType||requestedBusiness).toUpperCase();
    const actualFrom=String(started?.job?.selection?.fromDate||date).slice(0,10);
    const actualTo=String(started?.job?.selection?.toDate||date).slice(0,10);
    const sameTarget=actualBusiness===requestedBusiness&&actualFrom===date&&actualTo===date;
    if(!sameTarget)setText('v748QualityRefreshMeta','另一板块轨迹任务正在执行，完成后自动继续 '+requestedBusiness+'…');
    for(let i=0;i<900;i++){
      const r=await json('/api/v246/tracking/job/'+encodeURIComponent(jobId),12000);
      const job=r.job||{};
      const status=String(job.status||'').toUpperCase();
      if(['COMPLETED','FAILED'].includes(status)){
        if(status==='FAILED')throw new Error(job.error||job.message||'精准轨迹补抓失败');
        if(!sameTarget){
          v748QualityRefreshKeys.delete(key);
          if(page==='business'&&business===requestedBusiness)setTimeout(()=>void refreshV748BusinessTrackQuality(date),800);
          return;
        }
        setText('v748QualityRefreshMeta','轨迹补抓完成 · 成功 '+fmt(job.refreshed||0)+' 票 · 待重试 '+fmt(job.failed||0)+' 票');
        await loadBusiness({skipQualityRefresh:true});
        return;
      }
      setText('v748QualityRefreshMeta',job.message||('精准补抓中 '+fmt(job.completed||0)+'/'+fmt(job.total||0)));
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
    throw new Error('精准轨迹补抓等待超时');
  }catch(error){
    v748QualityRefreshKeys.delete(key);
    const msg=String(error?.message||error);
    setText('v748QualityRefreshMeta',/其他业务任务运行/.test(msg)?'当前有业务任务运行，稍后自动/重新进入看板会继续补抓':'轨迹补抓暂未完成：'+msg);
  }
}
const v765BoardDetailInflight=new Map();
const v765BoardDetailCache=new Map();
let v765BoardLoadGeneration=0;
async function v765LoadBusinessDetailLane({reportDate,snapshotId,m,options,generation,targetBusiness}){
  // Do not make a large business-details query compete with the first KPI
  // paint. A short deferred task allows layout and user navigation first.
  await new Promise(resolve=>setTimeout(resolve,350));
  const stillSelected=()=>page==='business'&&business===targetBusiness
    &&generation===v765BoardLoadGeneration
    &&String(v628BusinessReportDate||'')===reportDate;
  if(!stillSelected())return;
  const cacheKey=targetBusiness+'|'+reportDate+'|'+snapshotId;
  let cached=v765BoardDetailCache.get(cacheKey);
  let detail;
  try{
    if(!options.skipQualityRefresh&&cached&&Date.now()-cached.at<20000){
      detail=cached.result;
    }else{
      let pending=v765BoardDetailInflight.get(cacheKey);
      if(!pending){
        const integrityQuery=new URLSearchParams({businessType:targetBusiness});
        if(snapshotId)integrityQuery.set('snapshotId',snapshotId);
        if(reportDate)integrityQuery.set('reportDate',reportDate);
        const workspaceQuery=new URLSearchParams({scope:'all',businessType:targetBusiness});
        if(snapshotId)workspaceQuery.set('snapshotId',snapshotId);
        if(reportDate)workspaceQuery.set('reportDate',reportDate);
        if(options.skipQualityRefresh)workspaceQuery.set('fresh','1');
        pending=Promise.allSettled([
          json('/api/data-integrity?'+integrityQuery.toString(),10000),
          json('/api/tracking-workspace?'+workspaceQuery.toString(),10000)
        ]).finally(()=>v765BoardDetailInflight.delete(cacheKey));
        v765BoardDetailInflight.set(cacheKey,pending);
      }
      const settled=await pending;
      detail={
        integrity:settled[0].status==='fulfilled'?settled[0].value:null,
        workspace:settled[1].status==='fulfilled'?settled[1].value:{rows:[]}
      };
      // Never cache failed/partial fetches. Retain at most two recent board
      // detail sets, only in process memory, never in C:/D: or localStorage.
      if(settled.every(item=>item.status==='fulfilled')){
        v765BoardDetailCache.delete(cacheKey);
        v765BoardDetailCache.set(cacheKey,{at:Date.now(),result:detail});
        while(v765BoardDetailCache.size>2)v765BoardDetailCache.delete(v765BoardDetailCache.keys().next().value);
      }
    }
    if(!stillSelected())return;
    const integrityR={status:detail.integrity?'fulfilled':'rejected',value:detail.integrity};
    const workspaceR={status:detail.workspace?'fulfilled':'rejected',value:detail.workspace};
    const integrity=integrityR.status==='fulfilled'?integrityR.value:null;
    const bi=integrity?.businesses?.[business];
    if(bi){
      setText('v637BusinessIntegrity','源票 '+fmt(bi.sourceCount)+' · 已进入处理 '+fmt(bi.stateMemberCount)+' · 已扫描 '+fmt(bi.scanCount)+' · 待扫描 '+fmt(bi.waitingScan)+' · 已归类 '+fmt(bi.accounted)+' · 差异 '+fmt(bi.difference));
      const whppScanBtn=byId('v641WhppScanPending');
      if(whppScanBtn){
        const waiting=Number(bi.waitingScan||0);
        const showWhppScan=business==='WHPP'&&waiting>0;
        whppScanBtn.hidden=!showWhppScan;
        whppScanBtn.style.setProperty('display',showWhppScan?'inline-flex':'none','important');
        whppScanBtn.textContent=waiting>0?'扫描WHPP待处理 '+fmt(waiting)+' 票':'扫描WHPP待处理票';
      }
    }

    const wr=workspaceR.status==='fulfilled'?workspaceR.value:{rows:[]};
    v628BusinessWorkspaceRows=(wr.rows||[]).filter(businessTypeMatches);
    if(targetBusiness==='WHPP')v800RenderWhppDetails(v628BusinessWorkspaceRows,Number(wr.allRowCount||0)>v628BusinessWorkspaceRows.length);
    applyV748QualitySignals(wr);
    const workspaceAllCount=Number(wr.allRowCount||v628BusinessWorkspaceRows.length);
    const workspaceTruncated=workspaceAllCount>v628BusinessWorkspaceRows.length;
    if(bi){
      setText('v631AccountingMeta','已归类 '+fmt(bi.accounted)+' / '+fmt(bi.sourceCount)+' · 差异 '+fmt(Math.abs(Number(bi.difference||0))));
    }
    if(v628BusinessWorkspaceRows.length&&!workspaceTruncated){
      const detailed=buildBusinessAccounting({finalRows:v628BusinessWorkspaceRows},m);
      v631BusinessAccounting=detailed;
      // Only complete, untruncated selected-date member sets can overwrite
      // compact board metrics. Partial workspace previews never change KPIs.
      if(Number(wr.allRowCount||0)===Number(m.total)
         &&detailed.rowsByKind.total.length===Number(m.total)
         &&detailed.accounted===Number(m.total)){
        const complete=Object.fromEntries(['delivery','pod','returned','returning','pending','abnormal','otherNormal','unprocessed']
          .map(key=>[key,detailed.rowsByKind[key]?.length||0]));
        if(applyVerifiedBusinessKpis(complete,m.total,targetBusiness)){
          renderDonut({total:m.total,...complete});
        }
      }
      if(!bi)setText('v631AccountingMeta','已归类 '+fmt(detailed.accounted)+' / '+fmt(m.total)+' · 差异 '+fmt(Math.max(0,m.total-detailed.accounted)));
    }
    if(!options.skipQualityRefresh){
      const openCount=Number(wr?.summary?.actionable ?? v628BusinessWorkspaceRows.filter(row=>row.isActionable).length);
      if(openCount>0){
        // Track reconciliation is a background update, not navigation work.
        // Repeated routes in a single browsing session reuse their 2h refresh
        // window; manual "更新未完成POD" always remains available.
        const qualityKey='CE_QC_V765_TRACK_'+targetBusiness+'|'+reportDate+'|'+snapshotId;
        let recent=0;
        try{recent=Number(sessionStorage.getItem(qualityKey)||0)}catch{}
        if(Date.now()-recent>=2*60*60*1000){
          try{sessionStorage.setItem(qualityKey,String(Date.now()))}catch{}
          setTimeout(()=>{
            if(stillSelected())void refreshV748BusinessTrackQuality(reportDate);
          },2500);
        }else setText('v748QualityRefreshMeta','轨迹近期已更新；可手动刷新未完成POD');
      }
      else setText('v748QualityRefreshMeta','当前无未终态运单，无需轨迹补抓');
    }
    const rows=v628BusinessWorkspaceRows.filter(x=>x.isActionable).slice(0,8);
    const tbody=byId('v625BusinessRows');tbody.replaceChildren();
    if(!rows.length){tbody.innerHTML='<tr><td colspan="7">当前日报暂无异常记录</td></tr>'}
    else for(const row of rows){tbody.appendChild(v788BusinessAbnormalRow(row,reportDate,targetBusiness))}
  }catch(error){
    if(stillSelected())setText('v631AccountingMeta','明细暂未就绪：'+String(error?.message||error));
  }
}
async function loadBusiness(options={}){
  // A prior business/date request is never allowed to paint a newer route,
  // including the slow full timing fallback and detail hydration lane.
  const generation=++v765BoardLoadGeneration;
  const targetBusiness=business;
  const stillSelected=()=>page==='business'&&business===targetBusiness&&
    generation===v765BoardLoadGeneration;
  // V756 navigation-first: URL context is authoritative for first paint.
  // Never block a board switch on /api/import/unified-latest before asking for its compact state.
  const whppOnlyAction=byId('v641WhppScanPending');
  if(whppOnlyAction){whppOnlyAction.hidden=true;whppOnlyAction.style.setProperty('display','none','important');}
  try{
    const params=new URLSearchParams(location.search);
    const requestedDate=params.get('reportDate')||params.get('toDate')||params.get('fromDate')||'';
    const requestedSnapshot=params.get('snapshotId')||'';
    const latest=v626LatestImport||null;
    const baseReportDate=requestedDate||latest?.reportDate||'';
    const stateQuery=new URLSearchParams({compact:'1'});
    if(requestedSnapshot)stateQuery.set('snapshotId',requestedSnapshot);
    if(baseReportDate)stateQuery.set('reportDate',baseReportDate);
    const summaryQuery=new URLSearchParams({fast:'1'});
    if(baseReportDate)summaryQuery.set('reportDate',baseReportDate);
    if(requestedSnapshot)summaryQuery.set('snapshotId',requestedSnapshot);
    // Keep expensive historical timing away from compact KPI first paint.
    const summaryPromise=new Promise(resolve=>setTimeout(resolve,900))
      .then(()=>json('/api/home-quality-summary?'+summaryQuery.toString(),10000).catch(()=>null));

    const r=await json('/api/business-state/'+targetBusiness+'?'+stateQuery.toString(),10000);
    if(!stillSelected())return;
    const responseDate=String(r.reportDate||'').slice(0,10);
    const responseSnapshot=String(r.snapshotId||'');
    if(baseReportDate&&responseDate&&responseDate!==baseReportDate)
      throw new Error('业务快照返回日期与当前选择不一致，已停止渲染');
    if(requestedSnapshot&&responseSnapshot&&responseSnapshot!==requestedSnapshot)
      throw new Error('业务快照与当前选择的快照ID不一致，已停止渲染');
    const state=r.state||{},m=metricState(state);
    const snapshotId=r.snapshotId||requestedSnapshot||latest?.snapshotId||'';
    const reportDate=r.reportDate||baseReportDate||latest?.reportDate||'';
    v626LatestImport={...(v626LatestImport||{}),reportDate,snapshotId};
    syncDashboardNavigationContext(reportDate,snapshotId);
    v630BusinessDetailTabs=state.detailTabs||state?.dashboard?.detailTabs||{};
    v631BusinessAccounting=state.accounting?.rowsByKind
      ? state.accounting
      : {total:m.total,accounted:state.snapshotStatus==='COMPLETED'?m.total:0,difference:state.snapshotStatus==='COMPLETED'?0:m.total,rowsByKind:{total:[],pod:[],returned:[],pending:[],abnormal:[],otherNormal:[],delivery:[],unprocessed:[]}};
    v628BusinessMetricState=m;v628BusinessReportDate=reportDate;
    if(targetBusiness==='WHPP'&&reportDate){
      // Start history after the KPI paint; seven read-only canonical dates
      // must not compete with the selected-date first response.
      setTimeout(()=>{
        if(stillSelected()&&String(v628BusinessReportDate||'')===String(reportDate))
          void v800LoadWhppTrend(reportDate);
      },1200);
    }
    if(reportDate&&!selectedReportDate())applyDashboardDate(reportDate);
    if(reportDate){byId('v625FromDate')&&(byId('v625FromDate').value=reportDate);byId('v625ToDate')&&(byId('v625ToDate').value=reportDate)}

    const fastCounts={
      delivery:Number(m.delivery||0),
      pod:Number(m.pod||0),
      pending:Number(m.pending||0),
      abnormal:Number(m.unresolved||0),
      returned:Number(m.returned||0),returning:Number(m.returning||0),
      otherNormal:Number(m.otherNormal||0),
      unprocessed:Math.max(0,Number(m.total||0)-Number(m.pod||0)-Number(m.returned||0)-Number(m.returning||0)-Number(m.otherNormal||0)-Number(m.delivery||0))
    };
    const a=v631BusinessAccounting;
    const accountingCounts=a.counts||Object.fromEntries(Object.entries(a.rowsByKind||{}).map(([k,v])=>[k,Array.isArray(v)?v.length:Number(v||0)]));
    const accountingObserved=Object.values(accountingCounts).reduce((sum,value)=>sum+Number(value||0),0);
    const counts=accountingObserved>0?accountingCounts:fastCounts;

    setText('kpiTotal',fmt(m.total||a.total));setText('kpiDelivery',fmt(counts.delivery??m.delivery));setText('kpiPod',fmt(counts.pod??m.pod));
    setText('kpiPodRate',Number(m.total)>0?pct(Number(m.pod||0)*100/Number(m.total)):'—');
    setText('kpiPending',fmt(counts.pending??m.pending));setText('kpiOpen',fmt(m.unresolved));setText('kpiOc',fmt(m.oc));
    if(targetBusiness==='WHPP')v800SetWhppMetrics(m);
    setText('v631AccountingMeta',state.snapshotStatus==='COMPLETED'
      ?('当前日报 '+fmt(m.total)+' 票 · 快速看板已就绪')
      :'正式结果仍在处理中');
    setText('kpiAvgDays',m.avgDays==null||(m.pod>0&&Number(m.avgDays)<=0)?'—':Number(m.avgDays).toFixed(2).replace(/\.00$/,''));
    const returnCapable=['WHPP','SHOPEECN','SHOPEEVN'].includes(business);
    if(byId('kpiReturnedCard'))byId('kpiReturnedCard').hidden=!returnCapable;if(byId('kpiReturnRateCard'))byId('kpiReturnRateCard').hidden=!returnCapable;
    if(returnCapable){setText('kpiReturned',fmt(m.returned||0));setText('kpiReturnRate',Number(m.total)>0?pct(Number(m.returned||0)*100/Number(m.total)):'—')}
    if(byId('kpiOtherCard')){byId('kpiOtherCard').hidden=false;setText('kpiOtherNormal',fmt(m.otherNormal||0))}
    if(byId('kpiUnprocessedCard')){byId('kpiUnprocessedCard').hidden=true;setText('kpiUnprocessed',fmt(0))}
    // Prefer disjoint exact-member accounting. OC and Pending KPIs can be
    // overlapping risk flags, so they must not be summed into a status donut.
    const disjointKinds=['delivery','pod','returned','returning','pending','abnormal','otherNormal','unprocessed'];
    const exactRows=a.rowsByKind||{};
    const hasExactRows=disjointKinds.some(key=>Array.isArray(exactRows[key])&&exactRows[key].length>0);
    const exactCounts=Object.fromEntries(disjointKinds.map(key=>[key,Array.isArray(exactRows[key])?exactRows[key].length:0]));
    const exactSum=disjointKinds.reduce((sum,key)=>sum+exactCounts[key],0);
    const verifiedAccounting=hasExactRows&&exactSum===Number(m.total||0);
    // Preserve V636 compact first paint while detail/accounting hydrates.
    // Risk indicators are deliberately not included in provisional slices.
    renderDonut({total:m.total,delivery:m.delivery||0,pod:m.pod||0,returned:m.returned||0,returning:m.returning||0,pending:0,abnormal:0,otherNormal:0,unprocessed:0});
    if(verifiedAccounting){
      renderDonut({
        total:m.total,delivery:exactCounts.delivery,pod:exactCounts.pod,
        returned:exactCounts.returned,returning:exactCounts.returning,pending:exactCounts.pending,
        abnormal:exactCounts.abnormal,
        otherNormal:exactCounts.otherNormal,unprocessed:exactCounts.unprocessed
      });
      // Keep displayed POD/returned ratios in lockstep with exact member status.
      applyVerifiedBusinessKpis(exactCounts,m.total,business);
    }

    // Fast summary/timing updates are useful, but never gate the board's first paint.
    void summaryPromise.then(summary=>{
      if(!summary||!stillSelected()||
        String(v628BusinessReportDate||'').slice(0,10)!==String(reportDate).slice(0,10))return;
      const evidenceState=state?.historicalEvidenceRecovery?.state||summary?.historicalEvidenceRecovery?.state||'';
      const timingRepairRunning=Boolean(summary?.timingEvidenceRepair?.active);
      if(evidenceState==='RUNNING'||timingRepairRunning)scheduleHistoricalEvidenceRefresh('business');
      else if(evidenceState==='COMPLETED'||summary?.timingEvidenceRepair)stopHistoricalEvidenceRefresh();
      const timing=summary?.reportDate===reportDate?summary?.timing?.[business]:null;
      if(targetBusiness==='WHPP'&&timing)v800SetWhppMetrics(m,timing);
      if(timing?.overall?.avgDays!=null&&Number.isFinite(Number(timing.overall.avgDays))){
        setText('kpiAvgDays',Number(timing.overall.avgDays).toFixed(2).replace(/\.00$/,''));
      }else if(m.pod>0&&['TBKH','WHPP','SHOPEECN','SHOPEEVN'].includes(business)){
        // The compact/fast home response may omit signing timing. The main board
        // must use the same full selected-date timing source as the overview,
        // without blocking the initial business-card render.
        const fullTimingQuery=new URLSearchParams(summaryQuery);
        fullTimingQuery.delete('fast');
        void json('/api/home-quality-summary?'+fullTimingQuery.toString(),25000).then(full=>{
          const sameDate=full?.reportDate===reportDate;
          const currentDate=String(byId('v625FromDate')?.value||'').slice(0,10)===reportDate;
          const days=sameDate?full?.timing?.[targetBusiness]?.overall?.avgDays:null;
          if(targetBusiness==='WHPP'&&sameDate&&stillSelected()&&String(v628BusinessReportDate||'')===reportDate)
            v800SetWhppMetrics(m,full?.timing?.[targetBusiness]||null);
          if(stillSelected()&&currentDate&&
             String(v628BusinessReportDate||'').slice(0,10)===String(reportDate).slice(0,10)&&
             days!=null&&Number.isFinite(Number(days)))
            setText('kpiAvgDays',Number(days).toFixed(2).replace(/\.00$/,''));
        }).catch(()=>{});
      }
    });

    // V765: the business summary is already visible. Run 5,000-row
    // workspace/integrity reads in a deferred lane with a bounded 20s cache.
    setText('v637BusinessIntegrity','正在后台读取完整性明细…');
    void v765LoadBusinessDetailLane({reportDate,snapshotId,m,options,generation,targetBusiness});
  }catch(e){
    if(!stillSelected())return;
    const whppOnlyAction=byId('v641WhppScanPending');
    if(whppOnlyAction){whppOnlyAction.hidden=true;whppOnlyAction.style.setProperty('display','none','important');}
    byId('v625BusinessRows').innerHTML='<tr><td colspan="7">业务快照暂未读取：'+esc(e.message)+'</td></tr>';
  }
}
function rowTr(values){const tr=document.createElement('tr');for(const v of values){const td=document.createElement('td');td.textContent=v??'—';tr.appendChild(td)}return tr}

// V788: every visible "查看" action must link to one real waybill in the
// selected business/date. Generic table rowTr() deliberately stays text-only.
function v788BusinessAbnormalRow(row={},reportDate='',selectedBusiness=''){
  const code=detailCode(row),date=String(reportDate||'').slice(0,10);
  const owner=String(selectedBusiness||'').trim().toUpperCase();
  const tr=rowTr([
    code||'—',owner||'—',row.category||row.queryStatus||'异常',
    row.pendingDays||row.ocDays||'—',row.currentState||row.queryStatus||'—',
    row.latestTime||row.lastEventTime||'—',''
  ]);
  const action=tr.lastElementChild;
  if(code&&/^\d{4}-\d{2}-\d{2}$/.test(date)
    &&['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'].includes(owner)){
    const link=document.createElement('a');
    link.textContent='查看该票';
    link.href='/tracking?auth=v625&code='+encodeURIComponent(code)
      +'&reportDate='+encodeURIComponent(date)
      +'&businessType='+encodeURIComponent(owner);
    action.appendChild(link);
  }else{
    action.textContent=code?'缺少业务/日期 · 待核验':'缺少运单号 · 待核验';
  }
  return tr;
}


let runBusy=false;
async function refreshImportCanonicalClassification(reportDate=''){
  const date=String(reportDate||v626LatestImport?.reportDate||'').slice(0,10);
  if(!date)return null;
  const snapshotId=String(v626LatestImport?.snapshotId||'').trim();
  // The quick home response can show core-source+separate WHPP counts, but
  // it does not prove shipment-code overlap. Do NOT replace the verified import
  // source ledger with quick display counts or mark it as balanced.
  if(!snapshotId){
    setText('v783ImportSourceNote','当前日报快照缺失，已保留原始导入分类，禁止猜测总票数。');
    return null;
  }
  try{
    const truth=await json('/api/import/source-reconciliation?reportDate='+encodeURIComponent(date)+'&snapshotId='+encodeURIComponent(snapshotId),15000);
    if(!truth?.ok||truth.reportDate!==date||truth.snapshotId!==snapshotId)throw new Error('来源快照不匹配');
    v785RememberWhppSource(truth);
    const source=truth.source||{},independent=truth.whppIndependent||{};
    const counts={...(source.counts||{})};
    const overlap=Number(independent.crossBusinessOverlap||0);
    const overlapWithImport=Number(independent.alreadyInImport||0);
    const extra=Number(independent.separateNotInImport||0);
    // Real current WHPP membership is displayed separately from the immutable
    // imported source count. Count new WHPP bills only when identities show no
    // cross-business collision, not just because two totals happen to match.
    if(overlap===0)counts.WHPP=Number(counts.WHPP||0)+extra;
    const types=['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'];
    for(const type of types){
      const el=q('[data-classification="'+type+'"]');
      if(el)el.textContent=fmt(counts[type]||0);
    }
    const importCount=Number(source.validUniqueWaybills||0);
    const union=Number(truth.display?.distinctUnion||0);
    const sourceOkay=source.balanced===true&&overlap===0;
    const note=sourceOkay
      ?'来源已逐票核验：统一导入 '+fmt(importCount)+' 票；独立WHPP '+fmt(independent.total||0)+' 票（与统一成员重复 '+fmt(overlapWithImport)+' 票）；最终唯一运单 '+fmt(union)+' 票。WHPP原始扫描、POD与退回证据均保留。'
      :'来源待核查：统一导入 '+fmt(importCount)+' 票；独立WHPP '+fmt(independent.total||0)+' 票；跨业务重叠 '+fmt(overlap)+' 票。已阻止错误标记七业务守恒。';
    setText('v783ImportSourceNote',note);
    // Show the true distinct seven-business total in today's import history
    // while retaining the saved unified batch source count as provenance.
    if(sourceOkay){
      const historyBody=byId('v625ImportHistory');
      for(const row of historyBody?.querySelectorAll('tr')||[]){
        if(String(row.cells?.[2]?.textContent||'').slice(0,10)!==date)continue;
        const countCell=row.cells?.[4];
        if(countCell)countCell.textContent=fmt(union)+(extra>0?'（核心'+fmt(importCount)+' + WHPP'+fmt(extra)+'）':'');
      }
    }
    // The original imported business counts stay untouched. Family lifecycle
    // decisions must continue using their persisted source member sets.
    return truth;
  }catch(error){
    setText('v783ImportSourceNote','来源逐票核验暂未完成（'+String(error?.message||error)+'）；保留原始导入数据，未重新扫描。');
    return null;
  }
}
async function loadImport(){
  try{
    const [latest,history]=await Promise.all([json('/api/import/unified-latest',7000),json('/api/unified-history?limit=15',7000)]);
    const latestImport=latest.import||v626LatestImport||null;
    const exactHistory=(history.rows||[]).find(r=>String(r.reportDate||'').slice(0,10)===String(latestImport?.reportDate||'').slice(0,10))||null;
    v626LatestImport=latestImport?{...latestImport,...(exactHistory?{snapshotStatus:exactHistory.snapshotStatus||exactHistory.status||latestImport.snapshotStatus||'IMPORTED',createdAt:exactHistory.createdAt||latestImport.createdAt}:{} )}:v626LatestImport;
    if(v626LatestImport){
      rememberV755ImportCounts(v626LatestImport,'UNIFIED_LATEST_LOAD');
      renderImport(v626LatestImport);
      note('v625ImportMessage','已读取最近一次综合日报。','success');
    }
    const tbody=byId('v625ImportHistory');if(tbody){tbody.replaceChildren();
      for(const r of history.rows||[]){
        const tr=document.createElement('tr');
        const values=[dateTime(r.createdAt),r.sourceName||'综合日报',r.reportDate||'—',r.dateDetectionSource||'系统自动识别',r.summary?.validUniqueWaybills??r.summary?.totalUnique??'—',r.snapshotStatus||r.status||'IMPORTED'];
        for(const value of values){const td=document.createElement('td');td.textContent=value;tr.appendChild(td)}tbody.appendChild(tr)
      }
      if(!(history.rows||[]).length)tbody.innerHTML='<tr><td colspan="6">暂无导入记录</td></tr>';
    }
    await refreshImportCanonicalClassification(v626LatestImport?.reportDate||'');
    void v759VerifyWhppCompletionOnce(v626LatestImport?.reportDate||'');
    void refreshLiveProgress();
    void loadOpenPod();
  }catch(error){note('v625ImportMessage','读取导入状态失败：'+error.message,'error')}
}
function dateSourceText(data={}){
  const source=String(data.dateDetectionSource||data.reportDateSource||'').trim();
  if(data.dateWasManuallyCorrected)return '人工修正日期';
  if(source)return '系统自动识别 · '+source;
  return '系统自动识别';
}
function renderImport(data){
  v626LatestImport={...(v626LatestImport||{}),...data};
  rememberV755ImportCounts(data,'RENDER_IMPORT');
  const counts=data.classificationCounts||{};for(const type of ['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN']){const el=q('[data-classification="'+type+'"]');if(el)el.textContent=fmt(counts[type]||0)}
  setText('v625ImportState','已导入');setText('v625ImportDateMeta',(data.reportDate||'—')+' · '+dateSourceText(data));
  setText('v626DetectedReportDate',data.reportDate||'—');setText('v626DetectedDateSource',dateSourceText(data));
  setText('v626ImportProgressDate',data.reportDate||'—');setText('v626ProcessReportDate',data.reportDate||'—');
  setText('v626StageParse','完成');setText('v626StageClassify',data.sourceReconciliation?.balanced?'完成':'待核验');
  setText('v626ImportParse','完成');setText('v626ImportClassify',data.sourceReconciliation?.balanced?'完成':'待核验');
}
async function doImport(){
  const file=byId('v625ImportFile').files?.[0];if(!file){note('v625ImportMessage','请选择综合日报文件。','error');return}
  if(runBusy){note('v625ImportMessage','当前日报仍在处理中，请等待完成后再上传下一份日报。','error');return}
  const button=byId('v625ImportButton');
  if(button){button.disabled=true;button.textContent='上传中…'}
  // A new import creates a new business lifecycle; cached historical run
  // projections must never be trusted across an import or purge.
  v765InvalidateAllProofCache();
  v765BoardDetailCache.clear();
  const fd=new FormData();fd.append('file',file);
  const manualWrap=byId('v626ManualDateWrap');
  if(manualWrap&&!manualWrap.hidden&&byId('v626ManualReportDate')?.value)fd.append('reportDate',byId('v626ManualReportDate').value);
  note('v625ImportMessage','正在读取Excel、识别日报日期并分类7业务…');
  appendLiveLog('开始上传综合日报 '+file.name);
  try{
    const r=await request('/api/import/unified-daily-report',{method:'POST',body:fd},120000);
    rememberV755ImportCounts(r,'UPLOAD_RESPONSE');
    renderImport(r);appendLiveLog('日报解析完成：'+(r.reportDate||'')+'，有效唯一运单 '+fmt(r.summary?.validUniqueWaybills||0)+' 票');
    await loadImport();
    note('v625ImportMessage','日报已导入，正在自动处理7业务…','success');
    if(button)button.textContent='自动处理中…';
    const outcome=await runTask('auto',r.reportDate||'',r);
    if(outcome?.ok)note('v625ImportMessage','日报导入及7业务自动处理已完成。','success');
    else if(outcome?.error)note('v625ImportMessage','日报已导入，但自动处理未完成：'+outcome.error,'error');
  }catch(e){
    appendLiveLog('日报导入失败：'+e.message);
    note('v625ImportMessage','导入失败：'+e.message,'error');
  }finally{
    if(button){button.disabled=false;button.textContent='上传并自动处理'}
  }
}
async function waitWhppTerminal(reportDate,timeoutMs=1800000){
  const started=Date.now();
  let transientPollFailures=0;
  while(Date.now()-started<timeoutMs){
    let r=null;
    try{
      r=await json('/api/whpp/progress'+(reportDate?'?reportDate='+encodeURIComponent(reportDate):''),15000);
      transientPollFailures=0;
    }catch(error){
      if(error?.code!=='CLIENT_WAIT_TIMEOUT')throw error;
      transientPollFailures+=1;
      if(transientPollFailures===1||transientPollFailures%4===0)appendLiveLog('WHPP后台仍在处理，实时进度暂时繁忙，继续等待…');
      await new Promise(resolve=>setTimeout(resolve,1500));
      continue;
    }
    const runtime=r?.runtime||{};
    // Keep the global 1.4s progress poll as the single UI owner. A temporary
    // progress-read timeout never aborts the detached WHPP background task.
    if(!runtime.active&&runtime.outcome){
      if(runtime.outcome!=='COMPLETED')
        throw new Error(runtime.error||('WHPP后台未完成：'+runtime.outcome));
      return r;
    }
    await new Promise(resolve=>setTimeout(resolve,1200));
  }
  throw new Error('WHPP处理等待超时');
}
// V787: inspect the EXACT selected-day durable WHPP proof before deciding
// START vs RESUME. A unified 515-row import saying WHPP=0 does not override
// the independently persisted 156-row WHPP daily source.
function v787WhppRecoveryAction(proof={},requestedDate='',requestedSnapshot=''){
  const day=String(requestedDate||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)
    ||String(proof?.reportDate||'').slice(0,10)!==day
    ||!requestedSnapshot||String(proof?.snapshotId||'')!==String(requestedSnapshot))
    throw new Error('WHPP恢复诊断日期/来源快照不一致，已阻止操作');
  const data=proof?.whppCompletion||{};
  const total=Number(data.canonicalTotal||0);
  const observed=Number(data.canonicalResolved||0);
  const evidence=data.terminalEvidenceCoverage||{};
  const scanned=Number(evidence.scanRows||0),finalized=Number(evidence.finalRows||0);
  if(!Number.isSafeInteger(total)||total<=0||observed!==total||data.membershipMatches!==true)
    throw new Error('WHPP独立日报运单未完整识别，不能重新处理');
  if(scanned>total||finalized>total)
    throw new Error('WHPP扫描/最终记录超过来源成员，必须先修复来源守恒');
  // "COMPLETED" without dated scan/final member proof is never enough to
  // skip processing (legacy unified WHPP child can be zero while daily=156).
  if(data.locked===true&&scanned===total&&finalized===total
     &&(data.processingEvidenceVerified===true||data.terminalEvidenceVerified===true))
    return {action:'DONE',total,scanned,finalized};
  return {action:scanned===0&&finalized===0?'START':'RESUME',total,scanned,finalized};
}
async function v787WhppRecoveryProof(reportDate){
  const day=String(reportDate||'').slice(0,10);
  const snapshot=String(v626LatestImport?.snapshotId||'');
  if(!day||day!==String(v626LatestImport?.reportDate||'').slice(0,10)||!snapshot)
    throw new Error('请先选择正在查看的有效日报，WHPP不允许跨日期恢复');
  const proof=await json('/api/whpp/completion-proof?reportDate='+encodeURIComponent(day),20000);
  return v787WhppRecoveryAction(proof,day,snapshot);
}
async function safeWhppRun(mode,reportDate){
  const day=String(reportDate||'').slice(0,10);
  const decision=await v787WhppRecoveryProof(day);
  if(decision.action==='DONE'){
    appendLiveLog('WHPP来源 '+fmt(decision.total)+'票、处理证据已完成，无需重复扫描');
    return {ok:true,skipped:true,reason:'EXACT_WHPP_COMPLETED'};
  }
  const runMode=mode==='resume'?decision.action:'start';
  appendLiveLog('WHPP '+day+' '+fmt(decision.total)+'票 · 已扫描'+fmt(decision.scanned)+'票，已生成最终记录'+fmt(decision.finalized)+'票；'+
    (runMode==='start'?'首次启动扫描':'从现有记录继续处理'));
  try{
    const r=await post('/api/whpp/run/'+(runMode==='resume'?'resume':'start'),{reportDate:day},0);
    const terminal=(r.runtime?.active||r.active)?await waitWhppTerminal(day):r;
    // A completed WHPP run must bypass the stale 30s negative-proof throttle once.
    // This is an exact date/snapshot read-only check, not an automatic completion.
    if(terminal?.runtime?.outcome==='COMPLETED'||terminal?.completed===true){
      await v759VerifyWhppCompletionOnce(day,{force:true});
    }
    return r;
  }catch(error){
    const code=String(error.payload?.code||'');
    if(code==='WHPP_ALREADY_FINALIZED'){
      const after=await v787WhppRecoveryProof(day);
      if(after.action==='DONE')return {ok:true,skipped:true,reason:'EXACT_WHPP_COMPLETED'};
      throw new Error('WHPP旧状态声称完成，但来源'+fmt(after.total)+'票仅有'+fmt(after.scanned)+'票扫描、'+fmt(after.finalized)+'票最终记录；已阻止错误跳过');
    }
    if(code==='WHPP_RUN_ALREADY_ACTIVE'){
      appendLiveLog('WHPP后台已有任务，等待原任务完成，不重复启动');
      return await waitWhppTerminal(day);
    }
    // Never suppress a missing WHPP normalized daily merely because the
    // 515-row unified partition itself says WHPP=0.
    throw error;
  }
}
// V761: a missing run is not resumable. A first start is admitted only when
// same-date persisted source and BOTH scan/final ledgers prove zero prior work.
async function v761FamilyRecoveryProof(reportDate=''){
  const date=String(reportDate||'').slice(0,10);
  const response=await json('/api/family-recovery-proof?reportDate='+encodeURIComponent(date),20000);
  const latest=String(v626LatestImport?.snapshotId||'');
  if(response?.ok!==true||response?.reportDate!==date||!latest||String(response?.snapshotId||'')!==latest)
    throw new Error('恢复状态的日期或快照与当前日报不一致，已禁止重复扫描。');
  return response;
}
async function v761ContinueFamily(type,disposition,date){
  const label=type==='SHOPEE'?'SHOPEE CN/VN':'CCSL';
  const action=String(disposition?.action||'BLOCKED');
  if(action==='DONE'||action==='ZERO_TICKET'){
    appendLiveLog(label+'已有完成证据或0票，跳过');
    return;
  }
  if(action==='WAIT'){
    appendLiveLog(label+'后台任务正在运行，仅继续等待，不重复启动');
    await waitFamilyTerminal(type,date);
    return;
  }
  if(action==='START'){
    appendLiveLog(label+'无历史扫描记录：从当前日报首次启动处理');
    const endpoint=type==='SHOPEE'?'/api/shopee/run/start':'/api/run';
    await autoStartFamily(type,endpoint,date,Number(disposition.sourceCount||0));
    return;
  }
  if(action==='RESUME'){
    appendLiveLog(label+'有已保存的中断任务，从断点恢复');
    const endpoint=type==='SHOPEE'?'/api/shopee/run/resume':'/api/resume';
    await runFamilyRequest(type,endpoint,date);
    return;
  }
  throw new Error(label+'禁止重复处理：'+(disposition?.reason||'完成证据不明确')+
    '（扫描 '+Number(disposition?.scanCount||0)+'，最终记录 '+Number(disposition?.finalCount||0)+
    '，任务 '+String(disposition?.runStatus||'UNKNOWN')+'）');
}
async function v761DiagnoseFamilyRecovery(){
  const view=byId('v761FamilyRecoveryResult'),button=byId('v761FamilyRecoveryDiagnostic');
  if(!view)return;
  const date=String(v626LatestImport?.reportDate||'').slice(0,10);
  view.hidden=false;
  if(button){button.disabled=true;button.textContent='正在诊断…'}
  try{
    const proof=await v761FamilyRecoveryProof(date);
    v762RememberFamilyCompletionProof(proof,date,String(v626LatestImport?.snapshotId||''));
    void refreshLiveProgress();
    const lines=['日报日期：'+proof.reportDate,'业务完成状态诊断（只读；不会触发扫描）'];
    for(const type of ['CCSL','SHOPEE']){
      const b=proof.businesses?.[type]||{};
      const actionLabel={DONE:'已完成',ZERO_TICKET:'0票跳过',WAIT:'运行中',START:'可以首次启动',RESUME:'可以断点恢复',BLOCKED:'暂不允许重复处理'};
      lines.push(type+'：'+(actionLabel[b.action]||b.action||'未知')+
        ' · 日报 '+Number(b.sourceCount||0)+'票 · 已扫描 '+Number(b.scanCount||0)+
        '票 · 最终记录 '+Number(b.finalCount||0)+'票 · 任务 '+(b.runStatus||'UNKNOWN'));
      lines.push('原因：'+(b.reason||'未确认')+(b.error?'；错误：'+b.error:''));
      if(b.action==='DONE')lines.push('扫描/最终记录与日报运单逐票一致：'+(b.exactMemberVerified===true?'是':'否或未核实')+
        '；缺扫描成员 '+Number(b.scanMissing||0)+'；缺最终成员 '+Number(b.finalMissing||0));
    }
    view.textContent=lines.join('\n');
  }catch(error){view.textContent='读取失败（数据未修改）：'+String(error?.message||error)}
  finally{if(button){button.disabled=false;button.textContent='诊断CCSL/SHOPEE（只读）'}}
}
// V760: business HTTP responses are not a substitute for exact selected-date
// persisted terminal truth. Never publish success or launch timing while 1/3.
function v760FamilyTerminalSummary(bundle={},counts={},date=''){
  const required=[['CCSL','ccsl',counts.CCSL],['SHOPEE','shopee',counts.SHOPEE],['WHPP','whpp',counts.WHPP]];
  const missing=[];
  for(const [name,key,total] of required){
    const value=bundle?.[key]||{};
    const actualDate=String(value.reportDate||value.completionLock?.reportDate||'').slice(0,10);
    if(Number(total||0)>0&&actualDate&&actualDate!==date){
      missing.push(name+'日期不匹配（'+actualDate+'）');
      continue;
    }
    if(!familyComplete(value)){
      const state=String(value.runStatus||value.outcome||value.phase||'等待进度确认');
      missing.push(name+'未完成（'+state+'）');
    }
  }
  return{ok:missing.length===0,missing,complete:required.length-missing.length};
}
async function v760VerifyAllFamilies(reportDate,counts){
  let last=null,summary=null;
  for(let attempt=0;attempt<3;attempt++){
    if(attempt)await sleep(1300);
    last=await fetchLiveProgress(reportDate);
    summary=v760FamilyTerminalSummary(last,counts,reportDate);
    if(summary.ok)return{ok:true,bundle:last,summary};
    if(summary.missing.some(item=>item.startsWith('WHPP'))&&Number(counts.WHPP||0)>0){
      await v759VerifyWhppCompletionOnce(reportDate);
    }
  }
  return{ok:false,bundle:last,summary};
}
async function runTask(mode,explicitReportDate='',explicitImportData=null){
  if(runBusy)return{ok:false,error:'当前已有处理任务正在运行'};
  runBusy=true;
  const reportDate=explicitReportDate||v626LatestImport?.reportDate||(await latestImportContext())?.reportDate||'';
  const auto=mode==='auto';
  note('v625RunMessage',auto?'日报上传完成，系统正在自动处理7业务。':'正在处理7业务，扫描与轨迹进度会实时更新。');
  appendLiveLog((auto?'自动开始':mode==='resume'?'继续':'开始')+'7业务处理 '+(reportDate||''));
  startProgressPolling();
  try{
    const counts=await resolveV755FamilyCounts(reportDate,explicitImportData);
    appendLiveLog('已确认当日日报票数：CCSL '+counts.CCSL+' · SHOPEE '+counts.SHOPEE+' · WHPP '+counts.WHPP);
    if(auto){
      appendLiveLog('自动处理：CCSL');await autoStartFamily('CCSL','/api/run',reportDate,counts.CCSL);
      appendLiveLog('自动处理：SHOPEE CN/VN');await autoStartFamily('SHOPEE','/api/shopee/run/start',reportDate,counts.SHOPEE);
      if(counts.WHPP>0){
        appendLiveLog('自动处理：WHPP本土');await safeWhppRun('start',reportDate);
      }else appendLiveLog('WHPP 当日日报0票，自动跳过');
    }else if(mode==='start'){
      appendLiveLog('开始CCSL订单扫描/轨迹处理');await autoStartFamily('CCSL','/api/run',reportDate,counts.CCSL);
      appendLiveLog('CCSL处理完成，开始SHOPEE CN/VN');await autoStartFamily('SHOPEE','/api/shopee/run/start',reportDate,counts.SHOPEE);
      if(counts.WHPP>0){appendLiveLog('SHOPEE处理完成，开始WHPP本土');await safeWhppRun('start',reportDate)}
      else appendLiveLog('WHPP 当日日报0票，自动跳过');
    }else{
      const proof=await v761FamilyRecoveryProof(reportDate);
      const failures=[];
      for(const type of ['CCSL','SHOPEE']){
        try{await v761ContinueFamily(type,proof?.businesses?.[type],reportDate)}
        catch(error){const message=String(error?.message||error);appendLiveLog(type+'恢复受阻：'+message);failures.push(message)}
      }
      // Never trust an old 3/3 visual projection. Exact dated 156-member
      // WHPP evidence determines whether to start fresh, resume, or skip.
      if(Number(counts.WHPP||0)>0){
        appendLiveLog('检查独立WHPP来源及扫描/最终记录证据');
        try{await safeWhppRun('resume',reportDate)}
        catch(error){failures.push('WHPP：'+String(error?.message||error))}
      }
      if(failures.length)throw new Error(failures.join('；'));
    }
    const verified=await v760VerifyAllFamilies(reportDate,counts);
    if(verified.bundle)renderLiveProgress(verified.bundle);
    if(!verified.ok){
      const reason='当前确认 '+verified.summary.complete+'/3业务完成；'+verified.summary.missing.join('；');
      appendLiveLog('7业务状态尚未核实完成：'+reason);
      note('v625RunMessage','处理请求已返回，但'+reason+'。未启动签收时效补证；不要重复上传或清数据。','error');
      return{ok:false,error:reason};
    }
    appendLiveLog('7业务 '+reportDate+' 已核实3/3完成，准备启动签收时效补证');
    let repairStarted=false,repairError='';
    try{
      const repair=await post('/api/timing-repair/start',{reportDate},15000);
      repairStarted=repair?.ok!==false;
    }catch(error){repairError=error.message||String(error)}
    if(repairStarted){
      appendLiveLog('7业务已核实完成，签收时效补证已启动');
      note('v625RunMessage','7业务已核实3/3完成，签收时效补证已启动。','success');
    }else{
      appendLiveLog('7业务已核实3/3完成，但签收时效补证未能确认启动：'+(repairError||'接口未确认'));
      note('v625RunMessage','7业务已核实3/3完成，但签收时效补证启动失败：'+(repairError||'接口未确认'),'error');
    }
    await Promise.all([refreshLiveProgress(),loadOpenPod(),refreshImportCanonicalClassification(reportDate),page==='home'?loadHome({skipAux:true}):Promise.resolve()]);
    return{ok:true,repairStarted};
  }catch(e){
    appendLiveLog('处理未完成：'+e.message);
    note('v625RunMessage','任务未完成：'+e.message,'error');
    return{ok:false,error:e.message||String(e)};
  }finally{
    runBusy=false;stopProgressPolling();void refreshLiveProgress();
  }
}
function note(id,msg,tone=''){const el=byId(id);if(!el)return;el.textContent=msg;el.className='v625-inline-note'+(tone?' '+tone:'')}

// V788: a manually viewed tracking timeline is READ-ONLY evidence, not an
// authorization to close a historical OPEN ledger. CYCLE_COUNT is a stock
// count, never a POD/RETURNED terminal. Preserve TMS shipmentStatus semantics.
function v788TrackingReadOnlyReview(data={},bill='',orderedEvents=[]){
  const wanted=String(bill||'').trim().toUpperCase();
  const matches=row=>{
    const code=String(row?.shipmentCode||row?.waybill||row?.orderNo||row?.trackingNo||'').trim().toUpperCase();
    return Boolean(wanted&&code===wanted);
  };
  const scans=(data.scanRows||[]).filter(matches);
  const shipments=(data.shipmentRows||[]).filter(matches);
  const ledgers=(data.ledger||[]).filter(matches);
  const statusCodes=new Set(shipments.map(r=>String(r.shipmentStatus??'').trim()));
  const terminalReasons=new Set(ledgers.map(r=>String(r.terminalReason||'').trim().toUpperCase()).filter(Boolean));
  const pod=statusCodes.has('60')||scans.some(r=>String(r.orderStatus??'').trim()==='85')||terminalReasons.has('POD');
  const returned=statusCodes.has('81')||terminalReasons.has('RETURNED');
  const returning=statusCodes.has('80');
  const conflict=(pod&&returned)||(pod&&returning)||(returned&&returning);
  const openLedger=ledgers.some(r=>String(r.trackingStatus||'').toUpperCase()==='OPEN');
  const localState=String(ledgers.find(r=>r.currentState)?.currentState||'').trim().toUpperCase();
  let result='尚未发现可核实的POD或已退回终态；需要继续核验';
  if(conflict)result='存在相互冲突的终态/退回中证据，必须逐票复核';
  else if(pod)result=openLedger?'发现POD终态证据，但本地账本仍OPEN，等待终态对账'
    :'发现POD终态证据；须确认与原始日报成员一致';
  else if(returned)result=openLedger?'发现已退回终态证据，但本地账本仍OPEN，等待终态对账'
    :'发现已退回终态证据；须确认退回交接记录';
  else if(returning)result='退回处理中（shipmentStatus=80），尚未完成退回';
  const last=orderedEvents[0]||null;
  const lastTime=last?String(last.eventTime||last.time||last.updateTime||last.createdAt||'').trim():'';
  const remoteNote=data.remoteSkipped||data.remoteError
    ?' · 本次实时查询未得到完整响应，不能仅凭旧本地记录结案':'';
  return{result,localState:localState||'待核验',lastTime:lastTime||'无轨迹时间',
    hasTerminal:pod||returned,conflict,openLedger,remoteNote};
}
// V788: keep the most recent evidence immediately visible. Multi-month
// histories remain accessible in one native expand control, not discarded.
function v788RenderBoundedTrackTimeline(events=[],render=()=>'',maxVisible=8){
  const rows=Array.isArray(events)?events:[];
  const count=Math.max(1,Math.min(15,Number(maxVisible)||8));
  const latest=rows.slice(0,count).map(render).join('');
  const older=rows.slice(count);
  if(!older.length)return latest;
  return latest+'<details class="v788-track-history" style="margin-top:10px"><summary style="cursor:pointer;padding:10px 8px;font-weight:600">展开其余 '
    +older.length+' 条历史轨迹（已按时间从近到远排列）</summary>'
    +older.map(render).join('')+'</details>';
}
async function queryTrack(){
  const code=byId('v625TrackCode').value.trim();if(!code){setText('v625TrackMeta','请输入运单号');return}
  const wanted=code.toUpperCase(),source=currentParams().get('source')||'';
  setText('v625TrackMeta','运单 '+code+' · 查询中…');byId('v625TrackTimeline').innerHTML='<div class="v625-empty-state">查询中…</div>';
  try{
    const r=await post('/api/track-query',{businessType:byId('v625TrackBusiness').value,shipmentCodes:[code],reportDate:byId('v625TrackDate').value||today()},60000);
    const rowBill=row=>String(row?.shipmentCode||row?.waybill||row?.orderNo||row?.trackingNo||'').trim().toUpperCase();
    const belongs=row=>!rowBill(row)||rowBill(row)===wanted;
    // Newly observed events belong at the TOP; previously a multi-month
    // timeline pushed the latest delivery evidence to the very bottom.
    const events=(r.trackEvents||[]).filter(belongs).sort((a,b)=>{
      const key=x=>String(first(x,['eventTime','time','updateTime','createdAt'])||'').replace('T',' ');
      return key(b).localeCompare(key(a));
    });
    const eventDesc=e=>{let raw={};try{raw=typeof e.rawJson==='string'?JSON.parse(e.rawJson):e.rawJson||{}}catch{}return first(e,['trackingEventDescZh','trackingEventDesc','eventName','statusName','description','content','remark'])||first(raw,['trackingEventDescZh','trackingEventDesc','statusText','statusName','eventName','remark','message'])||'已保存轨迹证据'};
    const statusEvidence=[],statusSeen=new Set();
    const evidenceTime=row=>first(row,['updateTime','lastUpdateDate','scanTime','statusTime','modifyTime','eventTime','lastEventTime','podDate','terminalAt'])||'';
    const addStatus=(row,title,description,evidenceSource)=>{
      if(!row||!belongs(row))return;
      const key=[title,description,evidenceTime(row),evidenceSource].join('|');if(statusSeen.has(key))return;statusSeen.add(key);
      statusEvidence.push({title,description,time:evidenceTime(row),source:evidenceSource});
    };
    for(const row of r.scanRows||[]){
      const status=String(row?.orderStatus??'').trim().toUpperCase();
      if(status==='85')addStatus(row,'POD状态已确认','orderStatus=85；这是终态状态证据，但若没有最终派件/签收时间，不能据此虚构签收日期。','confirm-query 状态证据（非轨迹时间）');
      else if(status)addStatus(row,'订单状态 '+status,'接口已返回订单状态，但未形成可展示的历史轨迹节点。','confirm-query 状态证据');
    }
    for(const row of r.shipmentRows||[]){
      const status=String(row?.shipmentStatus??'').trim().toUpperCase();
      const label=status==='60'?'POD状态已确认':status==='80'?'退回处理中':status==='81'?'已退回':('shipmentStatus '+(status||'—'));
      const desc=status==='60'
        ?'shipmentStatus=60；POD终态已确认，但该状态本身没有可用于签收天数的时间时，仍需轨迹或后续日报派件时间。'
        :status==='80'?'shipmentStatus=80；当前为退回处理中。':status==='81'?'shipmentStatus=81；当前为已退回。':'接口返回了运单状态记录。';
      addStatus(row,label,desc,'shipment-track 状态证据（非轨迹时间）');
    }
    for(const row of r.rows||[]){
      const state=String(row?.currentState||row?.primaryCategory||row?.scanNormalizedState||'').trim();
      if(state)addStatus(row,'当前分析状态 '+state,'系统已识别当前业务状态；如无轨迹节点，下方状态仅用于说明当前事实，不作为签收日期。','业务分析状态');
    }
    const strongTerminalPod=(r.scanRows||[]).some(row=>belongs(row)&&String(row?.orderStatus??'').trim()==='85')
      ||(r.shipmentRows||[]).some(row=>belongs(row)&&String(row?.shipmentStatus??'').trim()==='60')
      ||(r.ledger||[]).some(row=>belongs(row)&&String(row?.terminalReason||'').trim().toUpperCase()==='POD');
    for(const row of r.ledger||[]){
      const terminal=String(row?.terminalReason||'').trim().toUpperCase(),state=String(row?.currentState||'').trim(),upperState=state.toUpperCase();
      if(terminal==='POD')addStatus(row,'本地账本：POD','本地持续追踪账本已确认POD'+(row?.podDate?'，并保存POD时间。':'，但未保存可用POD时间。'),'qc_tracking_ledger');
      else if(strongTerminalPod&&/API_PENDING_RETRY|PENDING_RETRY|待重试/.test(upperState))continue;
      else if(state||terminal)addStatus(row,'本地账本：'+(state||terminal),'本地账本存在当前状态记录。','qc_tracking_ledger');
    }
    const eventHtml=v788RenderBoundedTrackTimeline(events,e=>'<div class="v625-timeline-item"><b>'+esc(first(e,['eventTime','time','updateTime','createdAt'])||'—')+'</b><p>'+esc(eventDesc(e))+'</p><small>'+esc(e.evidenceSource||'CE实时轨迹')+'</small></div>');
    const statusHtml=statusEvidence.map(e=>'<div class="v625-timeline-item"><b>'+esc(e.time||'无可用时间')+'</b><p><strong>'+esc(e.title)+'</strong> · '+esc(e.description)+'</p><small>'+esc(e.source)+'</small></div>').join('');
    const root=byId('v625TrackTimeline');
    const review=v788TrackingReadOnlyReview(r,wanted,events);
    const reviewHtml='<div class="v625-empty-state" style="text-align:left;padding:12px 14px;margin-bottom:10px">'
      +'<strong>'+esc(review.result)+'</strong>'
      +'<p style="margin:6px 0 0">账本状态：'+esc(review.localState)
      +' · 最近可见轨迹时间：'+esc(review.lastTime)+esc(review.remoteNote)+'</p>'
      +'<small>仅展示只读证据；CYCLE_COUNT（盘点）不等于POD或已退回，页面查询不会改写账本。</small></div>';
    if(events.length||statusEvidence.length){
      root.innerHTML=reviewHtml
        +(events.length?'<div class="v625-empty-state" style="padding:6px 0">轨迹记录（最新在前；先显示最近8条）</div>'+eventHtml:'')
        +(statusEvidence.length?('<div class="v625-empty-state" style="padding:10px 0 6px">状态证据（不等同于轨迹时间）</div>'+statusHtml):'');
    }else{
      root.innerHTML='<div class="v625-empty-state">'+(source==='timing-backfill'?'该运单当前没有可显示的历史轨迹或时间证据；系统会继续等待后续日报出现最终派件时间后自动回补。':'当前没有查到本地或接口轨迹/状态证据。')+'</div>';
    }
    const suffix=source==='timing-backfill'&&events.length===0?' · 当前仍缺少可用于签收天数的轨迹时间/日报派件时间':'';
    setText('v625TrackMeta','运单 '+code+' · 查询完成 · '+events.length+' 个轨迹节点 · '+statusEvidence.length+' 条状态证据'+(r.localEvidence?' · 含本地已保存证据':'')+suffix);
  }catch(e){
    byId('v625TrackTimeline').innerHTML='<div class="v625-empty-state">'+esc(e.message)+'</div>';
    setText('v625TrackMeta','运单 '+code+' · 查询失败 · '+String(e?.message||e));
  }
}
// QC action center V1: evidence-backed read-only queue. It never submits
// status updates or marks a shipment delivered/returned/processed.
let qcActionRows=[];
let qcActionScope=null;
let qcActionGeneration=0;
let qcActionPage=0;
const QC_ACTION_PAGE_SIZE=100;
function qcActionClassify(row){
  const category=String(row.category||'');
  const query=String(row.queryStatus||'');
  const special=String(row.specialState||'');
  if(row.pendingNonContinuous===true)return{
    key:'PENDING_GAP',name:'Pending不连续',team:'工单组',
    days:null,action:'核查缺失日期的真实轨迹，补齐有效Pending后跟进POD'};
  if(row.oc2Plus===true&&Number(row.ocDays)>=2)return{
    key:'OC_2_PLUS',name:'OC 2天+',team:'派送组长 / OC负责人',
    days:Number(row.ocDays),action:'核查返仓及带出记录，安排优先派送并追踪POD'};
  if(row.shopArrivedCurrent===true)return{
    key:'SHOP_STAY',name:'门店到件待跟进',team:'门店客服 / BD督导',
    days:Number.isFinite(Number(row.shopRetentionDays))?Number(row.shopRetentionDays):null,
    action:'总部客服下发门店核实包裹与客户通知情况，次日回收处理结果'};
  if(query==='待重试'||/失败|RETRY|QUERY_FAILED/i.test(query))return{
    key:'RETRY',name:'轨迹待重试',team:'工单组',
    days:null,action:'核实接口和最后有效节点后重试查询，不得虚构状态'};
  if(String(row.shipmentStatus||'')==='80'||/退回中|RETURN_IN_PROGRESS|RETURNING/.test(category+' '+special))return{
    key:'RETURNING',name:'退回中待核验',team:'返仓 / 退回负责人',
    days:null,action:'核对退回轨迹、交接证据和实际退回完成时间'};
  return{key:'OTHER',name:'其他待核验',team:'工单组 / 派送组长',
    days:null,action:'核对最后有效轨迹，确认未闭环原因并指派处理'};
}
function qcActionCase(row){
  const evidence=qcActionClassify(row);
  return{...row,...evidence,
    shipmentCode:String(row.shipmentCode||'').trim().toUpperCase(),
    businessType:String(row.businessType||'').trim().toUpperCase(),
    shopName:String(row.shopName||row.shopCode||''),
    latestNode:String(row.latestNode||''),
    latestTime:String(row.latestTime||''),
    reportDate:String(row.reportDate||'').slice(0,10)};
}
function qcActionFilter(){
  const type=byId('v625ExceptionType')?.value||'';
  const biz=byId('v625ExceptionBusiness')?.value||'';
  const keyword=String(byId('v768ExceptionKeyword')?.value||'').trim().toUpperCase();
  return qcActionRows.filter(row=>(!type||row.key===type)&&(!biz||row.businessType===biz)
    &&(!keyword||[row.shipmentCode,row.shopName,row.businessType].join(' ').toUpperCase().includes(keyword)));
}
function qcActionLine(row){
  const latest=[row.latestNode||'无可信轨迹描述',row.latestTime].filter(Boolean).join(' · ');
  return [row.shipmentCode,row.businessType,row.name,'建议责任部门：'+row.team,
    '最后有效轨迹：'+latest,'待处理：'+row.action,
    '日报日期：'+(row.reportDate||qcActionScope?.reportDate||'未提供')].join(' | ');
}
async function qcCopyText(value){
  if(!value)return false;
  try{
    if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);
    else{
      const textarea=document.createElement('textarea');
      textarea.value=value;textarea.style.position='fixed';textarea.style.left='-9999px';
      document.body.appendChild(textarea);textarea.select();
      const ok=document.execCommand('copy');textarea.remove();
      if(!ok)throw new Error('浏览器未批准复制');
    }
    return true;
  }catch{return false}
}
function qcActionDetailUrl(row){
  const p=new URLSearchParams({shipmentCode:row.shipmentCode,businessType:row.businessType});
  if(row.reportDate||qcActionScope?.reportDate)p.set('reportDate',row.reportDate||qcActionScope.reportDate);
  // Preserve the exact source snapshot of the action card so a later import
  // cannot silently replace the historical WHPP/CE/Shopee evidence.
  if(qcActionScope?.snapshotId)p.set('snapshotId',qcActionScope.snapshotId);
  return '/qc-action-detail?'+p.toString();
}
// V776: independent read-only exact-waybill navigation. The actionable queue
// excludes verified terminal records by design, but an operator must still be
// able to inspect the saved historical source for those very same shipments.
function qcOpenAnyWaybill(){
  const bill=String(byId('v768ExceptionKeyword')?.value||'').trim().toUpperCase();
  const business=String(byId('v625ExceptionBusiness')?.value||'').trim().toUpperCase();
  const date=String(byId('v625ExceptionDate')?.value||'').slice(0,10);
  const hint=message=>setText('v776DirectHelp',message);
  if(!/^[A-Z0-9][A-Z0-9_-]{4,69}$/.test(bill)){
    hint('请输入完整运单号（不是门店名称），再点击“运单直查（含已闭环）”。');return;
  }
  if(!['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'].includes(business)){
    hint('请先指定单个业务板块，避免不同业务同号记录混淆。');return;
  }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
    hint('请先选择运单所属日报日期，不能借用其他日期的历史状态。');return;
  }
  const row={shipmentCode:bill,businessType:business,reportDate:date};
  // Only pin a snapshot if the current QC query proved it belongs to this
  // exact date; otherwise the evidence endpoint verifies the dated source.
  const pin=qcActionScope?.reportDate===date&&qcActionScope?.snapshotId
    ?qcActionScope.snapshotId:'';
  const url=new URLSearchParams(row);
  if(pin)url.set('snapshotId',pin);
  location.assign('/qc-action-detail?'+url.toString());
}
function qcActionUpdateSelection(){
  const checked=qa('#v625ExceptionRows input[data-qc-case]:checked');
  const btn=byId('v768CopySelected');
  if(btn){btn.disabled=!checked.length;btn.textContent=checked.length?'复制已勾选（'+checked.length+'）':'复制已勾选'}
}
function renderExceptionRows(){
  const matched=qcActionFilter();
  const totalPages=Math.max(1,Math.ceil(matched.length/QC_ACTION_PAGE_SIZE));
  qcActionPage=Math.min(qcActionPage,totalPages-1);
  const from=qcActionPage*QC_ACTION_PAGE_SIZE;
  const items=matched.slice(from,from+QC_ACTION_PAGE_SIZE);
  const tbody=byId('v625ExceptionRows');if(!tbody)return;
  tbody.replaceChildren();
  const headline=(qcActionScope?.reportDate||'最新日报')+' · 筛选 '+matched.length+' 票 · 展示 '+(items.length?from+1:0)+'–'+(from+items.length);
  const limited=qcActionScope?.truncated?' · 接口最多返回5,000票，请按业务/日期缩小范围':'';
  setText('v625ExceptionMeta',headline+limited);
  const copy=byId('v768CopyCurrent');
  if(copy)copy.disabled=!matched.length;
  const all=byId('v768CheckAll');if(all){all.checked=false;all.disabled=!items.length}
  const prev=byId('v768PreviousPage'),next=byId('v768NextPage');
  if(prev)prev.disabled=qcActionPage===0;
  if(next)next.disabled=qcActionPage>=totalPages-1;
  setText('v768PageLabel','第 '+(qcActionPage+1)+' / '+totalPages+' 页');
  if(!items.length){
    const tr=document.createElement('tr'),td=document.createElement('td');
    td.colSpan=9;td.textContent='当前条件暂无待核验运单。已闭环运单不会出现在此清单；请通过上方“运单直查（含已闭环）”按单号核对历史证据。';
    tr.appendChild(td);tbody.appendChild(tr);qcActionUpdateSelection();return;
  }
  for(const row of items){
    const tr=document.createElement('tr');
    const checkTd=document.createElement('td'),check=document.createElement('input');
    check.type='checkbox';check.dataset.qcCase=row.businessType+'|'+row.shipmentCode;check.setAttribute('aria-label','选择运单 '+row.shipmentCode);
    check.addEventListener('change',qcActionUpdateSelection);checkTd.appendChild(check);tr.appendChild(checkTd);
    const billTd=document.createElement('td'),bill=document.createElement('a');
    bill.href=qcActionDetailUrl(row);bill.target='_blank';bill.rel='noopener noreferrer';bill.textContent=row.shipmentCode;
    billTd.appendChild(bill);tr.appendChild(billTd);
    for(const v of [row.businessType,row.name,row.days===null?'—':String(row.days),
      row.team,[row.latestNode||'暂无已保存有效轨迹',row.latestTime].filter(Boolean).join(' · '),row.action]){
      const td=document.createElement('td');td.textContent=v;tr.appendChild(td);
    }
    const actionTd=document.createElement('td');actionTd.className='v768-row-actions';
    const open=document.createElement('a');open.href=qcActionDetailUrl(row);open.target='_blank';open.rel='noopener noreferrer';open.textContent='查看';
    const copyBtn=document.createElement('button');copyBtn.type='button';copyBtn.className='v768-copy-single';copyBtn.textContent='复制';
    copyBtn.addEventListener('click',async()=>{
      const success=await qcCopyText(qcActionLine(row));
      setText('v768ExceptionEvidence',success?'已复制该运单的待处理要求（不代表已下发或闭环）':'复制失败，请检查浏览器剪贴板权限');
    });
    actionTd.append(open,copyBtn);tr.appendChild(actionTd);tbody.appendChild(tr);
  }
  qcActionUpdateSelection();
}
async function loadExceptions(){
  const generation=++qcActionGeneration;
  const date=(byId('v625ExceptionDate')?.value||selectedReportDate()||'').slice(0,10);
  const urlSnapshot=String(currentParams().get('snapshotId')||'');
  const urlDate=String(selectedReportDate()||'').slice(0,10);
  const query=new URLSearchParams({scope:'actionable',qcAction:'1'});
  const businessScope=String(byId('v625ExceptionBusiness')?.value||'').toUpperCase();
  if(businessScope)query.set('businessType',businessScope);
  if(date)query.set('reportDate',date);
  if(date&&date===urlDate&&urlSnapshot)query.set('snapshotId',urlSnapshot);
  const btn=byId('v625ExceptionSearch');if(btn)btn.disabled=true;
  setText('v768ExceptionEvidence','正在读取本地已保存的有效轨迹；不会启动扫描或更改状态…');
  try{
    const r=await json('/api/tracking-workspace?'+query.toString(),25000);
    if(generation!==qcActionGeneration)return;
    if(date&&String(r.reportDate||'').slice(0,10)!==date)throw new Error('接口返回日期与筛选日期不一致，已停止显示以防混入其他批次');
    if(query.has('snapshotId')&&String(r.snapshotId||'')!==urlSnapshot)throw new Error('接口快照不一致，已停止显示旧数据');
    if(!r.reportDate||!r.snapshotId)throw new Error('未取得有效日报及快照证据，请先选择已上传的日报');
    // Pin the actual resolved source date to the dedicated QC date field.
    // The global header may show today's date, but it must never silently
    // replace the selected historical QC business date.
    if(byId('v625ExceptionDate'))byId('v625ExceptionDate').value=String(r.reportDate).slice(0,10);
    if(r.qcCoverage&&!r.qcCoverage.hasFinalEvidence)
      throw new Error('本业务轨迹/最终记录尚未齐全：来源 '+fmt(r.qcCoverage.sourceMembers||0)+' 票，缺最终记录 '
        +fmt(r.qcCoverage.missingFinalEvidence||0)+' 票，缺可显示运单 '
        +fmt(r.qcCoverage.missingVisibleMembers||0)+' 票。不能将异常数量显示为0，请检查处理完成证据');
    const raw=Array.isArray(r.rows)?r.rows:[];
    // Do not trust a stale closed outcome as a new exception.
    const actionable=raw.filter(row=>row?.shipmentCode&&row.isActionable===true&&row.isClosed!==true
      &&!['POD','RETURN'].includes(String(row.scanStatus||'').toUpperCase()));
    const distinct=new Map();
    for(const item of actionable){
      const caseRow=qcActionCase(item);
      const key=caseRow.businessType+'|'+caseRow.shipmentCode;
      if(!distinct.has(key))distinct.set(key,caseRow);
    }
    qcActionRows=[...distinct.values()];
    qcActionScope={reportDate:String(r.reportDate).slice(0,10),snapshotId:String(r.snapshotId),
      truncated:Number(r.summary?.actionable||0)>raw.length||raw.length>=5000};
    qcActionPage=0;
    setText('v768TotalActionable',fmt(Number(r.summary?.actionable??qcActionRows.length)));
    setText('exPendingGap',fmt(qcActionRows.filter(x=>x.pendingNonContinuous===true).length));
    setText('v768Oc2',fmt(qcActionRows.filter(x=>x.oc2Plus===true).length));
    setText('exShopStay',fmt(qcActionRows.filter(x=>x.shopArrivedCurrent===true).length));
    setText('v768ExceptionEvidence','来源日报：'+qcActionScope.reportDate+' · 快照 '+qcActionScope.snapshotId.slice(0,16)
      +' · 已核对来源 '+fmt(r.qcCoverage?.sourceMembers||0)+' 票 / 最终记录 '+fmt(r.qcCoverage?.finalEvidenceRows||0)+' 票 / 已显示 '+fmt(r.qcCoverage?.evidenceRows||0)+' 票'
      +' · '+(r.qcCoverage?.verifiedZero?'证据完整，当前筛选没有待核验运单':'以已保存的有效轨迹识别')
      +'；责任部门仅为建议，尚未记录下发/处理回执'
      +(qcActionScope.truncated?' · 结果仅覆盖接口返回的前5,000票':''));
    renderExceptionRows();
  }catch(e){
    if(generation!==qcActionGeneration)return;
    qcActionRows=[];qcActionScope=null;qcActionPage=0;
    for(const id of ['v768TotalActionable','exPendingGap','v768Oc2','exShopStay'])setText(id,'—');
    const tbody=byId('v625ExceptionRows');
    if(tbody){tbody.replaceChildren();const tr=document.createElement('tr'),td=document.createElement('td');
      td.colSpan=9;td.textContent='读取失败：'+String(e?.message||e);tr.appendChild(td);tbody.appendChild(tr)}
    setText('v625ExceptionMeta','未取得可信运单结果');
    setText('v768ExceptionEvidence','核验失败；未更新运单状态，也未启动重复扫描');
    for(const id of ['v768CopySelected','v768CopyCurrent','v768CheckAll'])if(byId(id))byId(id).disabled=true;
  }finally{if(generation===qcActionGeneration&&btn)btn.disabled=false}
}

let reportPeriod='daily',generated=[],v652ExportJobId='',v652ExportBusy=false;
function renderExportProgress(job={}){
  const progress=Math.max(0,Math.min(100,Number(job.progress||0)));
  const labels={QUEUED:'等待生成',PREPARING:'准备数据',VALIDATING:'校验数据',GENERATING:'生成Excel',PACKAGING:'整理文件',COMPLETED:'生成完成',FAILED:'生成失败'};
  setText('v652ExportPhase',labels[job.phase]||labels[job.status]||job.phase||'生成报表');
  setText('v652ExportPercent',Math.round(progress)+'%');
  const bar=byId('v652ExportBar');if(bar)bar.style.width=progress+'%';
  const msg=job.status==='FAILED'?(job.error||job.message||'生成失败'):(job.message||'正在生成报表');
  note('v652ExportMessage',msg,job.status==='FAILED'?'error':job.status==='COMPLETED'?'success':'');
}
async function pollExportJob(jobId){
  for(let i=0;i<1800;i++){
    const r=await json('/api/export-period/job/'+encodeURIComponent(jobId),15000);
    const job=r.job||{};renderExportProgress(job);
    if(job.status==='COMPLETED')return job;
    if(job.status==='FAILED')throw new Error(job.error||job.message||'报表生成失败');
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error('报表生成等待超时，请查看报表历史或重试。');
}
async function generateReport(){
  if(v652ExportBusy)return;
  const date=byId('v625ReportDate').value||today(),businessType=byId('v625ReportBusiness').value;
  const btn=byId('v625GenerateReport');
  v652ExportBusy=true;if(btn){btn.disabled=true;btn.textContent='生成中…'}
  renderExportProgress({status:'RUNNING',phase:'PREPARING',progress:1,message:'正在创建报表任务…'});
  try{
    const r=await post('/api/export-period/job',{periodType:reportPeriod,date,businessType},15000);
    v652ExportJobId=r.job?.jobId||'';
    if(!v652ExportJobId)throw new Error('系统未返回报表任务编号。');
    const job=await pollExportJob(v652ExportJobId);
    const files=job.files||[];
    generated=[...files,...generated];
    renderReports();
    setText('v625ReportMeta','生成完成 · '+files.length+' 个文件');
    if(files.length===1){
      const a=document.createElement('a');a.href=files[0].url;a.download=files[0].name;document.body.appendChild(a);a.click();a.remove();
    }
  }catch(e){
    renderExportProgress({status:'FAILED',phase:'FAILED',progress:0,error:e.message});
    setText('v625ReportMeta','生成失败：'+e.message);
  }finally{
    v652ExportBusy=false;if(btn){btn.disabled=false;btn.textContent='生成报表'}
  }
}
function renderReports(){
  const tbody=byId('v625ReportRows');tbody.replaceChildren();
  if(!generated.length){tbody.innerHTML='<tr><td colspan="4">暂无生成记录</td></tr>';return}
  for(const f of generated){
    const tr=document.createElement('tr');
    const td1=document.createElement('td');td1.textContent=f.name;
    const td2=document.createElement('td');td2.textContent=new Date().toLocaleString('zh-CN',{hour12:false});
    const td3=document.createElement('td');td3.innerHTML='<span class="v625-badge success">已完成</span>';
    const td4=document.createElement('td');const a=document.createElement('a');a.href=f.url;a.textContent='下载';a.setAttribute('download',f.name);td4.appendChild(a);
    tr.append(td1,td2,td3,td4);tbody.appendChild(tr)
  }
}

// V788: read-only delivery status available independently of the historical
// D: acceptance copy. No downloads, production writes or TMS requests.
let v788FormalReadinessLoading=false;
async function loadV788FormalReadinessV625(){
  if(page!=='settings')return;
  const out=byId('v788FormalReadinessText');
  const button=byId('v788FormalReadinessRefresh');
  if(!out||v788FormalReadinessLoading)return;
  v788FormalReadinessLoading=true;
  if(button)button.disabled=true;
  out.textContent='正在读取本机已安装版本、72个CP码与隔离验收状态（只读）…';
  try{
    const results=await Promise.allSettled([
      json('/api/admin/data-purge/direct/preflight',13000),
      json('/api/v788/readonly-audit/status',13000)
    ]);
    const release=results[0].status==='fulfilled'?results[0].value:null;
    const audit=results[1].status==='fulfilled'?results[1].value:null;
    const lines=[];
    // The two protected endpoints actually responding confirms this instance
    // is running; it is NOT evidence that it is installed on official main.
    const running=Boolean(release&&audit?.ok===true);
    lines.push('当前系统后端：'+(running?'已响应（管理员只读接口）':'未能完整验证；请检查登录或后台'));
    const version=release?.version||{};
    const installed=String(version.installedCommit||'');
    const formal=version.formalUpdateVerified===true&&
      version.installedThroughManagedUpdaterVerified===true&&
      version.installedOnLocalMain===true&&version.cachedMainMatchesInstalled===true;
    lines.push('本机安装版本：'+(installed?installed.slice(0,12):'无法核实')+
      '；所在分支 '+String(version.installedBranch||'未知'));
    lines.push('正式托管更新：'+(formal?'本机安装凭据已验证':'未验证，不允许把候选版视为正式版'));
    const shops=release?.cp72Ready===true&&Number(release.activeCpCount)===72&&
      release.dataStorageReady===true;
    lines.push('72个有效CP门店配置：'+(shops?'有效名单72个，主数据盘可读':'未达到正式检查条件'));
    lines.push('D盘历史隔离副本：'+(audit?.isolatedSourceReady===true?'已有安全副本，可人工触发只读核验':'未找到可安全读取的既有副本'));
    const checked=String(audit?.existingWhppExcel?.status||'');
    lines.push('WHPP 7月1日至2日真实Excel：'+
      (checked==='XLSX_CONTENT_VERIFIED'?'已有逐票回读通过（仅WHPP）':
        checked?'当前状态 '+checked+'；未通过正式Excel验收':'尚未执行或未完成真实Excel逐票回读'));
    lines.push('历史数据库只读验收：'+
      (audit?.ok===true&&Array.isArray(audit?.gates)?
        String(audit.status||'待核验')+'；阻断 '+Number(audit.counts?.blocked||0)+
        '、待核验 '+Number(audit.counts?.reviewing||0):
        '尚未取得可采信的隔离验收结果'));
    lines.push('七业务真实日报导入、终态、签收天数与报表：仍须独立实机验收');
    lines.push('旧业务数据清空：此检查不授权清空；必须另行管理员二次确认');
    if(!running)lines.push('下一步：先恢复正式后台及管理员登录，重新执行只读检查。');
    else if(!formal)lines.push('下一步：先走正式候选版本审核、合并发布与托管更新；当前不得清空。');
    else if(!shops)lines.push('下一步：核查当前72个有效门店码及主数据盘，不可使用旧名单凑数。');
    else if(audit?.isolatedSourceReady!==true)
      lines.push('下一步：从现有文件确认隔离副本；该检查不会退回读取正式数据库。');
    else lines.push('下一步：通过下方隔离只读验收，并核对真实Excel、七业务和导出；通过前不清空。');
    out.textContent=lines.join('\n');
  }catch{
    out.textContent='本机交付状态检查失败。未触发更新、清空、TMS查询或业务写入。';
  }finally{
    v788FormalReadinessLoading=false;
    if(button)button.disabled=false;
  }
}

// V788 isolated WHPP trial lives in the REAL V625 shell (not the legacy app.js).
// It never auto-queries CE TMS. Only explicit ADMIN click may run a stage.
let v788CeSessionReady=false;
let v788ReadOnlyAuditPosting=false;
let v788ReadOnlyAuditTimer=null;
const v788GateNames={
  ACTIVE_CP_72:'72个有效门店编码',
  SEVEN_BUSINESS_LATEST_SOURCES:'七业务最新日报来源',
  WHPP_TERMINAL_CONFLICTS:'WHPP终态冲突',
  WHPP_LATE_TMS_NEEDS_STATE_SYNC:'WHPP旧状态待同步',
  WHPP_LEDGER_VS_CURRENT:'WHPP历史账本',
  WHPP_POD_SIGNING_TIME:'WHPP可信签收时间',
  WHPP_TERMINAL_EVIDENCE:'WHPP直接TMS终态证据',
  REAL_EXCEL_DETAIL_READBACK:'七业务真实Excel逐票回读',
  WHPP_EXISTING_REAL_XLSX:'WHPP已有真实导出文件逐票回读'
};
async function loadV788ReadOnlyAuditV625(){
  if(page!=='settings')return;
  const info=byId('v788ReadOnlyAuditText'),button=byId('v788ReadOnlyAuditStart');
  if(!info||!button)return;
  try{
    const data=await json('/api/v788/readonly-audit/status',13000);
    const running=data.active===true||data.status==='RUNNING';
    const status=String(data.status||'NOT_STARTED');
    const lines=[];
    if(running)lines.push('只读验收正在检查隔离副本，请勿重复启动。');
    else if(data.ok===true&&Array.isArray(data.gates)){
      const n=data.counts||{};
      lines.push('检查结果：'+status+'；通过 '+Number(n.passed||0)+
        '、阻断 '+Number(n.blocked||0)+'、待核验 '+Number(n.reviewing||0)+' 项。');
      if(data.independentTmsProofReady===true){
        lines.push('独立TMS证据库：已核实346票逐票成员（POD 290、已退回 56），仅代表历史终态证据完整。');
        const timing=data.podTimeInventory;
        if(timing?.available===true)
          lines.push('独立来源签收时间候选 '+Number(timing.timeCandidateMembers||0)+
            '票；无明确时间 '+Number(timing.missingTimeMembers||0)+
            '票；待复核 '+Number(timing.manualReviewMembers||0)+
            '票。候选并非正式签收时间。');
      }else
        lines.push('独立TMS逐票证据未通过签名和来源校验，不能据此放行。');
      if(data.auditSchemaAvailable!==true)
        lines.push('旧业务库验收表缺失或结构不兼容，历史账本/门店/七业务暂不能出结论。');
      else lines.push('旧业务库 WHPP '+Number(data.members||0)+'票，旧OPEN账本与终态不一致 '+
        Number(data.ledgerOpenWithNormalizedTerminal||0)+'票，可信POD时间锁 '+
        Number(data.trustedPodLockOnPOD||0)+'票。');
      if(data.existingWhppExcel?.status==='XLSX_CONTENT_VERIFIED'){
        const e=data.existingWhppExcel;
        lines.push('本机已有WHPP真实Excel逐票回读通过：总票 '+Number(e.rows||0)+
          '，POD '+Number(e.pod||0)+'，已退回 '+Number(e.returned||0)+
          '。这不代表七业务综合Excel或历史签收时间通过。');
      }
      for(const gate of data.gates.filter(g=>g.status!=='PASS')){
        const name=String(gate.label||v788GateNames[gate.id]||'其他验收项');
        const summary=String(gate.summary||'证据不足，需进一步核对');
        const next=String(gate.next||'保留阻断，不修改正式数据');
        lines.push('['+(gate.status==='BLOCK'?'阻断':'待核验')+'] '+name+
          '：'+summary+' 处理方向：'+next);
      }
      lines.push('此为数据库副本只读诊断，并非正式Excel回读或发布批准。');
    }else if(status==='BLOCKED')lines.push('隔离副本检查不可用或缺少必要数据表；未触碰正式数据库。');
    else lines.push('尚未运行真实隔离数据库验收。已有TMS证据不会因此被重新查询。');
    if(data.isolatedSourceReady!==true)
      lines.push('没有找到安全的D盘验收副本；不能回退读取正式数据库。');
    info.textContent=lines.join('\n');
    button.disabled=running||v788ReadOnlyAuditPosting
      ||data.platformReady!==true||data.isolatedSourceReady!==true;
    button.textContent=running?'只读核验中…':'只读核验现有隔离副本';
    if(v788ReadOnlyAuditTimer){clearTimeout(v788ReadOnlyAuditTimer);v788ReadOnlyAuditTimer=null}
    if(running)v788ReadOnlyAuditTimer=setTimeout(()=>{void loadV788ReadOnlyAuditV625()},4000);
  }catch(error){
    if(Number(error?.status)===403)return;
    info.textContent='只读核验状态无法读取，未发起TMS查询。';
    button.disabled=true;
  }
}
async function startV788ReadOnlyAuditV625(){
  const button=byId('v788ReadOnlyAuditStart');
  if(v788ReadOnlyAuditPosting||button?.disabled)return;
  v788ReadOnlyAuditPosting=true;button.disabled=true;
  try{
    await post('/api/v788/readonly-audit/start',{acknowledgeReadOnlyAudit:true},12000);
    await loadV788ReadOnlyAuditV625();
  }catch{
    setText('v788ReadOnlyAuditText','隔离只读核验未启动。未查询TMS，未修改正式数据库。');
  }finally{v788ReadOnlyAuditPosting=false}
}
let v788EvidencePosting=false;
let v788EvidenceTimer=null;
async function loadV788WhppEvidenceV625(){
  if(page!=='settings')return;
  const panel=byId('v788WhppEvidencePanel'),info=byId('v788WhppEvidenceText');
  const button=byId('v788WhppEvidenceStart');
  if(!panel||!info||!button)return;
  try{
    const data=await json('/api/v788/whpp-evidence/status',13000);
    panel.hidden=false;
    void loadV788ReadOnlyAuditV625();
    const covered=Number(data.savedMembers||0),batches=Number(data.completedBatches||0);
    const running=data.active===true||data.status==='RUNNING';
    const allSaved=covered===346&&batches===8;
    // Verified proof from the independent SQLite, not last-run JSON progress,
    // owns completion. A stale/interrupted report must not hide saved evidence
    // or encourage a second 346-waybill TMS query.
    const full=allSaved&&data.independentlyVerifiedCounts===true
      &&data.sidecarVerified===true&&data.isolatedSourceReady===true
      &&data.distributionMatchesV3===true
      &&data.statusOnlyPreview?.source==='INDEPENDENT_ISOLATED_SQLITE';
    const finalizeOffline=allSaved&&data.status==='INTERRUPTED_RETRYABLE';
    const needsReview=allSaved&&!full&&!finalizeOffline;
    const lines=[];
    if(full){
      lines.push('WHPP历史状态只读预览可用：346票，POD '+Number(data.pod||0)+'票，已退回 '+Number(data.returned||0)+'票。');
      for(const d of data.statusOnlyPreview?.dates||[])
        if(['2026-07-01','2026-07-02'].includes(d.date))
          lines.push(d.date+'：'+Number(d.total||0)+'票，POD '+Number(d.pod||0)+'票，已退回 '+Number(d.returned||0)+'票。');
      // This count comes from a second read of the independent SQLite
      // evidence, not the editable JSON progress report.
      if(data.independentPodTimeEvidenceChecked===true){
        lines.push('独立TMS明确签收时间：'+Number(data.independentTrustedPodTimeCount||0)+
          '/'+Number(data.pod||0)+'票；仍缺'+Number(data.independentMissingPodTimeCount||0)+
          '票。该证据尚未写入正式签收时间账本。');
      }
      const timeSources=data.podTimeSourceInventory;
      if(timeSources?.available===true){
        const n=value=>Math.max(0,Number.isFinite(Number(value))?Math.floor(Number(value)):0);
        lines.push('隔离库签收时间来源诊断：290票POD中，存在明确时间候选 '+
          n(timeSources.timeCandidateMembers)+'票，仍无明确时间 '+
          n(timeSources.missingTimeMembers)+'票，跨来源时间冲突 '+
          n(timeSources.conflictingTimeMembers)+'票，重复/歧义来源 '+
          n(timeSources.ambiguousSourceMembers)+'票。');
        const src=timeSources.bySource||{};
        lines.push('证据来源次数：独立TMS '+n(src.sidecar)+
          '、POD时间锁 '+n(src.podLock)+'、已存TMS轨迹 '+
          n(src.savedTrack)+'、已存轨迹事件 '+n(src.savedEvent)+
          '、扫描 '+n(src.savedScan)+'、最终记录 '+
          n(src.savedFinal)+'。同一票可存在多处来源，不能直接相加。');
        lines.push('其中无冲突且无重复来源候选 '+n(timeSources.unambiguousTimeCandidateMembers)+
          '票，需人工复核 '+n(timeSources.manualReviewMembers)+
          '票（不同原因可能重叠）。候选时间尚未批准用于签收天数。');
      }else if(timeSources)
        lines.push('隔离库签收时间来源诊断未完成，不能将缺少证据直接认作0票。');
      const rec=data.ledgerReconciliation;
      if(rec?.ready===true){
        lines.push('旧账本待同步：POD '+Number(rec.ledgerNeedsPODSync||0)+
          '票、已退回 '+Number(rec.ledgerNeedsReturnedSync||0)+'票；当前状态待同步：POD '+
          Number(rec.currentNeedsPODSync||0)+'票、已退回 '+
          Number(rec.currentNeedsReturnedSync||0)+'票。');
        lines.push('该结果仅为独立副本只读对账；尚未修改历史账本或正式数据库。');
      }else if(rec){
        // A blocked reconciliation must explain the *aggregate* reason.
        // Never surface waybill IDs, raw ledger entries or unsafe file paths.
        const n=key=>Math.max(0,Number.isFinite(Number(rec[key]))?Math.floor(Number(rec[key])):0);
        const missing=n('currentMissingOrDuplicate')+n('ledgerMissingOrDuplicate');
        const opposite=n('currentOppositeTerminal')+n('ledgerOppositeTerminal');
        const needsPod=n('currentNeedsPODSync')+n('ledgerNeedsPODSync');
        const needsReturn=n('currentNeedsReturnedSync')+n('ledgerNeedsReturnedSync');
        if(rec.reason==='ISOLATED_LEDGER_PREVIEW_UNAVAILABLE')
          lines.push('历史账本：隔离副本账本只读检查暂不可用，不能据此判断账本已闭环。');
        else if(['SOURCE_SIGNATURE_MISMATCH','CROSS_DATE_LEDGER_AMBIGUOUS','NONTERMINAL_TMS_MEMBER'].includes(rec.reason))
          lines.push('历史账本：证据存在来源差异、跨日期歧义或非终态记录，必须人工核验，禁止自动同步。');
        else{
          lines.push('历史账本待核验：状态表缺失或重复 '+n('currentMissingOrDuplicate')+
            ' 票，账本缺失或重复 '+n('ledgerMissingOrDuplicate')+
            ' 票，相反终态 '+opposite+' 处；');
          lines.push('旧记录待同步线索：POD '+needsPod+' 处、已退回 '+needsReturn+
            ' 处。统计为状态表与账本差异次数，并非去重运单票数。');
        }
        lines.push('对账未通过，仅展示隔离副本汇总；尚未修改历史账本或正式数据库。');
      }
    }else if(running)lines.push('正在核验：已保存 '+covered+'/346票，'+batches+'/8批。');
    else if(needsReview)lines.push('346票证据已存在，但来源、状态或签名校验未通过；请复核，不允许重复查询。');
    else if(data.status==='FAILED')lines.push('核验失败：'+String(data.message||'请查看登录及隔离副本状态'));
    else if(data.resumeAvailable||finalizeOffline)lines.push('上次核验中断，已保存 '+covered+'/346票、'+batches+'/8批，允许安全续查。');
    else lines.push('尚未保存完整346票逐票证据。已经完成的只读TMS汇总不需要重新上传。');
    lines.push('本阶段只核验历史状态；签收时间、账本、正式导出尚未放行。');
    if(data.isolatedSourceReady!==true)
      lines.push('没有找到安全的D盘V788验收副本。此页面不会读取正式数据库，也不会启动TMS查询。');
    const loginRequired=!v788CeSessionReady&&!finalizeOffline;
    if(loginRequired&&!full&&!running)
      lines.push('CE系统接口凭证未就绪，请先在上方登录CE系统。');
    info.textContent=lines.join(' ');
    button.disabled=running||v788EvidencePosting||full||needsReview||loginRequired
      ||data.platformReady!==true||data.isolatedSourceReady!==true;
    button.textContent=running?'正在核验…':full?'346票状态已核实'
      :needsReview?'需复核，禁止重复查询'
      :(data.resumeAvailable||finalizeOffline)?'继续安全核验（保留已有批次）':'开始隔离核验（346票）';
    if(v788EvidenceTimer){clearTimeout(v788EvidenceTimer);v788EvidenceTimer=null}
    if(running&&page==='settings')
      v788EvidenceTimer=setTimeout(()=>{void loadV788WhppEvidenceV625()},4000);
  }catch(error){
    if(Number(error?.status)===403){panel.hidden=true;return}
    panel.hidden=false;
    info.textContent='核验状态暂不可用：'+String(error?.message||'请稍后刷新')+'。没有发起TMS查询。';
    button.disabled=true;
  }
}
async function startV788WhppEvidenceV625(){
  const button=byId('v788WhppEvidenceStart');
  if(v788EvidencePosting||button?.disabled)return;
  if(!confirm('仅查询V788隔离副本的346票，并在独立证据库留存逐票TMS状态。不会修改正式数据库、POD时间或历史账本。确认开始？'))return;
  v788EvidencePosting=true;
  button.disabled=true;
  try{
    await post('/api/v788/whpp-evidence/start',{acknowledgeIsolatedQuery:true},12000);
    await loadV788WhppEvidenceV625();
  }catch(error){
    setText('v788WhppEvidenceText','任务未启动：'+String(error?.message||'请重新登录CE系统'));
  }finally{
    v788EvidencePosting=false;
  }
}

async function loadSettings(){
  const [sessionR,ceR,stateR]=await Promise.allSettled([json('/api/session',7000),json('/api/ce-auth-status',7000),json('/api/state?compact=1',7000)]);
  if(sessionR.status==='fulfilled'){
    const u=sessionR.value.user||{};
    setText('v625SettingsUser',u.displayName||u.username);
    setText('v625SettingsRole',u.role);
    setText('v625SettingsEmail',u.email||u.username);
  }
  if(ceR.status==='fulfilled'){
    const a=ceR.value.authStatus||{};
    v788CeSessionReady=Boolean(a.loggedIn&&a.hasAccessToken&&!a.expired
      &&Number(a.expiresInSeconds||0)>120);
    setText('v625CeStatus',v788CeSessionReady?'已连接':'未连接');
    if(a.tenantId)byId('v625CeTenant').value=a.tenantId;
    if(a.account)byId('v625CeUser').value=a.account;
    note('v625CeMessage',a.loggedIn?'CE账号 '+(a.account||'—')+' 已连接':'CE系统当前未登录。',a.loggedIn?'success':'');
  }
  if(stateR.status==='fulfilled'){
    const s=stateR.value.state||{},db=s.dbStatus||{},net=s.network||{},shops=s.shopCodes||{};
    const dbLabel=(db.sqlite||'正常')+(db.lastProcessedReportDate?' · '+db.lastProcessedReportDate:'');
    setText('v625DbState',dbLabel);
    setText('v625MaintenanceDb',dbLabel);
    setText('v625LocalUrl',net.localUrl||location.origin);
    setText('v625LanUrl',net.lanUrl||'未启用');
    setText('v625ShopMeta',fmt(num(first(shops,['count','total','active','size']))??0)+' 个CP码');
    void loadCompleteShopStatus();
  }
}

function switchSettingsTab(name){
  qa('#v625SettingsTabs [data-settings-tab]').forEach(btn=>btn.classList.toggle('active',btn.dataset.settingsTab===name));
  qa('[data-settings-panel]').forEach(panel=>panel.hidden=panel.dataset.settingsPanel!==name);
  if(name==='accounts')void loadSettingsUsers();
  if(name==='interface'){void loadV788FormalReadinessV625();void loadSettings().then(()=>loadV788WhppEvidenceV625());}
  if(name==='maintenance')void loadSettingsBackups();
}

function closeUserEditor(){
  const editor=byId('v625UserEditor');if(editor)editor.hidden=true;
  byId('v625EditUserId').value='';
  byId('v625AccountUsername').disabled=false;
  byId('v625TempPasswordWrap').hidden=false;
  byId('v625AccountUsername').value='';
  byId('v625AccountDisplayName').value='';
  byId('v625AccountEmail').value='';
  byId('v625AccountRole').value='VIEWER';
  byId('v625AccountScope').value='ALL';
  byId('v625AccountPassword').value='';
  note('v625AccountMessage','新增用户需要至少10位临时密码。');
}
function openUserEditor(user=null){
  const editor=byId('v625UserEditor');if(!editor)return;
  editor.hidden=false;
  if(user){
    setText('v625UserEditorTitle','编辑用户');
    byId('v625EditUserId').value=user.id;
    byId('v625AccountUsername').value=user.username||'';
    byId('v625AccountUsername').disabled=true;
    byId('v625AccountDisplayName').value=user.displayName||'';
    byId('v625AccountEmail').value=user.email||'';
    byId('v625AccountRole').value=user.role||'VIEWER';
    byId('v625AccountScope').value=user.businessScope||'ALL';
    byId('v625TempPasswordWrap').hidden=true;
    byId('v625AccountPassword').value='';
    note('v625AccountMessage','编辑用户资料后点击保存。');
  }else{
    closeUserEditor();
    editor.hidden=false;
    setText('v625UserEditorTitle','新增用户');
  }
}
async function saveSettingsUser(){
  const id=Number(byId('v625EditUserId').value||0);
  const payload={
    displayName:byId('v625AccountDisplayName').value.trim(),
    email:byId('v625AccountEmail').value.trim(),
    role:byId('v625AccountRole').value,
    businessScope:byId('v625AccountScope').value
  };
  try{
    if(id){
      await request('/api/admin/users/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},15000);
      note('v625AccountMessage','用户资料已保存。','success');
    }else{
      payload.username=byId('v625AccountUsername').value.trim();
      payload.temporaryPassword=byId('v625AccountPassword').value;
      await request('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},15000);
      note('v625AccountMessage','用户创建成功。','success');
    }
    await loadSettingsUsers();
    setTimeout(closeUserEditor,500);
  }catch(e){note('v625AccountMessage','保存失败：'+e.message,'error')}
}
async function toggleSettingsUser(user){
  try{
    await request('/api/admin/users/'+user.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!Boolean(user.enabled)})},15000);
    await loadSettingsUsers();
  }catch(e){note('v625AccountMessage','状态更新失败：'+e.message,'error')}
}
function renderSettingsUsers(){
  const tbody=byId('v625SettingsUserRows');if(!tbody)return;
  tbody.replaceChildren();
  if(!settingsUsers.length){tbody.innerHTML='<tr><td colspan="7">暂无用户</td></tr>';return}
  for(const user of settingsUsers){
    const tr=document.createElement('tr');
    const cells=[
      user.username||'—',
      user.displayName||'—',
      user.role||'—',
      user.businessScope||'ALL',
      user.enabled?'启用':'停用',
      dateTime(user.lastLoginAt)
    ];
    for(const value of cells){const td=document.createElement('td');td.textContent=value;tr.appendChild(td)}
    const actionTd=document.createElement('td');
    const wrap=document.createElement('div');wrap.className='v625-table-action';
    const edit=document.createElement('button');edit.type='button';edit.textContent='编辑';edit.addEventListener('click',()=>openUserEditor(user));
    const toggle=document.createElement('button');toggle.type='button';toggle.textContent=user.enabled?'停用':'启用';toggle.className=user.enabled?'danger':'success';toggle.addEventListener('click',()=>toggleSettingsUser(user));
    wrap.append(edit,toggle);actionTd.appendChild(wrap);tr.appendChild(actionTd);tbody.appendChild(tr);
  }
}
async function loadSettingsUsers(){
  const tbody=byId('v625SettingsUserRows');if(tbody)tbody.innerHTML='<tr><td colspan="7">正在读取…</td></tr>';
  try{
    const r=await json('/api/admin/users',15000);
    settingsUsers=Array.isArray(r.rows)?r.rows:[];
    renderSettingsUsers();
  }catch(e){
    const status=Number(e?.status||0);
    const code=String(e?.payload?.code||e?.code||'').trim();
    const reason=status===401?'登录会话失效，请在当前系统地址重新登录。'
      :status===403?'当前会话没有管理员权限，请核对登录账号。'
      :e?.code==='CLIENT_WAIT_TIMEOUT'?'账号列表读取超过15秒，可能是数据库繁忙；请稍后重试。'
      :e?.message||'账号列表读取失败。';
    if(tbody){
      tbody.replaceChildren();
      const tr=document.createElement('tr'),td=document.createElement('td');
      td.colSpan=7;
      td.textContent='读取失败：'+reason+(status?'（HTTP '+status+(code?', '+code:'')+'）':code?'（'+code+'）':'');
      tr.appendChild(td);tbody.appendChild(tr);
    }
    console.warn('[CE-QC][V758] admin users list fetch failed',{status,code,message:reason});
  }
}
async function runV758WhppReadOnlyDiagnostic(){
  const view=byId('v758WhppDiagnosticResult'),button=byId('v758WhppReadOnlyDiagnostic');
  if(!view)return;
  const displayed=String(byId('v626ImportProgressDate')?.textContent||'').trim();
  const params=currentParams();
  const date=String((/^\d{4}-\d{2}-\d{2}$/.test(displayed)?displayed:'')||v626LatestImport?.reportDate||params.get('reportDate')||'').slice(0,10);
  view.hidden=false;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){view.textContent='未找到有效日报日期。请先打开对应日期的导入记录。';return}
  if(button){button.disabled=true;button.textContent='读取诊断中…'}
  view.textContent='正在通过当前登录会话读取 '+date+' 的WHPP持久证据（只读，不扫描、不修改数据）…';
  try{
    // Relative URL and same-origin credentials ensure the session used by the open
    // application is also used by this diagnostic, without bypassing accessIdentity.
    const response=await json('/api/selected-date-truth?reportDate='+encodeURIComponent(date),20000);
    v759RememberWhppProof(response,date);
    void refreshLiveProgress();
    const truth=response?.whppCompletion||{};
    const coverage=truth.terminalEvidenceCoverage||{};
    const report={
      reportDate:date,
      unifiedStatus:response?.unified?.status||'',
      whppCompletion:{
        locked:truth.locked===true,
        reason:truth.reason||'',
        completionSource:truth.completionSource||'',
        sourceCount:Number(truth.sourceCount||0),
        independentWhppCount:Number(truth.independentWhppCount||truth.canonicalTotal||0),
        missingScans:Number(truth.missingScans||0),missingFinals:Number(truth.missingFinals||0),
        processingEvidenceMissing:truth.processingEvidenceMissing===true,
        finalCount:Number(truth.finalCount||0),
        canonicalTotal:Number(truth.canonicalTotal||0),
        canonicalResolved:Number(truth.canonicalResolved||0),
        membershipMatches:truth.membershipMatches===true,
        terminalEvidenceVerified:truth.terminalEvidenceVerified===true,
        terminalEvidenceCoverage:coverage,
        terminalEvidenceGaps:truth.terminalEvidenceGaps||[],
        snapshotLocked:truth.snapshotLocked===true,
        dailyLocked:truth.dailyLocked===true,
        historyLocked:truth.historyLocked===true,
        unifiedWhppCompleted:truth.unifiedWhppCompleted===true
      }
    };
    const whppCount=Number(truth.canonicalTotal||0);
    const scans=Number(coverage.scanRows||0),finals=Number(coverage.finalRows||0);
    const missingScans=Math.max(0,whppCount-scans),missingFinals=Math.max(0,whppCount-finals);
    const processingMissing=missingScans>0||missingFinals>0;
    const summary='WHPP '+(truth.locked===true?'处理证据核验通过':'仍缺处理证据')+
      ' · 独立日报 '+whppCount+'票（统一导入WHPP分区 '+Number(truth.sourceCount||0)+'票）'+
      ' · 已扫描 '+scans+'票 · 已保存最终记录 '+finals+'票'+
      ' · 缺扫描 '+missingScans+'票 · 缺最终记录 '+missingFinals+'票'+
      ' · POD '+Number(coverage.podRows||0)+'票 · 已退回 '+Number(coverage.returnedRows||0)+'票'+
      (processingMissing?'\\n缺失的是扫描/处理证据，不能将未确认成员直接归为Pending；从原日报继续处理即可。':'\\n扫描与最终记录完整；尚未POD/退回的运单继续追踪。')+
      '\\n原因：'+String(truth.reason||'未知')+
      '\\n完成依据：'+String(truth.completionSource||'无')+'\\n\\n';
    view.textContent=summary+JSON.stringify(report,null,2);
  }catch(error){
    const status=Number(error?.status||0),code=String(error?.payload?.code||error?.code||'');
    const reason=status===401?'本页面的登录会话已失效；请使用同一系统地址重新登录。'
      :status===403?'本会话没有诊断读取权限。'
      :error?.message||'诊断服务读取失败。';
    view.textContent='诊断未能读取（业务数据未修改）：'+reason+(status?'\nHTTP '+status:'')+(code?' · '+code:'');
  }finally{
    if(button){button.disabled=false;button.textContent='诊断WHPP完成状态（只读）'}
  }
}
async function loadSettingsBackups(){
  try{
    const r=await json('/api/backups',7000),rows=r.backups||[];
    setText('v625SettingsBackupMeta',rows.length+' 条备份');
    setText('v625LastBackup',rows.length?dateTime(rows[0].createdAt||rows[0].created_at):'暂无备份');
    note('v625SettingsBackupMessage','备份系统正常，共 '+rows.length+' 条记录。','success');
    const tbody=byId('v625SettingsBackupRows');if(!tbody)return;tbody.replaceChildren();
    if(!rows.length){tbody.innerHTML='<tr><td colspan="4">暂无备份</td></tr>';return}
    for(const x of rows.slice(0,10))tbody.appendChild(rowTr([
      dateTime(x.createdAt||x.created_at),
      x.fileName||'—',
      x.backupType||x.reason||'数据库备份',
      x.fileSize?fmt(Math.round(x.fileSize/1024/1024))+' MB':'—'
    ]));
  }catch(e){
    note('v625SettingsBackupMessage','备份状态读取失败：'+e.message,'error');
    const tbody=byId('v625SettingsBackupRows');if(tbody)tbody.innerHTML='<tr><td colspan="4">读取失败</td></tr>';
  }
}
async function settingsBackupNow(){
  note('v625SettingsBackupMessage','正在创建数据库备份…');
  try{
    await post('/api/admin/backup-now',{},60000);
    note('v625SettingsBackupMessage','数据库备份创建成功。','success');
    await loadSettingsBackups();
  }catch(e){note('v625SettingsBackupMessage','备份失败：'+e.message,'error')}
}
async function ceLogin(){try{const r=await post('/api/ce-login',{tenantId:byId('v625CeTenant').value||'000000',username:byId('v625CeUser').value.trim(),password:byId('v625CePassword').value},30000);byId('v625CePassword').value='';setText('v625CeStatus','已连接');note('v625CeMessage','CE登录成功：'+(r.authStatus?.account||''),'success');await loadSettings();void loadV788WhppEvidenceV625()}catch(e){note('v625CeMessage','登录失败：'+e.message,'error')}}
async function ceLogout(){try{await post('/api/ce-logout',{},15000);v788CeSessionReady=false;setText('v625CeStatus','未连接');note('v625CeMessage','已退出CE系统。','success');void loadV788WhppEvidenceV625()}catch(e){note('v625CeMessage','退出失败：'+e.message,'error')}}
let v780CandidateShopSource = '';
let v780CandidateShopHash = '';
async function loadCompleteShopStatus(){
  try{
    const data=await json('/api/admin/shop-codes/complete-status',10000);
    v780CandidateShopSource=String(data.candidateSource||'');
    v780CandidateShopHash=String(data.candidateHash||'');
    const status=data.active
      ?(data.needsActivation?'已有新保存名单尚未激活；当前仍使用原72码 · 新文件 '+data.candidateSource:'已激活完整名单：'+data.activeCount+'码 · '+(data.activeSource||'')+'；旧编码不参与当前到店判定')
      :'尚未激活完整名单；最新已保存文件 '+(data.candidateSource||'无')+'：'+data.candidateCount+'码';
    setText('v780ActiveShopStatus',status);
    setText('v780ShopSpotCheck',data.active
      ?'当前名单抽查：'+(data.activeSamples||[]).map(s=>s.code+' '+s.name).join('；')+
       '。已停用旧编码 '+(data.historicalExcludedCount||0)+' 个（如 '+(data.inactiveExamples||[]).join('、')+'），只保留历史参考。'
      :'待激活文件：'+(data.candidateSource||'无')+'；请先确认候选数量为72。');
    const activate=byId('v780ActivateSavedShops');
    if(activate) activate.disabled=!data.readyToActivate;
    if(data.active)setText('v625ShopMeta','当前有效 '+data.activeCount+' 个门店编码 · 完整名单');
  }catch(error){setText('v780ActiveShopStatus','无法核验门店名单：'+(error?.message||error));}
}
async function activateSavedShopCodes(){
  const btn=byId('v780ActivateSavedShops');
  if(btn)btn.disabled=true;
  try{
    if(!v780CandidateShopSource)await loadCompleteShopStatus();
    if(!v780CandidateShopSource||!v780CandidateShopHash)throw new Error('请先刷新门店名单，确认72码来源与校验值后再激活');
    const r=await post('/api/admin/shop-codes/activate-complete',{
      sourceFile:v780CandidateShopSource,expectedCount:72,expectedHash:v780CandidateShopHash
    },20000);
    v748QualityRefreshKeys.clear();
    setText('v625ShopMeta','当前有效 '+r.activeCount+' 个门店编码 · 完整名单');
    setText('v780ActiveShopStatus','完整72码激活成功 · '+r.sourceFile+' · 旧门店不会再计入当前到店');
    await loadCompleteShopStatus();
  }catch(error){
    setText('v780ActiveShopStatus','完整名单未激活：'+(error?.message||error));
    if(btn)btn.disabled=false;
  }
}
async function importShop(){const file=byId('v625ShopFile').files?.[0];if(!file)return;const fd=new FormData();fd.append('file',file);try{const r=await request('/api/import-shop-codes',{method:'POST',body:fd},60000);v748QualityRefreshKeys.clear();setText('v625ShopMeta','保存完成 · '+fmt(r.imported?.imported||0)+'码，需激活完整名单后生效');void loadCompleteShopStatus();if(page==='business'&&v628BusinessReportDate)void refreshV748BusinessTrackQuality(v628BusinessReportDate)}catch(e){setText('v625ShopMeta','更新失败：'+e.message)}}

async function loadLogs(){
  try{
    const r=await json('/api/admin/audit-logs',7000),rows=r.rows||[];setText('v625AuditMeta',rows.length+' 条');
    const tbody=byId('v625AuditRows');tbody.replaceChildren();
    if(!rows.length){tbody.innerHTML='<tr><td colspan="5">暂无操作日志</td></tr>';return}
    for(const x of rows)tbody.appendChild(rowTr([dateTime(x.createdAt),x.userEmail||'—',x.action||'—',[x.businessType,x.reportDate].filter(Boolean).join(' · ')||'—',x.ipAddress||'—']));
  }catch(e){byId('v625AuditRows').innerHTML='<tr><td colspan="5">无管理员权限或读取失败</td></tr>'}
}
function bytesLabel(value){
  const n=Number(value||0);if(!n)return '—';
  if(n>=1024**3)return (n/1024**3).toFixed(1)+' GB';
  if(n>=1024**2)return (n/1024**2).toFixed(1)+' MB';
  if(n>=1024)return (n/1024).toFixed(1)+' KB';return n+' B';
}
function switchDataTab(name){
  qa('#v626DataTabs [data-data-tab]').forEach(btn=>btn.classList.toggle('active',btn.dataset.dataTab===name));
  qa('[data-data-panel]').forEach(panel=>panel.hidden=panel.dataset.dataPanel!==name);
  if(name==='backup'||name==='storage')void loadBackups();
}
function renderStorage(storage={}){
  setText('v626DatabaseDrive',storage.databaseDrive||'—');setText('v626DatabaseFile',storage.databaseFile||'—');
  setText('v626BackupDrive',storage.selectedDrive||'—');setText('v626BackupDirectory',storage.selectedDirectory||storage.directory||'—');
  const root=byId('v626DriveCards');if(!root)return;root.replaceChildren();
  const candidates=storage.candidates||[];
  if(!candidates.length){root.innerHTML='<div class="v625-empty-state">未读取到磁盘候选状态</div>';return}
  for(const item of candidates){
    const card=document.createElement('article');card.className='v626-drive-card'+(item.drive===storage.selectedDrive?' selected':'');
    const h=document.createElement('div');h.innerHTML='<b>'+esc(item.drive||item.directory)+'</b><span>'+(item.writable?'可写':'不可用')+'</span>';
    const p=document.createElement('p');p.textContent='剩余 '+bytesLabel(item.freeBytes)+' / 总计 '+bytesLabel(item.totalBytes);
    const small=document.createElement('small');small.textContent=item.directory+(item.error?' · '+item.error:'');
    card.append(h,p,small);root.appendChild(card);
  }
}
async function loadBackups(){
  try{
    const r=await json('/api/backups',10000),rows=r.backups||[],storage=r.backupStorage||{};
    setText('v625BackupMeta',rows.length+' 条');renderStorage(storage);
    const tbody=byId('v625BackupRows');if(tbody){tbody.replaceChildren();
      if(!rows.length)tbody.innerHTML='<tr><td colspan="5">暂无备份</td></tr>';
      else for(const x of rows.slice(0,50))tbody.appendChild(rowTr([dateTime(x.createdAt||x.created_at),x.fileName||'—',x.backupType||x.reason||'数据库备份',x.fileSize?bytesLabel(x.fileSize):'—',x.filePath||storage.selectedDirectory||'—']));
    }
  }catch(e){const tbody=byId('v625BackupRows');if(tbody)tbody.innerHTML='<tr><td colspan="5">备份记录读取失败：'+esc(e.message)+'</td></tr>'}
}
async function backupNow(){
  const message=byId('v626ClearStatus');if(message)note('v626ClearStatus','正在创建数据库备份，系统会自动选择C/D盘。');
  try{const r=await post('/api/admin/backup-now',{},90000);if(message)note('v626ClearStatus','数据库备份完成：'+(r.fileName||r.backup?.fileName||'已保存')+'。','success');await loadBackups()}
  catch(e){if(message)note('v626ClearStatus','备份失败：'+e.message,'error');else alert(e.message)}
}
async function pollDirectPurge(jobId){
  for(let i=0;i<1200;i++){
    const r=await json('/api/admin/data-purge/direct/status?jobId='+encodeURIComponent(jobId),10000);
    note('v626ClearStatus',r.message||r.stage||'正在清空业务数据…',r.status==='FAILED'?'error':'');
    if(r.status==='SUCCEEDED')return r;if(r.status==='FAILED')throw new Error(r.error||r.message||'清空失败');
    await new Promise(resolve=>setTimeout(resolve,800));
  }
  throw new Error('清空任务超时');
}
let v788MainClearSubmitting=false;
async function clearAllBusinessData(){
  if(v788MainClearSubmitting)return;
  v788MainClearSubmitting=true;
  const clearButton=byId('v626ClearAllData');
  if(clearButton)clearButton.disabled=true;
  try{
    // Do not use an earlier dashboard snapshot or cached green flag here.
    // The official installed main version and protected CP72 must be checked
    // from the live server immediately BEFORE both confirmations.
    const preflight=await json('/api/admin/data-purge/direct/preflight',13000);
    const v=preflight?.version||{};
    const official=v.formalUpdateVerified===true&&
      v.installedThroughManagedUpdaterVerified===true&&
      v.installedOnLocalMain===true&&v.cachedMainMatchesInstalled===true;
    if(!official)throw new Error('未安装已验收的正式托管更新版本；候选分支不可清空。');
    if(preflight?.cp72Ready!==true||Number(preflight.activeCpCount)!==72||
      preflight.dataStorageReady!==true||preflight.safeToStartClear!==true||
      preflight.alreadyClearedNoFreshBusiness===true)
      throw new Error('72个有效CP码、主数据盘或上次清空防重放未通过检查，已拒绝清空。');
    const commit=String(v.installedCommit||'').slice(0,12);
    const understood=confirm('首次确认：本机正式版本 '+commit+
      ' 已核实，72个有效CP码已保留。\n\n即将永久清空日报、POD、退回、轨迹及其他业务数据和可再生成业务文件；不会新建备份，已有备份保留。账号、权限及门店CP名单保留。\n\n本操作不可撤销，确认继续？');
    if(!understood){
      note('v626ClearStatus','管理员取消了首次确认，业务数据未修改。');
      return;
    }
    // Require an actual second deliberate action, not a literal phrase
    // hardcoded into a POST fired by a single click.
    const phrase=prompt('最终二次确认：请输入“永久清除全部业务数据”完整文字后，才允许执行。\n\n取消或输入不一致均不删除。','');
    if(phrase!=='永久清除全部业务数据'){
      note('v626ClearStatus','二次确认口令不一致或已取消，未执行清空。');
      return;
    }
    note('v626ClearStatus','管理员二次确认完成，正在提交清空任务…');
    const r=await post('/api/admin/data-purge/direct',{phrase},30000);
    const result=await pollDirectPurge(r.jobId);
    note('v626ClearStatus','业务数据已全部清空；已有备份已保留。共删除 '+fmt(result.deletedRows||0)+' 行。','success');
    v765InvalidateAllProofCache();
    v765BoardDetailCache.clear();
    v626LatestImport=null;v626OpenRows=[];renderOpenPodRows();await loadBackups();
  }catch(e){note('v626ClearStatus','清空未执行或失败：'+String(e?.message||e),'error')}
  finally{
    v788MainClearSubmitting=false;
    if(clearButton)clearButton.disabled=false;
  }
}
async function loadUsers(){
  try{
    const r=await json('/api/admin/users',7000),rows=r.rows||[];
    const tbody=byId('v625UserRows');tbody.replaceChildren();
    if(!rows.length){tbody.innerHTML='<tr><td colspan="5">暂无用户</td></tr>';return}
    for(const x of rows.slice(0,100))tbody.appendChild(rowTr([x.username,x.role,x.businessScope||'ALL',x.enabled?'启用':'停用','查看']));
  }catch{
    const tbody=byId('v625UserRows');if(tbody)tbody.innerHTML='<tr><td colspan="5">需要管理员权限</td></tr>';
  }
}

function bind(){
  byId('v625Reload')?.addEventListener('click',()=>location.reload());
  byId('v625Query')?.addEventListener('click',()=>{
    const from=byId('v625FromDate')?.value||'',to=byId('v625ToDate')?.value||from;
    const p=currentParams();p.set('auth','v625');
    if(from)p.set('fromDate',from);if(to)p.set('toDate',to);
    const reportDate=to||from;if(reportDate)p.set('reportDate',reportDate);
    p.delete('snapshotId');
    location.search=p.toString();
  });
  qa('[data-timing-missing]').forEach(btn=>btn.addEventListener('click',()=>renderTimingMissing(btn.dataset.timingMissing)));
  byId('v788KpiDetailPrevious')?.addEventListener('click',()=>renderKpiDetail(v788KpiKind,v788KpiPage-1,false));
  byId('v788KpiDetailNext')?.addEventListener('click',()=>renderKpiDetail(v788KpiKind,v788KpiPage+1,false));
  qa('[data-kpi-detail]').forEach(card=>{
    const open=()=>renderKpiDetail(card.dataset.kpiDetail||'total');
    card.addEventListener('click',open);
    card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')open()});
  });
  byId('v625ImportFile')?.addEventListener('change',()=>{const file=byId('v625ImportFile').files?.[0];setText('v625ImportFileName',file?.name||'选择文件');if(file)appendLiveLog('已选择日报文件 '+file.name)});
  byId('v626ManualDateToggle')?.addEventListener('click',()=>{const wrap=byId('v626ManualDateWrap');if(wrap)wrap.hidden=!wrap.hidden});
  byId('v625ImportButton')?.addEventListener('click',doImport);
  byId('v625RunStart')?.addEventListener('click',()=>runTask('start'));
  byId('v625RunResume')?.addEventListener('click',()=>runTask('resume'));
  byId('v758WhppReadOnlyDiagnostic')?.addEventListener('click',runV758WhppReadOnlyDiagnostic);
  byId('v761FamilyRecoveryDiagnostic')?.addEventListener('click',v761DiagnoseFamilyRecovery);
  byId('v758ReloadUsers')?.addEventListener('click',()=>void loadSettingsUsers());
  byId('v734TimingRepairNow')?.addEventListener('click',runTimingRepairNow);
  byId('v626RefreshOpenPod')?.addEventListener('click',refreshOpenPodNow);
  byId('v803RetryOpenSource')?.addEventListener('click',()=>void loadOpenPod());
  byId('v641WhppScanPending')?.addEventListener('click',scanWhppPending);
  byId('v626ImportRefreshOpen')?.addEventListener('click',refreshOpenPodNow);
  qa('[data-open-filter]').forEach(btn=>btn.addEventListener('click',()=>{v626OpenFilter=btn.dataset.openFilter;qa('[data-open-filter]').forEach(x=>x.classList.toggle('active',x===btn));renderOpenPodRows()}));
  byId('v625TrackSearch')?.addEventListener('click',queryTrack);byId('v625TrackReset')?.addEventListener('click',()=>{byId('v625TrackCode').value='';byId('v625TrackTimeline').innerHTML='<div class="v625-empty-state">暂无轨迹数据</div>'});
  byId('v625ExceptionSearch')?.addEventListener('click',loadExceptions);
  byId('v776OpenAnyWaybill')?.addEventListener('click',qcOpenAnyWaybill);
  if(byId('v625ExceptionDate')&&selectedReportDate())byId('v625ExceptionDate').value=selectedReportDate();
  for(const id of ['v625ExceptionType','v625ExceptionBusiness','v768ExceptionKeyword']){
    const element=byId(id);
    element?.addEventListener(id==='v768ExceptionKeyword'?'input':'change',()=>{
      qcActionPage=0;
      if(id==='v625ExceptionBusiness'&&qcActionScope?.truncated){void loadExceptions();return}
      renderExceptionRows();
    });
  }
  byId('v768CheckAll')?.addEventListener('change',event=>{
    qa('#v625ExceptionRows input[data-qc-case]').forEach(item=>item.checked=event.target.checked);
    qcActionUpdateSelection();
  });
  byId('v768PreviousPage')?.addEventListener('click',()=>{qcActionPage=Math.max(0,qcActionPage-1);renderExceptionRows()});
  byId('v768NextPage')?.addEventListener('click',()=>{qcActionPage++;renderExceptionRows()});
  byId('v768CopySelected')?.addEventListener('click',async()=>{
    const list=qcActionFilter().slice(qcActionPage*QC_ACTION_PAGE_SIZE,(qcActionPage+1)*QC_ACTION_PAGE_SIZE);
    const checked=new Set(qa('#v625ExceptionRows input[data-qc-case]:checked').map(i=>i.dataset.qcCase));
    const rows=list.filter(row=>checked.has(row.businessType+'|'+row.shipmentCode));
    const ok=await qcCopyText(rows.map(qcActionLine).join('\n'));
    setText('v768ExceptionEvidence',ok?'已复制 '+rows.length+' 票待处理清单（不代表处理完成）':'复制失败，请检查剪贴板权限');
  });
  byId('v768CopyCurrent')?.addEventListener('click',async()=>{
    const rows=qcActionFilter().slice(qcActionPage*QC_ACTION_PAGE_SIZE,(qcActionPage+1)*QC_ACTION_PAGE_SIZE);
    const ok=await qcCopyText(rows.map(qcActionLine).join('\n'));
    setText('v768ExceptionEvidence',ok?'已复制当前页 '+rows.length+' 票待处理清单（不代表已下发或已闭环）':'复制失败，请检查剪贴板权限');
  });
  qa('.v625-tabs button[data-period]').forEach(b=>b.addEventListener('click',()=>{qa('.v625-tabs button[data-period]').forEach(x=>x.classList.toggle('active',x===b));reportPeriod=b.dataset.period}));
  byId('v625GenerateReport')?.addEventListener('click',generateReport);
  qa('#v625SettingsTabs [data-settings-tab]').forEach(btn=>btn.addEventListener('click',()=>switchSettingsTab(btn.dataset.settingsTab)));
  byId('v625AddUser')?.addEventListener('click',()=>openUserEditor());byId('v625CancelUserEdit')?.addEventListener('click',closeUserEditor);byId('v625SaveUser')?.addEventListener('click',saveSettingsUser);
  byId('v625CeLogin')?.addEventListener('click',ceLogin);byId('v625CeLogout')?.addEventListener('click',ceLogout);
  byId('v788WhppEvidenceStart')?.addEventListener('click',startV788WhppEvidenceV625);
  byId('v788WhppEvidenceRefresh')?.addEventListener('click',loadV788WhppEvidenceV625);
  byId('v788ReadOnlyAuditStart')?.addEventListener('click',startV788ReadOnlyAuditV625);
  byId('v788ReadOnlyAuditRefresh')?.addEventListener('click',loadV788ReadOnlyAuditV625);
  byId('v788FormalReadinessRefresh')?.addEventListener('click',loadV788FormalReadinessV625);
  byId('v625ShopFile')?.addEventListener('change',()=>setText('v625ShopFileName',byId('v625ShopFile').files?.[0]?.name||'请选择CP码文件'));byId('v625ShopImport')?.addEventListener('click',importShop);
  byId('v780ActivateSavedShops')?.addEventListener('click',activateSavedShopCodes);
  byId('v625SettingsBackupNow')?.addEventListener('click',settingsBackupNow);
  byId('v625LogSearch')?.addEventListener('click',loadLogs);
  byId('v625BackupNow')?.addEventListener('click',backupNow);byId('v626BackupNowTop')?.addEventListener('click',backupNow);
  byId('v626ClearAllData')?.addEventListener('click',clearAllBusinessData);
  qa('#v626DataTabs [data-data-tab]').forEach(btn=>btn.addEventListener('click',()=>switchDataTab(btn.dataset.dataTab)));
}

// V800: integrate the existing V792 reference layout without replacing the
// V788 business truth, administrative audit, pagination or purge safeguards.
function v800ApplyReferenceLayout(){
  // Shared CE visual refresh applies to every route; specialized layout only on home/WHPP.
  document.body.classList.add('v792-reference');
  if(page==='home'){
    const home=byId('v625Home');
    const overview=home?.querySelector('.v625-home-business-panel');
    const live=home?.querySelector('.v626-live-grid');
    const three=home?.querySelector('.v625-home-three');
    const process=home?.querySelector('.v626-processing-panel');
    const open=home?.querySelector('.v626-open-pod-panel');
    const status=home?.querySelector('.v625-home-status-panel');
    const quick=home?.querySelector('.v625-home-quick-panel');
    const logs=home?.querySelector('.v626-log-panel');
    const timing=home?.querySelector('.v625-signing-panel');
    const trend=home?.querySelector('.v625-home-trend-panel');
    const management=byId('v792HomeManagement');
    if(!home||!overview||!live||!three||!process||!open||!status
      ||!quick||!logs||!timing||!trend||!management)return;
    document.body.classList.add('v792-reference');
    const total=overview.querySelector('.v632-total-card');
    const heading=overview.querySelector('.v625-section-head');
    if(total&&heading){total.classList.add('v792-total-summary');heading.after(total)}
    const top=document.createElement('div');top.className='v792-home-main-row';
    overview.after(top);top.append(process,status,quick,logs);
    // V801: signing is full width; unfinished POD gets its OWN full-width
    // panel. Preserve the original real-data DOM, controls, and event wiring.
    const bottom=document.createElement('div');bottom.className='v792-home-bottom-row';
    timing.before(bottom);bottom.append(timing);bottom.after(open);
    const optional=document.createElement('details');
    optional.className='v792-optional-trend v625-panel';
    const caption=document.createElement('summary');caption.textContent='近7天总票数趋势（已保存来源）';
    optional.append(caption,trend);
    open.after(management);management.after(optional);
    const integrity=byId('v637HomeIntegrityBar');if(integrity)management.append(integrity);
    // Move all operational panels first; empty old wrappers can then go away.
    if(!live.children.length)live.remove();
    if(!three.children.length)three.remove();
    if(byId('v625BoardJump'))byId('v625BoardJump').value='/?auth=v625';
  }else if(business==='WHPP'){
    document.body.classList.add('v792-reference');
    const board=byId('v625Business'),analysis=byId('v792WhppAnalysis'),tables=byId('v792WhppTables');
    if(!board||!analysis||!tables)return;
    analysis.hidden=false;tables.hidden=false;
    const icons=['icon-package','icon-route','icon-check','icon-clipboard','icon-alert','icon-clock','icon-archive','icon-refresh'];
    [...board.querySelectorAll('.v625-kpi-row>article')].slice(0,8).forEach((tile,i)=>{
      if(tile.querySelector('.v792-kpi-symbol'))return;
      const symbol=document.createElement('i');symbol.className='v792-kpi-symbol';
      symbol.setAttribute('aria-hidden','true');
      symbol.innerHTML='<svg><use href="/assets/ui-icons-v625.svg#'+icons[i]+'"/></svg>';
      tile.prepend(symbol);
    });
    const original=[...board.querySelectorAll('section.v625-panel')].find(node=>
      node.querySelector('.v625-section-head h2')?.textContent?.trim()==='最新异常明细');
    if(original)original.classList.add('v792-whpp-original-exceptions');
    // Preserve all completeness and trajectory controls in an expandable area.
    const quality=board.querySelector('.v748-quality-signals');
    const accounting=board.querySelector('.v631-accounting-bar');
    const integrity=board.querySelector('.v637-integrity-bar');
    if(quality||accounting||integrity){
      const technical=document.createElement('details');
      technical.className='v792-whpp-technical v625-panel';
      const heading=document.createElement('summary');heading.textContent='来源完整性及轨迹质量核查';
      technical.append(heading);
      for(const node of [quality,accounting,integrity])if(node)technical.append(node);
      tables.after(technical);
    }
    const range=byId('v625BusinessTrendRange');if(range)range.innerHTML='<option value="7">近7天</option>';
    const title=byId('v625BusinessTrend')?.closest('.v625-panel')?.querySelector('.v625-section-head h2');
    if(title)title.textContent='业务趋势（近7天）';
    if(byId('v625BoardJump'))byId('v625BoardJump').value='/whpp?auth=v625';
  }
}
function v800RenderWhppTrend(points=[]){
  if(business!=='WHPP')return;
  const root=byId('v625BusinessTrend');if(!root)return;
  const rows=(points||[]).slice(-7);
  const max=Math.max(1,...rows.map(p=>Number(p.total||0)),...rows.map(p=>Number(p.pod||0)),...rows.map(p=>Number(p.returned||0)));
  if(!rows.some(p=>p.total!==null)){
    root.innerHTML='<div class="v792-data-unknown">近7日没有可核验的WHPP原始日报，不绘制示例曲线。</div>';return;
  }
  const width=700,height=186,x0=38,right=16,top=18,bottom=34;
  const x=i=>x0+i*(width-x0-right)/Math.max(1,rows.length-1);
  const y=n=>height-bottom-(Number(n)/max)*(height-top-bottom);
  const buildSegments=key=>{
    const paths=[];let current=[];
    rows.forEach((point,i)=>{
      if(point[key]===null||point[key]===undefined){
        if(current.length)paths.push(current);
        current=[];return;
      }
      current.push([x(i),y(point[key]),point[key]]);
    });
    if(current.length)paths.push(current);
    return paths.map(points=>'<path d="'+points.map((p,i)=>(i?'L':'M')+
      p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')+'" class="v792-'+key+'-line"/>').join('');
  };
  let svg='<svg class="v792-whpp-chart-svg" viewBox="0 0 '+width+' '+height+
    '" preserveAspectRatio="none" role="img" aria-label="WHPP已保存日报近7日总票数与经来源核验的POD数量">';
  for(let i=0;i<=4;i++){
    const value=max*i/4, yy=y(value);
    svg+='<line class="v792-grid-line" x1="'+x0+'" y1="'+yy+
      '" x2="'+(width-right)+'" y2="'+yy+'"/><text x="1" y="'+(yy+4)+'">'+
      fmt(Math.round(value))+'</text>';
  }
  svg+=buildSegments('total')+buildSegments('pod')+buildSegments('returned');
  rows.forEach((point,i)=>{
    const xx=x(i);svg+='<text x="'+xx+'" y="'+(height-9)+
      '" text-anchor="middle">'+esc(String(point.date||'').slice(5))+'</text>';
    for(const key of ['total','pod','returned']){
      if(point[key]===null||point[key]===undefined)continue;
      svg+='<circle cx="'+xx+'" cy="'+y(point[key])+'" r="3.4" fill="'+
        (key==='total'?'#147ef5':key==='pod'?'#11b782':'#ef5261')+'"><title>'+
        esc(point.date+' · '+(key==='total'?'源票':key==='pod'?'已核验POD':'已核验退回')+' '+fmt(point[key]))+
        '</title></circle>';
    }
  });
  root.innerHTML='<div class="v792-whpp-chart-legend"><span><i style="background:#147ef5"></i>日报源票</span>'+
    '<span><i style="background:#11b782"></i>已核验POD</span>'+ 
    '<span><i style="background:#ef5261"></i>已核验退回</span></div>'+
    '<p class="v792-whpp-chart-note">缺少终态证据的日期显示空缺；部分核实的数量不代表全部终态已完成。</p>'+svg+'</svg>';
}
async function v800LoadWhppTrend(date=''){
  if(business!=='WHPP'||!date)return;
  const root=byId('v625BusinessTrend');if(root)root.textContent='正在核对近7日WHPP来源票数和最终记录…';
  try{
    const response=await json('/api/v800/whpp/trend?toDate='+encodeURIComponent(date),12000);
    if(!business||business!=='WHPP'||v628BusinessReportDate!==date)return;
    if(!response?.ok||response.toDate!==date||response.businessType!=='WHPP')
      throw new Error('趋势来源与当前业务日期不一致');
    v800RenderWhppTrend(response.points||[]);
  }catch(error){
    if(Boolean(business)&&business==='WHPP'&&v628BusinessReportDate===date&&root)
      root.innerHTML='<div class="v792-data-unknown">近7日趋势尚未取得可信来源：'+esc(error.message)+'</div>';
  }
}

/* V801: only evidence-backed sample averages, never a single guessed number.
   The four business groups are disjoint; their average POD times may be
   aggregated by actual trusted sample counts, not by taking a mean of means. */
let v803SelectedTimingProof=null;
function v803MergeFullWithExactTiming(full={},reportDate='',snapshotId=''){
  const proof=v803SelectedTimingProof;
  if(!proof||proof.reportDate!==String(reportDate)||proof.snapshotId!==String(snapshotId))return full;
  const merged={...full};
  for(const type of ['TBKH','WHPP','SHOPEECN','SHOPEEVN']){
    const base=full[type]||{},verified=proof.timing?.[type]||{};
    const result={...base},keys=['overall','pp','pv','attempt1','attempt2','attempt3'];
    for(const key of keys){
      const old=base[key],incoming=verified[key];
      const oldSamples=Number(old?.podCount||0),newSamples=Number(incoming?.podCount||0);
      if(newSamples>0&&Number.isFinite(Number(incoming?.avgDays))&&Number(incoming?.avgDays)>0
        &&(newSamples>oldSamples||(newSamples===oldSamples&&(old?.avgDays==null||Number(old.avgDays)<=0||!Number.isFinite(Number(old.avgDays))))))
        result[key]={...old,...incoming};
    }
    if(Number(result.overall?.podCount||0)>Number(base.overall?.podCount||0)){
      result.evidence=verified.evidence||base.evidence;
      result.degraded=false;
    }
    merged[type]=result;
  }
  return merged;
}
function v801TimingAggregate(timing={},field='overall'){
  let weighted=0,count=0,totalPod=0,knownTotals=0;
  for(const type of ['TBKH','WHPP','SHOPEECN','SHOPEEVN']){
    const bucket=timing?.[type]?.[field];
    const sample=Number(bucket?.podCount||0),days=Number(bucket?.avgDays);
    const rawTotal=bucket?.totalPodCount;
    const total=rawTotal===null||rawTotal===undefined?NaN:Number(rawTotal);
    if(Number.isFinite(total)&&total>=0){totalPod+=total;knownTotals++}
    if(sample>0&&Number.isFinite(days)&&days>0){weighted+=days*sample;count+=sample}
  }
  return{count,avgDays:count>0?weighted/count:null,totalPod:knownTotals?totalPod:null};
}
function v801SetTimingWaiting(date=''){
  v801VerifiedReturnsProof=null;
  v803SelectedTimingProof=null;
  for(const key of ['Overall','PP','PV','Attempt1','Attempt2','Attempt3']){
    setText('v801Timing'+key,'—');
    setText('v801Timing'+key+'Sample','等待可信样本');
  }
  setText('v801TimingReturned','—');
  setText('v801TimingReturnRate','—');
  setText('v801TimingReturnScope','等待三业务退回来源核验');
  setText('v801TimingStatus',date?'统计 '+date+' · 正在读取签收时效证据':'等待选择有效日报日期');
}
function v801RenderTimingSummary(timing={},date=''){
  if(page!=='home')return;
  const fields={Overall:'overall',PP:'pp',PV:'pv',Attempt1:'attempt1',Attempt2:'attempt2',Attempt3:'attempt3'};
  for(const [key,field] of Object.entries(fields)){
    const aggregate=v801TimingAggregate(timing,field);
    const ok=aggregate.count>0&&aggregate.avgDays!=null;
    setText('v801Timing'+key,ok?aggregate.avgDays.toFixed(2).replace(/\.00$/,'')+'天':'—');
    const completeness=field==='overall'&&aggregate.totalPod!=null
      ?' / POD '+fmt(aggregate.totalPod)+'票':'';
    setText('v801Timing'+key+'Sample',ok
      ?'可信 '+fmt(aggregate.count)+'票'+completeness
      :'暂无可核验的该项签收时间');
  }
  const all=v801TimingAggregate(timing,'overall');
  if(all.count>0){
    const missing=all.totalPod==null?'':'; POD样本覆盖 '+fmt(all.count)+'/'+fmt(all.totalPod);
    setText('v801TimingStatus','日报 '+date+' · 已读取可信时效 '+fmt(all.count)+'票'+missing);
  }else{
    setText('v801TimingStatus',date
      ?'日报 '+date+' · 目前没有可信签收时间，不能把缺失显示为0天'
      :'该日期签收时效尚未核验');
  }
}
function v801RenderVerifiedReturns(payload){
  if(page!=='home'||!payload?.selectionMatched||payload.ok!==true)return;
  const types=['WHPP','SHOPEECN','SHOPEEVN'],results=types.map(type=>payload.returns?.[type]);
  const allVerified=results.every(result=>result?.verified===true
    &&Number.isFinite(Number(result.count))&&Number.isFinite(Number(result.total))
    &&Number(result.count)>=0&&Number(result.total)>=Number(result.count));
  if(!allVerified){
    setText('v801TimingReturned','—');
    setText('v801TimingReturnRate','—');
    setText('v801TimingReturnScope','三业务退回来源尚未全部核验');
    return;
  }
  const returned=results.reduce((a,r)=>a+Number(r.count),0);
  const total=results.reduce((a,r)=>a+Number(r.total),0);
  setText('v801TimingReturned',fmt(returned)+'票');
  setText('v801TimingReturnRate',total>0?pct(returned/total*100):'—');
  setText('v801TimingReturnScope','三业务 '+fmt(returned)+'/'+fmt(total)+'票 · 逐票来源已核验');
}
// V802: render exact-day saved POD time separately from the expensive
// historical 30-day HOME_FULL worker. Never invent missing timestamps.
function v802RenderSelectedTiming(payload){
  if(page!=='home'||payload?.ok!==true||payload?.selectionMatched!==true)return false;
  const timing=payload.timing||{},day=String(payload.reportDate||'');
  v803SelectedTimingProof={reportDate:day,snapshotId:String(payload.snapshotId||''),timing};
  v801RenderTimingSummary(timing,day);
  const asDays=bucket=>{
    const sample=Number(bucket?.podCount||0),days=Number(bucket?.avgDays);
    return sample>0&&Number.isFinite(days)&&days>0
      ?days.toFixed(2).replace(/\.00$/,'')+'天':'—';
  };
  for(const type of ['TBKH','WHPP','SHOPEECN','SHOPEEVN']){
    const d=timing[type]||{},prefix='v625Timing'+type;
    const count=Number(d.overall?.podCount||0),total=Number(d.overall?.totalPodCount||0);
    setText(prefix+'Overall',asDays(d.overall));
    setText(prefix+'Pod',count>0
      ?'可信时间 '+fmt(count)+' / POD '+fmt(total)+'票'
      :total>0?'POD '+fmt(total)+'票，签收时间尚未核验':'无可信签收时间');
    for(const region of ['PP','PV']){
      const bucket=d[region.toLowerCase()]||{};
      setText(prefix+region,asDays(bucket));
      setText(prefix+region+'Pod',fmt(bucket.podCount||0)+' / '+fmt(bucket.totalPodCount||0)+'票');
    }
    const missing=Number(d.evidence?.missing||d.overall?.missingEvidenceCount||0);
    setText('v626Timing'+type+'Missing',d.degraded?'待核验':fmt(missing));
    setText('v626Timing'+type+'Valid',d.degraded?'待核验':fmt(d.evidence?.valid??count));
  }
  const broken=Array.isArray(payload.degraded)?payload.degraded:[];
  const counts=['TBKH','WHPP','SHOPEECN','SHOPEEVN'].map(type=>
    Number(timing[type]?.overall?.podCount||0));
  if(broken.length){
    setText('v801TimingStatus','日报 '+day+' · '+broken.join(' / ')+'来源计算异常，须核实原始日报与POD时间');
  }else if(counts.every(count=>count===0)){
    const pods=['TBKH','WHPP','SHOPEECN','SHOPEEVN']
      .reduce((n,type)=>n+Number(timing[type]?.overall?.totalPodCount||0),0);
    setText('v801TimingStatus','日报 '+day+' · 已读取来源，可信签收样本0票；'
      +(pods>0?'POD '+fmt(pods)+'票缺少实际时间':'当前尚无可核验POD成员')
      +'，不能视为0天');
  }
  setText('v625TimingPeriod','统计日报 '+day+' · 已读取指定日期保存的签收时间（未调用TMS）');
  return true;
}
function v800SetWhppMetrics(m={},timing=null){
  if(business!=='WHPP')return;
  const days=bucket=>{
    if(!bucket||Number(bucket.podCount||0)<=0||!Number.isFinite(Number(bucket.avgDays)))return null;
    return Number(bucket.avgDays);
  };
  const show=value=>value==null?'—':value.toFixed(2).replace(/\.00$/,'')+'天';
  const compact=Number(m.pod||0)>0&&Number(m.avgDays)>0&&Number.isFinite(Number(m.avgDays))?Number(m.avgDays):null;
  const overall=timing?days(timing.overall):compact;
  setText('v792WhppOverall',show(overall));
  for(const [id,key] of [['v792WhppPP','pp'],['v792WhppPV','pv'],['v792WhppFirst','attempt1'],['v792WhppSecond','attempt2'],['v792WhppThird','attempt3']])
    setText(id,show(days(timing?.[key])));
  setText('v792WhppReturnCount',Number.isFinite(Number(m.returned))?fmt(m.returned):'—');
  setText('v792WhppReturnRate',Number(m.total)>0?pct(Number(m.returned||0)*100/Number(m.total)):'—');
  setText('v792WhppTimingSource',overall==null
    ?'没有可核验的实际POD日期，暂不推算平均签收天数；PP/PV与派次仅以真实证据展示。'
    :'签收时效来自真实可核验日期；缺少PP/PV或派次证据时对应指标显示“—”。');
}
function v800RenderWhppDetails(rows=[],truncated=false){
  if(business!=='WHPP')return;
  const isReturned=row=>row.isReturned===true
    ||String(row.currentState||'').toUpperCase()==='RETURN_COMPLETED';
  const fill=(id,items,values)=>{
    const root=byId(id);if(!root)return;
    root.replaceChildren();
    if(!items.length){
      const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;
      td.textContent=truncated?'当前为部分运单预览，请通过指标卡查看完整明细':'已读取范围暂无该类运单';
      tr.append(td);root.append(tr);return;
    }
    for(const row of items.slice(0,8)){
      const tr=document.createElement('tr');
      for(const value of values(row)){const td=document.createElement('td');td.textContent=String(value??'—');tr.append(td)}
      const td=document.createElement('td'),code=String(row.shipmentCode||'').trim();
      if(code&&/^\d{4}-\d{2}-\d{2}$/.test(v628BusinessReportDate||'')){
        const a=document.createElement('a');a.textContent='查看该票';
        a.href='/tracking?auth=v625&code='+encodeURIComponent(code)
          +'&businessType=WHPP&reportDate='+encodeURIComponent(v628BusinessReportDate);
        td.append(a);
      }else td.textContent='缺少单号/日期';
      tr.append(td);root.append(tr);
    }
  };
  fill('v792WhppAnomalyRows',rows.filter(row=>row.isActionable===true),row=>
    [row.shipmentCode,row.category||row.queryStatus||'待核验',row.currentState||'—']);
  const returns=rows.filter(isReturned);
  fill('v792WhppReturnedRows',returns,row=>
    [row.shipmentCode,row.currentState||'已退回',row.latestTime||row.lastEventTime||'—']);
  const reasons=returns.map(row=>String(row.returnReason||row.退回原因||'').trim()).filter(Boolean);
  const root=byId('v792WhppReturnReasons');if(!root)return;
  root.replaceChildren();
  if(!reasons.length){
    root.textContent='已读取运单中尚无可信退回原因；不生成虚假TOP5比例。';
    return;
  }
  const counted=new Map();for(const reason of reasons)counted.set(reason,(counted.get(reason)||0)+1);
  const label=document.createElement('p');
  label.textContent='有真实原因记录 '+fmt(reasons.length)+' 票'+(truncated?'（当前为部分预览）':'');
  root.append(label);
  for(const [reason,count] of [...counted].sort((a,b)=>b[1]-a[1]).slice(0,5)){
    const line=document.createElement('p');
    line.textContent=reason+'：'+fmt(count)+'票（有效原因中 '+pct(count/reasons.length*100)+'）';
    root.append(line);
  }
}
async function init(){
  v800ApplyReferenceLayout();
  bind();void loadSession();
  if(page==='home'){
    await loadHome();
    void latestImportContext();
  }
  else if(business){
    await loadBusiness();
    void latestImportContext();
  }
  else if(page==='import'){await loadImport()}
  else if(page==='exceptions')await loadExceptions();
  else if(page==='reports'){byId('v625ReportDate').value=today();renderReports()}
  else if(page==='tracking'){
    byId('v625TrackDate').value=currentParams().get('reportDate')||today();
    const params=currentParams(),requestedBusiness=params.get('businessType')||'';
    if(requestedBusiness&&byId('v625TrackBusiness'))byId('v625TrackBusiness').value=requestedBusiness;
    const code=params.get('code');if(code){byId('v625TrackCode').value=code;void queryTrack()}
  }
  else if(page==='settings'){await loadSettings();switchSettingsTab('basic');}
  else if(page==='logs')await loadLogs();
  else if(page==='data-management'){
    const requestedTab=currentParams().get('tab');
    switchDataTab(['clear','backup','storage'].includes(requestedTab)?requestedTab:'clear');
    await loadBackups();
  }
  else if(page==='users')await loadUsers();
  else if(page==='profile')await loadSession();
}
void init();
})();