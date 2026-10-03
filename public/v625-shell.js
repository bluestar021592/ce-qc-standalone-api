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
else showOnly('v625Aux');

if(!business&& !['home'].includes(page))q('[data-dashboard-actions]')?.setAttribute('hidden','');
const boardJump=byId('v625BoardJump');if(boardJump)boardJump.addEventListener('change',()=>location.href=boardJump.value);
byId('v625FromDate')&&(byId('v625FromDate').value=today());
byId('v625ToDate')&&(byId('v625ToDate').value=today());

function metricState(state={}){
  const total=num(first(state,['total','today','dashboard.metrics.total','dashboard.totalMonitored','dashboard.pnh','dailyParseSummary.totalRecognized']))??0;
  const pod=num(first(state,['pod','dashboard.metrics.pod','dashboard.todayPod','dashboard.metrics.todayPod']))??0;
  const pending=num(first(state,['dashboard.metrics.pendingNonContinuous','dashboard.metrics.pending1','dashboard.categories.pendingTotal','pending']))??0;
  const oc=num(first(state,['dashboard.metrics.ocCurrent','dashboard.metrics.oc1','dashboard.categories.ocTotal','oc']))??0;
  const unresolved=num(first(state,['dashboard.metrics.unresolved','dashboard.abnormalCount','unresolved']))??Math.max(0,total-pod);
  const returned=num(first(state,['dashboard.metrics.returned','returned']))??0;
  const cancelled=num(first(state,['dashboard.metrics.cancelled','cancelled']))??0;
  const delivery=Math.max(0,total-pod-returned-cancelled);
  const avgDays=num(first(state,['dashboard.metrics.avgPodDays','avgPodDays','dashboard.avgPodDays']));
  return{total,pod,podRate:total?pod/total*100:0,pending,oc,unresolved,returned,cancelled,delivery,avgDays};
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
    setText('v625ProfileName',u.displayName||u.username||'当前用户');setText('v625ProfileEmail',u.email||u.role||'—');
  }catch{}
}

async function loadHome(){
  const [latestR,historyR]=await Promise.allSettled([json('/api/import/unified-latest',7000),json('/api/unified-history?limit=7',7000)]);
  const latest=latestR.status==='fulfilled'?latestR.value?.import:null;
  const counts=latest?.classificationCounts||{};
  const types=['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'];
  const states={};
  await Promise.all(types.map(async type=>{try{const r=await json('/api/business-state/'+type+'?compact=1',7000);states[type]=r.state||{};}catch{states[type]={}}}));
  const totals={};let grand=0;
  for(const type of types){const imported=num(counts[type]);const processed=metricState(states[type]).total;totals[type]=imported!==null?imported:processed;grand+=totals[type]||0}
  for(const type of types){
    const card=q('[data-card="'+type+'"]');if(!card)continue;
    const value=totals[type]||0;card.querySelector(':scope>strong').textContent=fmt(value);
    const ratio=grand?value/grand*100:0;card.querySelector('[data-ratio]').textContent=pct(ratio);card.querySelector('.v625-card-foot em').style.width=Math.min(100,ratio)+'%';
  }
  setText('v625HomeDateMeta',(latest?.reportDate?'今日数据统计（'+latest.reportDate+'）':'今日数据统计'));
  const ms=types.map(t=>metricState(states[t]));
  const abnormal=ms.reduce((s,m)=>s+m.unresolved,0),resolved=ms.reduce((s,m)=>s+m.pod,0);
  setText('v625TotalTickets',fmt(grand));setText('v625AbnormalTickets',fmt(abnormal));setText('v625AbnormalRate',pct(grand?abnormal/grand*100:0));setText('v625ResolvedTickets',fmt(resolved));
  setText('v625HomeStatusTitle','已读取 '+types.length+' / '+types.length+' 个业务快照');
  setText('v625HomeStatus','今日票数优先按综合日报分类结果显示，数据更新于 '+new Date().toLocaleString('zh-CN',{hour12:false})+'。');
  setText('v625UpdatedAt',new Date().toLocaleString('zh-CN',{hour12:false}));
  const history=(historyR.status==='fulfilled'?historyR.value?.rows:[])||[];
  renderTrend('v625HomeTrend',history.slice().reverse().map(r=>({label:r.reportDate,value:Object.values(r.classificationCounts||{}).reduce((a,b)=>a+Number(b||0),0)})));
}

