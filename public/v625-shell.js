(()=>{
'use strict';

const page=document.body.dataset.page||'home';
const business=document.body.dataset.business||'';
const q=s=>document.querySelector(s);
const qa=s=>[...document.querySelectorAll(s)];
const byId=id=>document.getElementById(id);
const num=v=>Number.isFinite(Number(v))?Number(v):null;
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
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const res=await fetch(url,{cache:'no-store',credentials:'same-origin',...options,signal:controller.signal});
    const type=String(res.headers.get('content-type')||'');
    const data=type.includes('application/json')?await res.json():{ok:res.ok,text:await res.text()};
    if(!res.ok||data?.ok===false){
      const e=new Error(data?.error||('HTTP '+res.status));e.payload=data;e.status=res.status;throw e;
    }
    return data;
  }finally{clearTimeout(timer);}
}
const json=(url,timeout=12000)=>request(url,{},timeout);
const post=(url,body={},timeout=120000)=>request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},timeout);
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
const boardJump=byId('v625BoardJump');if(boardJump)boardJump.addEventListener('change',()=>location.href=boardJump.value);
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
  const cancelled=num(first(state,['dashboard.metrics.cancelled','cancelled']))??0;
  const explicitDelivery=num(first(state,['dashboard.metrics.delivery','dashboard.metrics.deliveryStay','dashboard.categories.deliveryTotal']));
  const delivery=explicitDelivery??Math.max(0,total-pod-returned-cancelled);
  const normalDiversion=num(first(state,['dashboard.metrics.normalDiversion']))??0;
  const shopTotal=num(first(state,['dashboard.metrics.shopTotal']))??0;
  const otherNormal=Math.max(0,cancelled+normalDiversion+shopTotal);
  const avgDays=num(first(state,['dashboard.metrics.avgPodDays','avgPodDays','dashboard.avgPodDays']));
  return{total,pod,podRate:total?pod/total*100:0,pending,oc,unresolved,returned,cancelled,delivery,normalDiversion,shopTotal,otherNormal,avgDays};
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
  const total=Math.max(1,m.total);
  const parts=[
    ['派送中',m.delivery,'#1677f2'],['已签收',m.pod,'#20b979'],['Pending',m.pending,'#f5a623'],['异常',m.unresolved,'#ef4b50']
  ];
  let at=0;const stops=[];
  for(const[,value,color]of parts){const next=at+(value/total*100);stops.push(color+' '+at+'% '+next+'%');at=next}
  const donut=byId('v625BusinessDonut');if(donut)donut.style.background='conic-gradient('+stops.join(',')+')';
  const legend=byId('v625BusinessLegend');if(legend)legend.innerHTML=parts.map(([name,value,color])=>'<div><i style="background:'+color+'"></i><span>'+esc(name)+' '+fmt(value)+'（'+pct(value/total*100)+'）</span></div>').join('');
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
let v631TimingMissing={};
let v626OpenRows=[];
let v626OpenFilter='all';
let v626ProgressTimer=null;
let v626TrackingJobId='';
const v626LogKeys=new Set();

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
    v626LatestImport=r.import||null;
    return v626LatestImport;
  }catch{return v626LatestImport}
}
function progressPercent(done,total){return total>0?Math.max(0,Math.min(100,Math.round(done*100/total))):0}
function familyProgressLabel(value={}){
  const scanTotal=Number(value.scanTotal||0),scanDone=Number(value.scanDone||0),trackTotal=Number(value.trackTotal||0),trackDone=Number(value.trackDone||0);
  if(value.complete||/COMPLETED|完成/i.test(String(value.runStatus||value.outcome||value.phase||'')))return '完成';
  if(value.running||value.active){
    if(/轨迹|track/i.test(String(value.phase||'')))return '轨迹 '+trackDone+'/'+trackTotal;
    return '扫描 '+scanDone+'/'+scanTotal;
  }
  if(scanTotal||trackTotal)return '扫描 '+scanDone+'/'+scanTotal+' · 轨迹 '+trackDone+'/'+trackTotal;
  return String(value.phase||'待处理');
}
async function fetchLiveProgress(reportDate=''){
  const date=reportDate||v626LatestImport?.reportDate||'';
  const [ccslR,shopeeR,whppR]=await Promise.allSettled([
    json('/api/v33/run-progress?businessType=CCSL'+(date?'&reportDate='+encodeURIComponent(date):''),7000),
    json('/api/v33/run-progress?businessType=SHOPEE',7000),
    json('/api/whpp/progress'+(date?'?reportDate='+encodeURIComponent(date):''),7000)
  ]);
  const ccsl=ccslR.status==='fulfilled'?ccslR.value:{};
  const shopee=shopeeR.status==='fulfilled'?shopeeR.value:{};
  const whppPayload=whppR.status==='fulfilled'?whppR.value:{};
  const whpp={...(whppPayload.runtime||{}),summary:whppPayload.summary||{},log:whppPayload.log||[],active:Boolean(whppPayload.runtime?.active)};
  return{ccsl,shopee,whpp,reportDate:date};
}
function renderLiveProgress(bundle={}){
  const {ccsl={},shopee={},whpp={}}=bundle;
  setText('v626CcslProgress',familyProgressLabel(ccsl));setText('v626ShopeeProgress',familyProgressLabel(shopee));setText('v626WhppProgress',familyProgressLabel(whpp));
  setText('v626ImportCcsl',familyProgressLabel(ccsl));setText('v626ImportShopee',familyProgressLabel(shopee));setText('v626ImportWhpp',familyProgressLabel(whpp));

  const scanDone=Number(ccsl.scanDone||0)+Number(shopee.scanDone||0);
  const scanTotal=Number(ccsl.scanTotal||0)+Number(shopee.scanTotal||0);
  const trackDone=Number(ccsl.trackDone||0)+Number(shopee.trackDone||0);
  const trackTotal=Number(ccsl.trackTotal||0)+Number(shopee.trackTotal||0);
  const whppBatch=Number(whpp.batchIndex||0),whppBatches=Number(whpp.totalBatches||0);
  const allRunning=Boolean(ccsl.running||shopee.running||whpp.active);
  const completeFamilies=[ccsl,shopee].filter(x=>/COMPLETED|completed/i.test(String(x.runStatus||''))).length+( /COMPLETED|完成/i.test(String(whpp.outcome||whpp.phase||''))?1:0);
  const scanPct=progressPercent(scanDone,scanTotal),trackPct=progressPercent(trackDone,trackTotal);
  const whppPct=progressPercent(whppBatch,whppBatches);
  const overall=Math.round((scanPct+trackPct+(whppBatches?whppPct:(completeFamilies>=3?100:0)))/3);
  for(const id of ['v626ProcessBar','v626ImportBar']){const el=byId(id);if(el)el.style.width=Math.max(0,Math.min(100,overall))+'%'}
  const phase=whpp.active?String(whpp.phase||'WHPP处理中'):shopee.running?String(shopee.phase||'SHOPEE处理中'):ccsl.running?String(ccsl.phase||'CCSL处理中'):completeFamilies>=3?'全部处理完成':'等待/可继续处理';
  setText('v626ProcessText',phase);setText('v626ImportProgressText',phase);
  setText('v626ProcessCount',(scanDone+trackDone)+' / '+(scanTotal+trackTotal));setText('v626ImportProgressCount',(scanDone+trackDone)+' / '+(scanTotal+trackTotal));
  setText('v626StageScan',scanTotal?scanDone+'/'+scanTotal:'等待');setText('v626StageTrack',trackTotal?trackDone+'/'+trackTotal:'等待');setText('v626StageDone',completeFamilies>=3?'完成':allRunning?'处理中':'等待');
  setText('v626ImportScan',scanTotal?scanDone+'/'+scanTotal:'等待');setText('v626ImportTrack',trackTotal?trackDone+'/'+trackTotal:'等待');setText('v626ImportDone',completeFamilies>=3?'完成':allRunning?'处理中':'等待');
  const badge=byId('v626ProcessState');if(badge){badge.textContent=completeFamilies>=3?'已完成':allRunning?'处理中':'待处理';badge.className='v625-badge '+(completeFamilies>=3?'success':allRunning?'warning':'warning')}
  for(const item of [
    [ccsl.generatedAt||new Date().toISOString(),ccsl.phase||ccsl.lastMessage],
    [shopee.generatedAt||new Date().toISOString(),shopee.phase||shopee.lastMessage],
    [whpp.heartbeatAt||whpp.finishedAt||new Date().toISOString(),whpp.lastMessage||whpp.phase]
  ])if(item[1])appendLiveLog(item[1],item[0]);
  for(const log of whpp.log||[])appendLiveLog(log.message||'',log.at||new Date().toISOString());
}
async function refreshLiveProgress(){
  const bundle=await fetchLiveProgress(v626LatestImport?.reportDate||'');
  renderLiveProgress(bundle);return bundle;
}
function startProgressPolling(){
  stopProgressPolling();void refreshLiveProgress();
  v626ProgressTimer=setInterval(()=>{void refreshLiveProgress()},1400);
}
function stopProgressPolling(){if(v626ProgressTimer){clearInterval(v626ProgressTimer);v626ProgressTimer=null}}

function renderOpenPodRows(){
  const latestDate=v626LatestImport?.reportDate||'';
  const rows=v626OpenRows.filter(row=>{
    if(v626OpenFilter==='today')return String(row.reportDate||row.sourceReportDate||'').slice(0,10)===latestDate;
    if(v626OpenFilter==='retry')return String(row.queryStatus||'').includes('重试')||String(row.apiStatus||'').includes('失败');
    return true;
  });
  setText('v626OpenAll',v626OpenRows.length);
  setText('v626OpenToday',v626OpenRows.filter(row=>String(row.reportDate||row.sourceReportDate||'').slice(0,10)===latestDate).length);
  setText('v626OpenRetry',v626OpenRows.filter(row=>String(row.queryStatus||'').includes('重试')||String(row.apiStatus||'').includes('失败')).length);
  const targets=[['v626OpenPodRows',5],['v626ImportOpenRows',6]];
  for(const [id,cols] of targets){
    const tbody=byId(id);if(!tbody)continue;tbody.replaceChildren();
    if(!rows.length){tbody.innerHTML='<tr><td colspan="'+cols+'">当前没有未完成POD</td></tr>';continue}
    for(const row of rows.slice(0,300)){
      const tr=document.createElement('tr');
      const values=cols===5
        ? [row.shipmentCode,row.businessType,row.currentState||row.category||row.queryStatus||'未完成',row.lastEventTime||row.lastCheckedAt||'—']
        : [row.shipmentCode,row.businessType,row.currentState||row.category||'未完成',row.queryStatus||'需更新',row.lastEventTime||row.lastCheckedAt||'—'];
      for(const value of values){const td=document.createElement('td');td.textContent=value||'—';tr.appendChild(td)}
      const td=document.createElement('td');const a=document.createElement('a');a.href='/tracking?auth=v625&code='+encodeURIComponent(row.shipmentCode||'');a.textContent='查看轨迹';td.appendChild(a);tr.appendChild(td);tbody.appendChild(tr);
    }
  }
}
async function loadOpenPod(){
  try{
    const latest=v626LatestImport||await latestImportContext();
    const params=new URLSearchParams({scope:'actionable'});
    if(latest?.snapshotId)params.set('snapshotId',latest.snapshotId);
    if(latest?.reportDate)params.set('reportDate',latest.reportDate);
    const r=await json('/api/tracking-workspace?'+params.toString(),12000);
    v626OpenRows=(r.rows||[]).filter(row=>!row.isClosed);
    renderOpenPodRows();
    return r;
  }catch(error){
    note('v626RefreshPodMessage','未完成POD读取失败：'+error.message,'error');
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
  const to=cambodiaToday();let from=latest.reportDate;
  if(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z')>179*86400000)from=addDaysKey(to,-179);
  note('v626RefreshPodMessage','正在建立未完成POD追踪任务…');
  try{
    const r=await post('/api/v246/tracking/reconcile',{businessType:'ALL',fromDate:from,toDate:to},30000);
    const job=await pollTrackingJob(r.job?.jobId||'');
    note('v626RefreshPodMessage','未完成POD已更新：成功刷新 '+fmt(job.refreshed||0)+' 票，待重试 '+fmt(job.failed||0)+' 票。','success');
    await Promise.all([loadOpenPod(),page==='home'?loadHome({skipAux:true}):Promise.resolve()]);
  }catch(error){note('v626RefreshPodMessage','更新失败：'+error.message,'error')}
}

async function loadHome(options={}){
  const requestedDate=selectedReportDate();
  const summaryUrl='/api/home-quality-summary'+(requestedDate?'?reportDate='+encodeURIComponent(requestedDate):'');
  const [summaryR,historyR]=await Promise.allSettled([
    json(summaryUrl,20000),
    json('/api/unified-history?limit=7',7000)
  ]);
  const summary=summaryR.status==='fulfilled'?summaryR.value:null;
  if(summary?.reportDate&&!selectedReportDate())applyDashboardDate(summary.reportDate);
  const classification=summary?.classification||{};
  const counts=classification.counts||{};
  const returns=summary?.returns||{};
  const types=['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'];
  const sevenBusinessTotal=types.reduce((sum,type)=>sum+Number(counts[type]||0),0);
  const grand=Number(classification.total||sevenBusinessTotal||0);
  setText('v632GrandTotal',fmt(grand));
  setText('v632GrandTotalCheck',fmt(sevenBusinessTotal));
  const totalCard=q('[data-card="TOTAL"]');
  if(totalCard)totalCard.classList.toggle('v632-total-mismatch',grand!==sevenBusinessTotal);
  if(summary?.snapshotId||summary?.reportDate)v626LatestImport={...(v626LatestImport||{}),snapshotId:summary.snapshotId,reportDate:summary.reportDate};

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
  for(const type of ['WHPP','SHOPEECN','SHOPEEVN']){
    setText('v626Return'+type,fmt(returns[type]?.count||0));
    setText('v626ReturnRate'+type,pct(returns[type]?.rate||0));
  }

  setText('v625HomeDateMeta',summary?.reportDate?'今日数据统计（'+summary.reportDate+'）':'今日数据统计');
  setText('v626ProcessReportDate',summary?.reportDate||'等待日报');
  setText('v626ProcessFile',v626LatestImport?.sourceName||'综合日报 '+(summary?.reportDate||''));
  setText('v626ProcessDateSource',summary?.reportDate?'系统识别日报日期：'+summary.reportDate:'日报日期将由系统自动识别');
  setText('v626StageParse',summary?.reportDate?'完成':'等待');setText('v626StageClassify',classification.balanced?'完成':'待核验');
  setText('v625HomeStatusTitle',classification.balanced?'已完成 7 / 7 个业务分类':'分类结果待核验');
  setText('v625HomeStatus',classification.balanced?'七业务分类合计与综合日报有效唯一运单完全一致。':'当前分类总量与综合日报未完全守恒，请先检查分类结果。');
  setText('v625DataStatus',classification.balanced?'正常':'待核验');
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

  const timing=summary?.timing||{},timingTrend=summary?.timingTrend||{};
  v631TimingMissing=Object.fromEntries(Object.entries(timing).map(([type,data])=>[type,data?.evidence?.missingBills||[]]));
  const timingMeta=[
    ['TBKH','v625TimingTBKH','#f4931b'],
    ['WHPP','v625TimingWHPP','#ef5757'],
    ['SHOPEECN','v625TimingSHOPEECN','#ef6a3a'],
    ['SHOPEEVN','v625TimingSHOPEEVN','#ed4b61']
  ];
  const showDays=value=>value===null||value===undefined?'—':Number(value).toFixed(2).replace(/\.00$/,'')+'天';
  for(const [type,prefix,tone] of timingMeta){
    const data=timing[type]||{};
    setText(prefix+'Overall',showDays(data.overall?.avgDays));
    setText(prefix+'Pod','基于 '+fmt(data.overall?.podCount||0)+' 票有效轨迹POD');
    setText(prefix+'PP',showDays(data.pp?.avgDays));setText(prefix+'PPPod',fmt(data.pp?.podCount||0)+'票有效POD');
    setText(prefix+'PV',showDays(data.pv?.avgDays));setText(prefix+'PVPod',fmt(data.pv?.podCount||0)+'票有效POD');
    setText(prefix+'A1',showDays(data.attempt1?.avgDays));setText(prefix+'A2',showDays(data.attempt2?.avgDays));setText(prefix+'A3',showDays(data.attempt3?.avgDays));
    renderMiniTrend('v625TimingTrend'+type,timingTrend[type]||[],tone);
    setText('v626Timing'+type+'Missing',fmt(data.evidence?.missing||data.overall?.missingEvidenceCount||0));
    setText('v626Timing'+type+'Valid',fmt(data.evidence?.valid||data.overall?.podCount||0));
    if(['WHPP','SHOPEECN','SHOPEEVN'].includes(type)){setText('v626Timing'+type+'Return',fmt(returns[type]?.count||0));setText('v626Timing'+type+'ReturnRate',pct(returns[type]?.rate||0))}
  }
  setText('v625TimingPeriod',summary?.reportDate?'统计日报 '+summary.reportDate+' · 仅真实60/70→80轨迹POD':'统计当前日报POD');

  const history=(historyR.status==='fulfilled'?historyR.value?.rows:[])||[];
  renderTrend('v625HomeTrend',history.slice().reverse().map(r=>({label:r.reportDate,value:Object.values(r.classificationCounts||{}).reduce((a,b)=>a+Number(b||0),0)})));
  if(!options.skipAux){void refreshLiveProgress();void loadOpenPod()}
}

function timingMissingReason(code=''){
  return {POD_TRACK_TIME_MISSING:'缺少80/POD轨迹时间',DELIVERY_START_MISSING:'缺少60/70派送起点',INVALID_TRACK_TIME_RANGE:'轨迹时间顺序异常',TRACK_EVIDENCE_MISSING:'缺少完整轨迹证据'}[code]||code||'缺少完整轨迹证据';
}
function renderTimingMissing(type){
  const rows=v631TimingMissing?.[type]||[],panel=byId('v631TimingMissingPanel'),tbody=byId('v631TimingMissingRows');if(!panel||!tbody)return;
  setText('v631TimingMissingTitle',(type==='SHOPEECN'?'SHOPEE CN':type==='SHOPEEVN'?'SHOPEE VN':type)+' 待补轨迹');
  setText('v631TimingMissingMeta',(selectedReportDate()||byId('v625ToDate')?.value||'')+' · '+rows.length+' 票');
  tbody.replaceChildren();
  if(!rows.length)tbody.innerHTML='<tr><td colspan="4">当前没有待补轨迹运单</td></tr>';
  else for(const row of rows){
    const tr=document.createElement('tr');
    for(const value of [row.shipmentCode,type,timingMissingReason(row.reason)]){const td=document.createElement('td');td.textContent=value||'—';tr.appendChild(td)}
    const td=document.createElement('td'),a=document.createElement('a');
    a.href='/tracking?auth=v625&code='+encodeURIComponent(row.shipmentCode||'')+'&reportDate='+encodeURIComponent(selectedReportDate()||byId('v625ToDate')?.value||'')+'&businessType='+encodeURIComponent(type);
    a.textContent='查看轨迹';td.appendChild(a);tr.appendChild(td);tbody.appendChild(tr);
  }
  panel.hidden=false;panel.scrollIntoView({behavior:'smooth',block:'start'});
}
let v628BusinessWorkspaceRows=[];
let v630BusinessDetailTabs={};
let v631BusinessAccounting={rowsByKind:{},total:0,accounted:0,difference:0};
let v628BusinessMetricState={};
let v628BusinessReportDate='';
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
function rowIsPod(row={}){const text=rowText(row);return row.是否POD==='是'||String(row.orderStatus||'')==='85'||/(^|\s)(POD|已签收|签收成功|已妥投|DELIVERED|SIGNED)(\s|$)/i.test(text)&&!/未签收|未妥投|签收失败/.test(text)}
function rowIsReturned(row={}){const text=rowText(row);return !/未退回|非退回|待退回|退回处理中|NOT_RETURNED|PENDING_RETURN/i.test(text)&&/(已退回|退回完成|RETURN_COMPLETED|RETURNED)/i.test(text)}
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
  const pod=uniqueDetailRows(tabs?.pod?.rows||[]);
  const returned=uniqueDetailRows(tabs?.returned?.rows||[]);
  const cancelled=uniqueDetailRows(tabs?.cancelled?.rows||[]);
  const normalDiversion=uniqueDetailRows(tabs?.normalDiversion?.rows||[]);
  const shops=uniqueDetailRows([
    ...(tabs?.phnomPenhShop?.rows||[]),
    ...(tabs?.provinceShop?.rows||[]),
    ...(tabs?.unknownShop?.rows||[])
  ]);
  const unresolved=uniqueDetailRows(tabs?.unresolved?.rows||[]);
  const assigned=new Set([...pod,...returned,...cancelled,...normalDiversion,...shops].map(detailCode));
  const pending=[],abnormal=[],delivery=[],unprocessed=[];
  for(const row of unresolved){
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
  const rowsByKind={total:all,pod,returned,pending,abnormal,otherNormal,delivery,unprocessed};
  const total=Number(metrics.total||fallback.total||all.length||0);
  const accounted=['pod','returned','pending','abnormal','otherNormal','delivery','unprocessed'].reduce((n,key)=>n+rowsByKind[key].length,0);
  return{total,accounted,difference:total-accounted,rowsByKind,canonical:true};
}
function buildBusinessAccounting(state={},fallback={}){
  const authoritativeRows=
    state?.detailTabs?.all?.rows||
    state?.detailTabs?.allData?.rows||
    state?.detailTabs?.dashboard?.rows||
    (Array.isArray(state.finalRows)?state.finalRows:Object.values(state.finalRows||{}));
  const source=uniqueDetailRows(authoritativeRows||[]);
  const total=Number(fallback.total||source.length||0);
  if(!source.length)return{total,accounted:0,difference:total,rowsByKind:{total:[],pod:[],returned:[],pending:[],abnormal:[],otherNormal:[],delivery:[]}};
  const rowsByKind={total:source,pod:[],returned:[],pending:[],abnormal:[],otherNormal:[],delivery:[],unprocessed:[]};
  for(const row of source){
    if(row.finalRowAvailable===false)rowsByKind.unprocessed.push(row);
    else if(rowIsPod(row))rowsByKind.pod.push(row);
    else if(rowIsReturned(row))rowsByKind.returned.push(row);
    else if(rowIsPending(row))rowsByKind.pending.push(row);
    else if(rowIsAbnormal(row))rowsByKind.abnormal.push(row);
    else if(rowIsOtherNormal(row))rowsByKind.otherNormal.push(row);
    else rowsByKind.delivery.push(row);
  }
  const accounted=['pod','returned','pending','abnormal','otherNormal','delivery','unprocessed'].reduce((n,key)=>n+rowsByKind[key].length,0);
  return{total:total||source.length,accounted,difference:(total||source.length)-accounted,rowsByKind};
}
function v628MetricRows(kind){
  const exact=v631BusinessAccounting?.rowsByKind?.[kind];
  if(Array.isArray(exact)&&exact.length)return exact;
  if(kind==='total'&&Array.isArray(v631BusinessAccounting?.rowsByKind?.total))return v631BusinessAccounting.rowsByKind.total;
  return [];
}
function renderKpiDetail(kind){
  const panel=byId('v628KpiDetailPanel'),tbody=byId('v628KpiDetailRows');if(!panel||!tbody)return;
  const labels={total:'总票数',delivery:'派送中',pod:'已签收(POD)',pending:'Pending',abnormal:'异常',returned:'退回件',otherNormal:'其他正常状态',unprocessed:'待处理'};
  const rows=v628MetricRows(kind);
  qa('[data-kpi-detail]').forEach(el=>el.classList.toggle('active',el.dataset.kpiDetail===kind));
  setText('v628KpiDetailTitle',(labels[kind]||'指标')+'明细');
  setText('v628KpiDetailMeta',v628BusinessReportDate+' · '+business+' · '+rows.length+' 票');
  tbody.replaceChildren();
  if(!rows.length)tbody.innerHTML='<tr><td colspan="7">当前指标暂无对应运单</td></tr>';
  else for(const row of rows){
    const tr=document.createElement('tr');
    const code=row.shipmentCode||row.运单号||'';
    const status=row.category||row.primaryCategory||row.主分类||row.异常分类||row.latestNode||row.最后节点||row.queryStatus||row.scanStatus||row.currentState||'—';
    const latestNode=row.latestNode||row.latestEventDesc||row.最后节点||row.lastEventDesc||'—';
    const latestTime=row.latestTime||row.latestEventTime||row.最后节点时间||row.lastEventTime||'—';
    const region=row.region||row.regionCode||row.区域||'—';
    for(const value of [code,row.businessType||business,region,status,latestNode,latestTime]){
      const td=document.createElement('td');td.textContent=value||'—';tr.appendChild(td);
    }
    const action=document.createElement('td'),a=document.createElement('a');
    a.href='/tracking?auth=v625&code='+encodeURIComponent(code)+'&reportDate='+encodeURIComponent(v628BusinessReportDate||'')+'&businessType='+encodeURIComponent(business);
    a.textContent='查看轨迹';action.appendChild(a);tr.appendChild(action);tbody.appendChild(tr);
  }
  panel.hidden=false;
  panel.scrollIntoView({behavior:'smooth',block:'start'});
}
async function loadBusiness(){
  try{
    const params=new URLSearchParams(location.search);
    const latest=v626LatestImport||await latestImportContext();
    const requestedDate=params.get('reportDate')||params.get('toDate')||params.get('fromDate')||'';
    const requestedSnapshot=params.get('snapshotId')||'';
    const summaryQuery=new URLSearchParams();
    if(requestedDate)summaryQuery.set('reportDate',requestedDate);
    if(requestedSnapshot)summaryQuery.set('snapshotId',requestedSnapshot);
    const summary=await json('/api/home-quality-summary?'+summaryQuery.toString(),20000).catch(()=>null);
    const snapshotId=summary?.snapshotId||requestedSnapshot||latest?.snapshotId||'';
    const reportDate=summary?.reportDate||requestedDate||latest?.reportDate||'';
    const stateUrl='/api/business-state/'+business+(snapshotId?'?snapshotId='+encodeURIComponent(snapshotId):'');
    const r=await json(stateUrl,15000);
    const state=r.state||{},m=metricState(state);
    v630BusinessDetailTabs=state.detailTabs||state?.dashboard?.detailTabs||{};
    v631BusinessAccounting=business==='WHPP'?buildWhppCanonicalAccounting(state,m):buildBusinessAccounting(state,m);
    v628BusinessMetricState=m;v628BusinessReportDate=reportDate;
    if(reportDate&&!selectedReportDate())applyDashboardDate(reportDate);
    if(reportDate){byId('v625FromDate')&&(byId('v625FromDate').value=reportDate);byId('v625ToDate')&&(byId('v625ToDate').value=reportDate)}
    const a=v631BusinessAccounting,counts=Object.fromEntries(Object.entries(a.rowsByKind||{}).map(([k,v])=>[k,v.length]));
    setText('kpiTotal',fmt(a.total||m.total));setText('kpiDelivery',fmt(counts.delivery??m.delivery));setText('kpiPod',fmt(counts.pod??m.pod));
    setText('kpiPodRate',pct((a.total||m.total)?Number(counts.pod??m.pod)*100/Number(a.total||m.total):0));
    setText('kpiPending',fmt(counts.pending??m.pending));setText('kpiOpen',fmt(counts.abnormal??m.unresolved));setText('kpiOc',fmt(m.oc));
    setText('v631AccountingMeta','已归类 '+fmt(a.accounted)+' / '+fmt(a.total)+' · 差异 '+fmt(a.difference));
    const timing=summary?.reportDate===reportDate?summary?.timing?.[business]:null;
    setText('kpiAvgDays',timing?.overall?.avgDays==null?'—':Number(timing.overall.avgDays).toFixed(2).replace(/\.00$/,''));
    const returnCapable=['WHPP','SHOPEECN','SHOPEEVN'].includes(business);
    if(byId('kpiReturnedCard'))byId('kpiReturnedCard').hidden=!returnCapable;if(byId('kpiReturnRateCard'))byId('kpiReturnRateCard').hidden=!returnCapable;
    if(returnCapable){setText('kpiReturned',fmt((counts.returned??m.returned)||0));setText('kpiReturnRate',pct((a.total||m.total)?Number((counts.returned??m.returned)||0)*100/Number(a.total||m.total):0))}
    if(byId('kpiOtherCard')){byId('kpiOtherCard').hidden=false;setText('kpiOtherNormal',fmt(counts.otherNormal||0))}
    if(byId('kpiUnprocessedCard')){byId('kpiUnprocessedCard').hidden=!(counts.unprocessed>0);setText('kpiUnprocessed',fmt(counts.unprocessed||0))}
    const hist=state.historySummary||[];renderTrend('v625BusinessTrend',hist.map(x=>({label:x.reportDate||'',value:first(x,['summary.today','summary.total','today','total'])||0})));
    if(business==='WHPP'){
      renderDonut({total:a.total,delivery:counts.delivery||0,pod:counts.pod||0,pending:counts.pending||0,unresolved:(counts.abnormal||0)+(counts.unprocessed||0)});
    }else renderDonut(m);
    const qs=new URLSearchParams({scope:'all'});if(snapshotId)qs.set('snapshotId',snapshotId);if(reportDate)qs.set('reportDate',reportDate);
    const wr=await json('/api/tracking-workspace?'+qs.toString(),10000).catch(()=>({rows:[]}));
    v628BusinessWorkspaceRows=(wr.rows||[]).filter(businessTypeMatches);
    const rows=v628BusinessWorkspaceRows.filter(x=>x.isActionable).slice(0,8);
    const tbody=byId('v625BusinessRows');tbody.replaceChildren();
    if(!rows.length){tbody.innerHTML='<tr><td colspan="7">当前日报暂无异常记录</td></tr>'}
    else for(const row of rows){tbody.appendChild(rowTr([row.shipmentCode,row.businessType,row.category||row.queryStatus||'异常',row.pendingDays||row.ocDays||'—',row.currentState||row.queryStatus||'—',row.latestTime||row.lastEventTime||'—','查看']))}
  }catch(e){byId('v625BusinessRows').innerHTML='<tr><td colspan="7">业务快照暂未读取：'+esc(e.message)+'</td></tr>'}
}

function rowTr(values){const tr=document.createElement('tr');for(const v of values){const td=document.createElement('td');td.textContent=v??'—';tr.appendChild(td)}return tr}

let runBusy=false;
async function loadImport(){
  try{
    const [latest,history]=await Promise.all([json('/api/import/unified-latest',7000),json('/api/unified-history?limit=15',7000)]);
    v626LatestImport=latest.import||v626LatestImport;
    if(latest.import){renderImport(latest.import);note('v625ImportMessage','已读取最近一次综合日报。','success')}
    const tbody=byId('v625ImportHistory');if(tbody){tbody.replaceChildren();
      for(const r of history.rows||[]){
        const tr=document.createElement('tr');
        const values=[dateTime(r.createdAt),r.sourceName||'综合日报',r.reportDate||'—',r.dateDetectionSource||'系统自动识别',r.summary?.validUniqueWaybills??r.summary?.totalUnique??'—',r.snapshotStatus||r.status||'IMPORTED'];
        for(const value of values){const td=document.createElement('td');td.textContent=value;tr.appendChild(td)}tbody.appendChild(tr)
      }
      if(!(history.rows||[]).length)tbody.innerHTML='<tr><td colspan="6">暂无导入记录</td></tr>';
    }
    await Promise.all([refreshLiveProgress(),loadOpenPod()]);
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
  const counts=data.classificationCounts||{};for(const type of ['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN']){const el=q('[data-classification="'+type+'"]');if(el)el.textContent=fmt(counts[type]||0)}
  setText('v625ImportState','已导入');setText('v625ImportDateMeta',(data.reportDate||'—')+' · '+dateSourceText(data));
  setText('v626DetectedReportDate',data.reportDate||'—');setText('v626DetectedDateSource',dateSourceText(data));
  setText('v626ImportProgressDate',data.reportDate||'—');setText('v626ProcessReportDate',data.reportDate||'—');
  setText('v626StageParse','完成');setText('v626StageClassify',data.sourceReconciliation?.balanced?'完成':'待核验');
  setText('v626ImportParse','完成');setText('v626ImportClassify',data.sourceReconciliation?.balanced?'完成':'待核验');
}
async function doImport(){
  const file=byId('v625ImportFile').files?.[0];if(!file){note('v625ImportMessage','请选择综合日报文件。','error');return}
  const fd=new FormData();fd.append('file',file);
  const manualWrap=byId('v626ManualDateWrap');
  if(manualWrap&&!manualWrap.hidden&&byId('v626ManualReportDate')?.value)fd.append('reportDate',byId('v626ManualReportDate').value);
  note('v625ImportMessage','正在读取Excel并自动识别日报日期、分类7个业务…');
  appendLiveLog('开始上传综合日报 '+file.name);
  try{
    const r=await request('/api/import/unified-daily-report',{method:'POST',body:fd},120000);
    renderImport(r);appendLiveLog('日报解析完成：'+(r.reportDate||'')+'，有效唯一运单 '+fmt(r.summary?.validUniqueWaybills||0)+' 票');
    note('v625ImportMessage','导入成功：系统识别日报日期 '+(r.reportDate||'—')+'，7业务分类已完成。','success');
    await loadImport();
  }catch(e){appendLiveLog('日报导入失败：'+e.message);note('v625ImportMessage','导入失败：'+e.message,'error')}
}
async function waitWhppTerminal(reportDate,timeoutMs=300000){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    const r=await json('/api/whpp/progress'+(reportDate?'?reportDate='+encodeURIComponent(reportDate):''),10000);
    const runtime=r.runtime||{};
    renderLiveProgress({ccsl:{},shopee:{},whpp:{...runtime,summary:r.summary||{},log:r.log||[],active:Boolean(runtime.active)}});
    if(!runtime.active&&runtime.outcome){
      if(runtime.outcome==='FAILED')throw new Error(runtime.error||'WHPP处理失败');
      return r;
    }
    await new Promise(resolve=>setTimeout(resolve,1200));
  }
  throw new Error('WHPP处理等待超时');
}
async function safeWhppRun(mode,reportDate){
  try{
    const r=await post('/api/whpp/run/'+(mode==='resume'?'resume':'start'),{reportDate},30000);
    if(r.runtime?.active||r.active)await waitWhppTerminal(reportDate);
    return r;
  }catch(error){
    const code=String(error.payload?.code||'');
    if(code==='WHPP_ALREADY_FINALIZED')return{ok:true,skipped:true,code};
    if(code==='WHPP_REPORT_MISSING'&&Number(v626LatestImport?.classificationCounts?.WHPP||0)===0)return{ok:true,skipped:true,code:'WHPP_ZERO_TICKET'};
    throw error;
  }
}
async function runTask(mode){
  if(runBusy)return;runBusy=true;const reportDate=v626LatestImport?.reportDate||(await latestImportContext())?.reportDate||'';
  note('v625RunMessage','正在处理7业务，扫描与轨迹进度会实时更新。');appendLiveLog((mode==='resume'?'继续':'开始')+'7业务处理 '+(reportDate||''));
  startProgressPolling();
  try{
    if(mode==='start'){
      appendLiveLog('开始CCSL订单扫描/轨迹处理');await post('/api/run',{},360000);
      appendLiveLog('CCSL处理完成，开始SHOPEE CN/VN');await post('/api/shopee/run/start',{},360000);
      appendLiveLog('SHOPEE处理完成，开始WHPP本土');await safeWhppRun('start',reportDate);
    }else{
      appendLiveLog('继续CCSL未完成批次');await post('/api/resume',{},360000).catch(async e=>{if(e.status===409)return;throw e});
      appendLiveLog('继续SHOPEE未完成批次');await post('/api/shopee/run/resume',{},360000).catch(async e=>{if(e.status===409)return;throw e});
      appendLiveLog('继续WHPP未完成批次');await safeWhppRun('resume',reportDate);
    }
    appendLiveLog('7业务处理完成，正在刷新首页与未完成POD账本');note('v625RunMessage','7业务处理完成，未完成POD可继续批量更新。','success');
    await Promise.all([refreshLiveProgress(),loadOpenPod()]);
  }catch(e){appendLiveLog('处理未完成：'+e.message);note('v625RunMessage','任务未完成：'+e.message,'error')}
  finally{runBusy=false;stopProgressPolling();void refreshLiveProgress()}
}
function note(id,msg,tone=''){const el=byId(id);if(!el)return;el.textContent=msg;el.className='v625-inline-note'+(tone?' '+tone:'')}

async function queryTrack(){
  const code=byId('v625TrackCode').value.trim();if(!code){setText('v625TrackMeta','请输入运单号');return}
  setText('v625TrackMeta','查询中…');byId('v625TrackTimeline').innerHTML='<div class="v625-empty-state">查询中…</div>';
  try{
    const r=await post('/api/track-query',{businessType:byId('v625TrackBusiness').value,shipmentCodes:[code],reportDate:byId('v625TrackDate').value||today()},60000);
    const events=(r.trackEvents||[]).filter(x=>String(x.shipmentCode||x.waybill||x.orderNo||'').toUpperCase()===code.toUpperCase()||!x.shipmentCode);
    const eventDesc=e=>{let raw={};try{raw=typeof e.rawJson==='string'?JSON.parse(e.rawJson):e.rawJson||{}}catch{}return first(e,['trackingEventDescZh','trackingEventDesc','eventName','statusName','description','content','remark'])||first(raw,['trackingEventDescZh','trackingEventDesc','statusText','statusName','eventName','remark','message'])||'已保存轨迹证据'};
    byId('v625TrackTimeline').innerHTML=events.length?events.map(e=>'<div class="v625-timeline-item"><b>'+esc(first(e,['eventTime','time','updateTime','createdAt'])||'—')+'</b><p>'+esc(eventDesc(e))+'</p><small>'+esc(e.evidenceSource||'CE实时轨迹')+'</small></div>').join(''):'<div class="v625-empty-state">暂无轨迹节点</div>';
    setText('v625TrackMeta','查询完成 · '+events.length+' 个节点'+(r.localEvidence?' · 含本地已保存证据':''));
  }catch(e){byId('v625TrackTimeline').innerHTML='<div class="v625-empty-state">'+esc(e.message)+'</div>';setText('v625TrackMeta','查询失败')}
}
async function loadExceptions(){
  try{
    const r=await json('/api/tracking-workspace?scope=actionable',10000),rows=r.rows||[];
    const gap=rows.filter(x=>/不连续/.test(String(x.category||x.queryStatus||''))).length;
    const p3=rows.filter(x=>Number(x.pendingDays||0)>=3).length;
    const oc1=rows.filter(x=>Number(x.ocDays||0)>=1).length;
    const shop=rows.filter(x=>/门店/.test(String(x.category||x.currentState||''))).length;
    setText('exPendingGap',fmt(gap));setText('exPending3',fmt(p3));setText('exOc1',fmt(oc1));setText('exShopStay',fmt(shop));setText('v625ExceptionMeta',rows.length+' 条异常');
    renderExceptionRows(rows);
  }catch(e){byId('v625ExceptionRows').innerHTML='<tr><td colspan="7">'+esc(e.message)+'</td></tr>'}
}
function renderExceptionRows(rows){
  const type=byId('v625ExceptionType')?.value||'',biz=byId('v625ExceptionBusiness')?.value||'';
  const filtered=rows.filter(r=>(!type||String(r.category||r.queryStatus||'').includes(type.replace(' 3天+','')))&&(!biz||String(r.businessType||'')===biz)).slice(0,200);
  const tbody=byId('v625ExceptionRows');tbody.replaceChildren();
  if(!filtered.length){tbody.innerHTML='<tr><td colspan="7">当前筛选暂无异常</td></tr>';return}
  for(const r of filtered)tbody.appendChild(rowTr([r.shipmentCode,r.businessType,r.category||r.queryStatus||'异常',r.pendingDays||r.ocDays||'—',r.currentState||r.queryStatus||'—',r.lastEventTime||r.rawSummary||'—','查看']));
}

let reportPeriod='daily',generated=[];
async function generateReport(){
  const date=byId('v625ReportDate').value||today(),businessType=byId('v625ReportBusiness').value;
  try{
    const r=await post('/api/export-period/prepare',{periodType:reportPeriod,date,businessType},120000);
    generated=[...(r.files||[]),...generated];renderReports();
  }catch(e){setText('v625ReportMeta','生成失败：'+e.message)}
}
function renderReports(){
  const tbody=byId('v625ReportRows');tbody.replaceChildren();
  if(!generated.length){tbody.innerHTML='<tr><td colspan="4">暂无生成记录</td></tr>';return}
  for(const f of generated){const tr=document.createElement('tr');const td1=document.createElement('td');td1.textContent=f.name;const td2=document.createElement('td');td2.textContent=new Date().toLocaleString('zh-CN',{hour12:false});const td3=document.createElement('td');td3.innerHTML='<span class="v625-badge success">已完成</span>';const td4=document.createElement('td');const a=document.createElement('a');a.href=f.url;a.textContent='下载';td4.appendChild(a);tr.append(td1,td2,td3,td4);tbody.appendChild(tr)}
}

let settingsUsers=[];
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
    setText('v625CeStatus',a.loggedIn&&!a.expired?'已连接':'未连接');
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
  }
}