async function loadBusiness(){
  try{
    const r=await json('/api/business-state/'+business,12000),state=r.state||{},m=metricState(state);
    setText('kpiTotal',fmt(m.total));setText('kpiDelivery',fmt(m.delivery));setText('kpiPod',fmt(m.pod));setText('kpiPodRate',pct(m.podRate));setText('kpiPending',fmt(m.pending));setText('kpiOpen',fmt(m.unresolved));setText('kpiOc',fmt(m.oc));setText('kpiAvgDays',m.avgDays===null?'—':Number(m.avgDays).toFixed(1));
    const hist=state.historySummary||[];renderTrend('v625BusinessTrend',hist.map(x=>({label:x.reportDate||'',value:first(x,['summary.today','summary.total','today','total'])||0})));renderDonut(m);
    const wr=await json('/api/tracking-workspace?scope=actionable',10000).catch(()=>({rows:[]}));
    const rows=(wr.rows||[]).filter(x=>String(x.businessType||'').toUpperCase().includes(business.replace('SHOPEE',''))||String(x.businessType||'').toUpperCase()===business).slice(0,8);
    const tbody=byId('v625BusinessRows');tbody.replaceChildren();
    if(!rows.length){tbody.innerHTML='<tr><td colspan="7">当前无异常记录</td></tr>'}
    else for(const row of rows){tbody.appendChild(rowTr([row.shipmentCode,row.businessType,row.category||row.queryStatus||'异常',row.pendingDays||row.ocDays||'—',row.currentState||row.queryStatus||'—',row.lastEventTime||'—','查看']))}
  }catch(e){byId('v625BusinessRows').innerHTML='<tr><td colspan="7">业务快照暂未读取：'+esc(e.message)+'</td></tr>'}
}

function rowTr(values){const tr=document.createElement('tr');for(const v of values){const td=document.createElement('td');td.textContent=v??'—';tr.appendChild(td)}return tr}

let runBusy=false;
async function loadImport(){
  try{
    const [latest,history]=await Promise.all([json('/api/import/unified-latest',7000),json('/api/unified-history?limit=15',7000)]);
    if(latest.import){renderImport(latest.import);byId('v625ImportMessage').textContent='已读取最近一次综合日报。';byId('v625ImportMessage').className='v625-inline-note success'}
    const tbody=byId('v625ImportHistory');tbody.replaceChildren();
    for(const r of history.rows||[]){const tr=document.createElement('tr');tr.append(...[dateTime(r.createdAt),r.sourceName||'综合日报',r.summary?.validUniqueWaybills??r.summary?.totalUnique??'—',r.snapshotStatus||'IMPORTED','查看'].map(v=>{const td=document.createElement('td');td.textContent=v;return td}));tbody.appendChild(tr)}
    if(!(history.rows||[]).length)tbody.innerHTML='<tr><td colspan="5">暂无导入记录</td></tr>';
  }catch{}
}
function renderImport(data){
  const c=data.classificationCounts||{};for(const type of ['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN']){const el=q('[data-classification="'+type+'"]');if(el)el.textContent=fmt(c[type]||0)}
  setText('v625ImportState','已导入');setText('v625ImportDateMeta',data.reportDate||'—');
}
async function doImport(){
  const file=byId('v625ImportFile').files?.[0];if(!file){note('v625ImportMessage','请选择综合日报文件。','error');return}
  const fd=new FormData();fd.append('file',file);fd.append('reportDate',byId('v625ReportDate').value||'');
  note('v625ImportMessage','正在导入并自动分类…');
  try{const r=await request('/api/import/unified-daily-report',{method:'POST',body:fd},120000);renderImport(r);note('v625ImportMessage','综合日报导入成功。','success');await loadImport()}catch(e){note('v625ImportMessage','导入失败：'+e.message,'error')}
}
async function runTask(mode){
  if(runBusy)return;runBusy=true;note('v625RunMessage',mode==='pause'?'正在暂停任务…':'正在处理，请勿重复点击。');
  try{
    if(mode==='start'){await post('/api/run',{},240000);await post('/api/shopee/run/start',{},240000)}
    else if(mode==='resume'){await post('/api/resume',{},240000);await post('/api/shopee/run/resume',{},240000)}
    else {await post('/api/pause',{},30000).catch(()=>{});await post('/api/shopee/run/pause',{},30000).catch(()=>{})}
    note('v625RunMessage',mode==='pause'?'处理已暂停。':'处理完成。','success');
  }catch(e){note('v625RunMessage','任务未完成：'+e.message,'error')}finally{runBusy=false}
}
function note(id,msg,tone=''){const el=byId(id);if(!el)return;el.textContent=msg;el.className='v625-inline-note'+(tone?' '+tone:'')}

async function queryTrack(){
  const code=byId('v625TrackCode').value.trim();if(!code){setText('v625TrackMeta','请输入运单号');return}
  setText('v625TrackMeta','查询中…');byId('v625TrackTimeline').innerHTML='<div class="v625-empty-state">查询中…</div>';
  try{
    const r=await post('/api/track-query',{businessType:byId('v625TrackBusiness').value,shipmentCodes:[code],reportDate:byId('v625TrackDate').value||today()},60000);
    const events=(r.trackEvents||[]).filter(x=>String(x.shipmentCode||x.waybill||x.orderNo||'')===code||!x.shipmentCode);
    byId('v625TrackTimeline').innerHTML=events.length?events.map(e=>'<div class="v625-timeline-item"><b>'+esc(first(e,['eventTime','time','updateTime','createdAt'])||'—')+'</b><p>'+esc(first(e,['eventName','statusName','description','content','remark'])||JSON.stringify(e).slice(0,160))+'</p></div>').join(''):'<div class="v625-empty-state">暂无轨迹节点</div>';
    setText('v625TrackMeta','查询完成 · '+events.length+' 个节点');
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

async function loadSettings(){
  const [sessionR,ceR,stateR]=await Promise.allSettled([json('/api/session',7000),json('/api/ce-auth-status',7000),json('/api/state?compact=1',7000)]);
  if(sessionR.status==='fulfilled'){const u=sessionR.value.user||{};setText('v625SettingsUser',u.displayName||u.username);setText('v625SettingsRole',u.role);setText('v625SettingsEmail',u.email||u.username)}
  if(ceR.status==='fulfilled'){const a=ceR.value.authStatus||{};setText('v625CeStatus',a.loggedIn&&!a.expired?'已连接':'未连接');if(a.tenantId)byId('v625CeTenant').value=a.tenantId;if(a.account)byId('v625CeUser').value=a.account;note('v625CeMessage',a.loggedIn?'CE账号 '+(a.account||'—')+' 已连接':'CE系统当前未登录。',a.loggedIn?'success':'')}
  if(stateR.status==='fulfilled'){const s=stateR.value.state||{},db=s.dbStatus||{},net=s.network||{},shops=s.shopCodes||{};setText('v625DbState',(db.sqlite||'正常')+(db.lastProcessedReportDate?' · '+db.lastProcessedReportDate:''));setText('v625LocalUrl',net.localUrl||location.origin);setText('v625LanUrl',net.lanUrl||'未启用');setText('v625ShopMeta',fmt(num(first(shops,['count','total','active','size']))??0)+' 个CP码')}
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
async function loadBackups(){
  try{
    const r=await json('/api/backups',7000),rows=r.backups||[];setText('v625BackupMeta',rows.length+' 条');
    const tbody=byId('v625BackupRows');tbody.replaceChildren();
    if(!rows.length){tbody.innerHTML='<tr><td colspan="5">暂无备份</td></tr>';return}
    for(const x of rows.slice(0,50))tbody.appendChild(rowTr([dateTime(x.createdAt||x.created_at),x.fileName||'—',x.backupType||x.reason||'数据库备份',x.fileSize?fmt(Math.round(x.fileSize/1024/1024))+' MB':'—','管理员操作']));
  }catch(e){byId('v625BackupRows').innerHTML='<tr><td colspan="5">备份记录读取失败</td></tr>'}
}
async function backupNow(){try{await post('/api/admin/backup-now',{},60000);await loadBackups()}catch(e){alert(e.message)}}
async function loadUsers(){
  try{const r=await json('/api/admin/users',7000),rows=r.rows||[];const tbody=byId('v625UserRows');tbody.replaceChildren();for(const x of rows.slice(0,20))tbody.appendChild(rowTr([x.username,x.role,x.enabled?'启用':'停用']))}catch{byId('v625UserRows').innerHTML='<tr><td colspan="3">需要管理员权限</td></tr>'}
}

function bind(){
  byId('v625Reload')?.addEventListener('click',()=>location.reload());
  byId('v625Query')?.addEventListener('click',()=>location.reload());
  byId('v625ImportFile')?.addEventListener('change',()=>setText('v625ImportFileName',byId('v625ImportFile').files?.[0]?.name||'选择文件'));
  byId('v625ImportButton')?.addEventListener('click',doImport);byId('v625RunStart')?.addEventListener('click',()=>runTask('start'));byId('v625RunResume')?.addEventListener('click',()=>runTask('resume'));byId('v625RunPause')?.addEventListener('click',()=>runTask('pause'));
  byId('v625TrackSearch')?.addEventListener('click',queryTrack);byId('v625TrackReset')?.addEventListener('click',()=>{byId('v625TrackCode').value='';byId('v625TrackTimeline').innerHTML='<div class="v625-empty-state">暂无轨迹数据</div>'});
  byId('v625ExceptionSearch')?.addEventListener('click',loadExceptions);
  qa('.v625-tabs button[data-period]').forEach(b=>b.addEventListener('click',()=>{qa('.v625-tabs button[data-period]').forEach(x=>x.classList.toggle('active',x===b));reportPeriod=b.dataset.period}));
  byId('v625GenerateReport')?.addEventListener('click',generateReport);
  byId('v625CeLogin')?.addEventListener('click',ceLogin);byId('v625CeLogout')?.addEventListener('click',ceLogout);
  byId('v625ShopFile')?.addEventListener('change',()=>setText('v625ShopFileName',byId('v625ShopFile').files?.[0]?.name||'请选择CP码文件'));byId('v625ShopImport')?.addEventListener('click',importShop);
  byId('v625LogSearch')?.addEventListener('click',loadLogs);byId('v625BackupNow')?.addEventListener('click',backupNow);
}
async function init(){
  bind();void loadSession();
  if(page==='home')await loadHome();
  else if(business)await loadBusiness();
  else if(page==='import')await loadImport();
  else if(page==='exceptions')await loadExceptions();
  else if(page==='reports'){byId('v625ReportDate').value=today();renderReports()}
  else if(page==='tracking')byId('v625TrackDate').value=today();
  else if(page==='settings')await loadSettings();
  else if(page==='logs')await loadLogs();
  else if(page==='data-management')await loadBackups();
  else if(page==='users'||page==='roles'||page==='profile'||page==='not-found')await loadUsers();
}
void init();
})();