function switchSettingsTab(name){
  qa('#v625SettingsTabs [data-settings-tab]').forEach(btn=>btn.classList.toggle('active',btn.dataset.settingsTab===name));
  qa('[data-settings-panel]').forEach(panel=>panel.hidden=panel.dataset.settingsPanel!==name);
  if(name==='accounts')void loadSettingsUsers();
  if(name==='interface')void loadSettings();
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
    const r=await json('/api/admin/users',7000);
    settingsUsers=r.rows||[];
    renderSettingsUsers();
  }catch(e){
    if(tbody)tbody.innerHTML='<tr><td colspan="7">需要管理员权限或读取失败</td></tr>';
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
async function ceLogin(){try{const r=await post('/api/ce-login',{tenantId:byId('v625CeTenant').value||'000000',username:byId('v625CeUser').value.trim(),password:byId('v625CePassword').value},30000);byId('v625CePassword').value='';setText('v625CeStatus','已连接');note('v625CeMessage','CE登录成功：'+(r.authStatus?.account||''),'success')}catch(e){note('v625CeMessage','登录失败：'+e.message,'error')}}
async function ceLogout(){try{await post('/api/ce-logout',{},15000);setText('v625CeStatus','未连接');note('v625CeMessage','已退出CE系统。','success')}catch(e){note('v625CeMessage','退出失败：'+e.message,'error')}}
async function importShop(){const file=byId('v625ShopFile').files?.[0];if(!file)return;const fd=new FormData();fd.append('file',file);try{await request('/api/import-shop-codes',{method:'POST',body:fd},60000);setText('v625ShopMeta','更新完成')}catch(e){setText('v625ShopMeta','更新失败')}}

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
async function clearAllBusinessData(){
  if(!confirm('确认清空全部业务数据？\n\n将删除日报、分类、扫描、轨迹、POD、异常和统计数据；账号、权限、CE设置、门店CP码及已有数据库备份会保留。'))return;
  note('v626ClearStatus','正在提交一键清空任务…');
  try{
    const r=await post('/api/admin/data-purge/direct',{phrase:'永久清除全部业务数据'},30000);
    const result=await pollDirectPurge(r.jobId);
    note('v626ClearStatus','业务数据已全部清空；已有备份已保留。共删除 '+fmt(result.deletedRows||0)+' 行。','success');
    v626LatestImport=null;v626OpenRows=[];renderOpenPodRows();await loadBackups();
  }catch(e){note('v626ClearStatus','清空失败：'+e.message,'error')}
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
  byId('v626RefreshOpenPod')?.addEventListener('click',refreshOpenPodNow);
  byId('v626ImportRefreshOpen')?.addEventListener('click',refreshOpenPodNow);
  qa('[data-open-filter]').forEach(btn=>btn.addEventListener('click',()=>{v626OpenFilter=btn.dataset.openFilter;qa('[data-open-filter]').forEach(x=>x.classList.toggle('active',x===btn));renderOpenPodRows()}));
  byId('v625TrackSearch')?.addEventListener('click',queryTrack);byId('v625TrackReset')?.addEventListener('click',()=>{byId('v625TrackCode').value='';byId('v625TrackTimeline').innerHTML='<div class="v625-empty-state">暂无轨迹数据</div>'});
  byId('v625ExceptionSearch')?.addEventListener('click',loadExceptions);
  qa('.v625-tabs button[data-period]').forEach(b=>b.addEventListener('click',()=>{qa('.v625-tabs button[data-period]').forEach(x=>x.classList.toggle('active',x===b));reportPeriod=b.dataset.period}));
  byId('v625GenerateReport')?.addEventListener('click',generateReport);
  qa('#v625SettingsTabs [data-settings-tab]').forEach(btn=>btn.addEventListener('click',()=>switchSettingsTab(btn.dataset.settingsTab)));
  byId('v625AddUser')?.addEventListener('click',()=>openUserEditor());byId('v625CancelUserEdit')?.addEventListener('click',closeUserEditor);byId('v625SaveUser')?.addEventListener('click',saveSettingsUser);
  byId('v625CeLogin')?.addEventListener('click',ceLogin);byId('v625CeLogout')?.addEventListener('click',ceLogout);
  byId('v625ShopFile')?.addEventListener('change',()=>setText('v625ShopFileName',byId('v625ShopFile').files?.[0]?.name||'请选择CP码文件'));byId('v625ShopImport')?.addEventListener('click',importShop);
  byId('v625SettingsBackupNow')?.addEventListener('click',settingsBackupNow);
  byId('v625LogSearch')?.addEventListener('click',loadLogs);
  byId('v625BackupNow')?.addEventListener('click',backupNow);byId('v626BackupNowTop')?.addEventListener('click',backupNow);
  byId('v626ClearAllData')?.addEventListener('click',clearAllBusinessData);
  qa('#v626DataTabs [data-data-tab]').forEach(btn=>btn.addEventListener('click',()=>switchDataTab(btn.dataset.dataTab)));
}
async function init(){
  bind();void loadSession();
  if(page==='home'){
    await latestImportContext();
    await loadHome();
  }
  else if(business){
    await latestImportContext();
    await loadBusiness();
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
  else if(page==='data-management'){switchDataTab('clear');await loadBackups()}
  else if(page==='users')await loadUsers();
  else if(page==='profile')await loadSession();
}
void init();
})();