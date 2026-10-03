(()=>{
'use strict';

const body=document.body;
const page=String(body.dataset.page||'home');
const business=String(body.dataset.business||'');
const home=document.getElementById('v624Home');
const biz=document.getElementById('v624Business');
const imp=document.getElementById('v624Import');
const settings=document.getElementById('v624Settings');
const logsPage=document.getElementById('v624Logs');
const simple=document.getElementById('v624SimpleOperation');

document.querySelectorAll('.v624-nav a[data-key]').forEach(a=>a.classList.toggle('active',a.dataset.key===page));
if(home)home.hidden=page!=='home';
if(biz)biz.hidden=!business;
if(imp)imp.hidden=page!=='import';
if(settings)settings.hidden=page!=='settings';
if(logsPage)logsPage.hidden=page!=='logs';
if(simple)simple.hidden=page==='home'||Boolean(business)||['import','settings','logs'].includes(page);

const num=v=>Number.isFinite(Number(v))?Number(v):null;
const fmt=v=>v===null||v===undefined?'—':Number(v).toLocaleString('zh-CN');
const pct=v=>v===null||v===undefined?'—':Number(v).toFixed(2).replace(/\.00$/,'')+'%';
const first=(obj,paths)=>{
  for(const p of paths){
    let cur=obj;
    for(const part of p.split('.'))cur=cur?.[part];
    if(cur!==undefined&&cur!==null&&cur!=='')return cur;
  }
  return null;
};

async function request(url,options={},timeout=10000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const res=await fetch(url,{cache:'no-store',credentials:'same-origin',...options,signal:controller.signal});
    const type=String(res.headers.get('content-type')||'');
    const payload=type.includes('application/json')?await res.json():{ok:res.ok,text:await res.text()};
    if(!res.ok||payload?.ok===false){
      const error=new Error(payload?.error||('HTTP '+res.status));
      error.payload=payload;
      error.status=res.status;
      throw error;
    }
    return payload;
  }finally{clearTimeout(timer);}
}
const json=(url,timeout=7000)=>request(url,{},timeout);

function metrics(state){
  const total=num(first(state,['total','today','dashboard.metrics.total','dashboard.totalMonitored','dashboard.pnh','dailySummary.total','dailyParseSummary.totalRecognized']));
  const pod=num(first(state,['pod','podCount','dashboard.metrics.pod','dashboard.metrics.todayPod','dashboard.todayPod','dashboard.pod']));
  const podRate=num(first(state,['podRate','dashboard.metrics.podRate','dashboard.podRate']));
  const pending=num(first(state,['pending','pendingCount','dashboard.metrics.pendingNonContinuous','dashboard.metrics.pending1','dashboard.categories.pendingTotal','dashboard.pending']));
  const oc=num(first(state,['oc','ocCount','dashboard.metrics.ocCurrent','dashboard.metrics.oc1','dashboard.categories.ocTotal','dashboard.oc']));
  const open=num(first(state,['unresolved','open','dashboard.metrics.unresolved','dashboard.abnormalCount','dashboard.metrics.currentOpen','dashboard.open']));
  return{total,pod,podRate:podRate??(total&&pod!==null?pod/total*100:null),pending,oc,open};
}

async function loadBusiness(type){
  const status=document.getElementById('v624BusinessStatus');
  try{
    const payload=await json('/api/business-state/'+encodeURIComponent(type)+'?compact=1',7000);
    const state=payload.state||payload;
    const m=metrics(state);
    document.getElementById('kpiTotal').textContent=fmt(m.total);
    document.getElementById('kpiPod').textContent=fmt(m.pod);
    document.getElementById('kpiPodRate').textContent=pct(m.podRate);
    document.getElementById('kpiPending').textContent=fmt(m.pending);
    document.getElementById('kpiOc').textContent=fmt(m.oc);
    document.getElementById('kpiOpen').textContent=fmt(m.open);
    document.getElementById('v624SnapshotMeta').textContent=[payload.reportDate||state.reportDate||'—',payload.snapshotStatus||state.snapshotStatus||''].filter(Boolean).join(' · ');
    status.textContent='业务快照读取完成。页面导航与数据读取完全独立。';
  }catch(err){
    status.textContent='数据暂时未读取成功：'+(err?.name==='AbortError'?'请求超时':String(err?.message||err))+'。页面导航仍可正常使用。';
    document.getElementById('v624SnapshotMeta').textContent='数据未就绪';
  }
}

async function loadHome(){
  const status=document.getElementById('v624HomeStatus');
  const types=['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'];
  let importedCounts={};
  let importDate='';
  try{
    const latest=await json('/api/import/unified-latest',5000);
    importedCounts=latest?.import?.classificationCounts||{};
    importDate=latest?.import?.reportDate||'';
    for(const type of types){
      const value=num(importedCounts?.[type]);
      const card=document.querySelector('[data-card="'+type+'"] b');
      if(card&&value!==null)card.textContent=fmt(value);
    }
  }catch{}
  let ok=0;
  await Promise.all(types.map(async type=>{
    try{
      const payload=await json('/api/business-state/'+encodeURIComponent(type)+'?compact=1',5000);
      const state=payload.state||payload;
      const processed=metrics(state).total;
      const imported=num(importedCounts?.[type]);
      const card=document.querySelector('[data-card="'+type+'"] b');
      if(card&&(imported===null||imported===0)&&processed!==null)card.textContent=fmt(processed);
      ok++;
    }catch{}
  }));
  status.textContent=(importDate?'当前日报 '+importDate+' · ':'')+'已读取 '+ok+' / '+types.length+' 个业务快照；今日票数优先按综合日报分类结果显示。';
}

function setMessage(id,message,tone=''){
  const el=document.getElementById(id);
  if(!el)return;
  el.textContent=message;
  el.className='v624-message'+(tone?' '+tone:'');
}

function importCounts(data){
  return data?.classificationCounts||data?.counts||data?.summary?.classificationCounts||data?.import?.classificationCounts||{};
}
function renderImportSnapshot(data){
  if(!data)return;
  const source=data.import||data;
  const counts=importCounts(source);
  for(const type of ['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN']){
    const el=document.querySelector('[data-classification="'+type+'"]');
    if(el)el.textContent=fmt(num(counts?.[type])??0);
  }
  const reportDate=source.reportDate||source.date||'—';
  const batchId=source.batchId||'';
  document.getElementById('v624ImportDateMeta').textContent=reportDate+(batchId?' · '+String(batchId).slice(0,12):'');
  document.getElementById('v624ImportState').textContent=source.sourceName||source.fileName||source.originalName?'已导入':'当前批次';
  const carry=source.carryover||data.carryover||{};
  const current=num(first(carry,['currentOpen','current','total']))??0;
  const historical=num(first(carry,['historicalOpen','historical']))??0;
  setMessage('v624CarryMeta','当前处理队列 '+fmt(current)+' 票 · 历史跨日 '+fmt(historical)+' 票','success');
}

async function loadLatestImport(){
  try{
    const result=await json('/api/import/unified-latest?compact=1',7000);
    if(result?.import){
      renderImportSnapshot(result.import);
      setMessage('v624ImportMessage','已读取最近一次综合日报：'+(result.import.reportDate||'日期未标记')+'。','success');
    }
  }catch(err){
    setMessage('v624ImportMessage','最近批次暂未读取：'+(err?.name==='AbortError'?'请求超时':String(err?.message||err)));
  }
}

async function doUnifiedImport(){
  const file=document.getElementById('v624ImportFile')?.files?.[0];
  if(!file){setMessage('v624ImportMessage','请选择综合日报 Excel。','error');return;}
  const button=document.getElementById('v624ImportButton');
  button.disabled=true;
  button.textContent='正在导入并分类…';
  setMessage('v624ImportMessage','正在读取日报并写入分类结果，请勿重复点击。');
  try{
    const bodyData=new FormData();
    bodyData.append('file',file);
    bodyData.append('reportDate',document.getElementById('v624ReportDate')?.value||'');
    const result=await request('/api/import/unified-daily-report',{method:'POST',body:bodyData},120000);
    renderImportSnapshot(result);
    setMessage('v624ImportMessage','综合日报导入成功，分类结果已保存。','success');
    document.getElementById('v624RunMeta').textContent='已导入，可开始处理';
  }catch(err){
    setMessage('v624ImportMessage','导入失败：'+(err?.name==='AbortError'?'处理超时，请稍后刷新查看是否已保存':String(err?.message||err)),'error');
  }finally{
    button.disabled=false;
    button.textContent='导入综合日报并自动分类';
  }
}

let runBusy=false;
async function postRun(url,timeout=240000){
  return request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},timeout);
}

async function startUnified(){
  if(runBusy)return;
  runBusy=true;
  document.getElementById('v624RunMeta').textContent='处理中';
  setMessage('v624RunMessage','正在启动 CCSL + SHOPEE 处理。大型批次可能需要较长时间，但页面导航不会被锁死。');
  try{
    const messages=[];
    for(const [name,url] of [['CCSL','/api/run'],['SHOPEE','/api/shopee/run/start']]){
      try{
        await postRun(url,240000);
        messages.push(name+'完成');
      }catch(err){
        if(err?.payload?.code==='RUN_ALREADY_COMPLETED')messages.push(name+'已完成');
        else throw err;
      }
    }
    document.getElementById('v624RunMeta').textContent='处理完成';
    setMessage('v624RunMessage','综合日报处理完成：'+messages.join('；')+'。','success');
    await loadLatestImport();
  }catch(err){
    document.getElementById('v624RunMeta').textContent='未完成';
    setMessage('v624RunMessage','处理未完成：'+(err?.name==='AbortError'?'请求时间较长，后台可能仍在处理；请稍后刷新状态':String(err?.message||err))+'。已保存的进度可继续处理。','error');
  }finally{runBusy=false;}
}

async function resumeUnified(){
  if(runBusy)return;
  runBusy=true;
  document.getElementById('v624RunMeta').textContent='继续处理中';
  setMessage('v624RunMessage','正在从已保存进度继续处理。');
  try{
    const results=[];
    for(const [name,url] of [['CCSL','/api/resume'],['SHOPEE','/api/shopee/run/resume']]){
      try{
        await postRun(url,240000);
        results.push(name+'继续完成');
      }catch(err){
        if(['RUN_ALREADY_COMPLETED','RUN_NOT_RECOVERABLE'].includes(err?.payload?.code))results.push(name+'无需继续');
        else throw err;
      }
    }
    document.getElementById('v624RunMeta').textContent='继续完成';
    setMessage('v624RunMessage',results.join('；')+'。','success');
  }catch(err){
    document.getElementById('v624RunMeta').textContent='继续失败';
    setMessage('v624RunMessage','继续处理失败：'+String(err?.message||err),'error');
  }finally{runBusy=false;}
}

async function pauseUnified(){
  if(runBusy)return;
  runBusy=true;
  try{
    const results=[];
    for(const [name,url] of [['CCSL','/api/pause'],['SHOPEE','/api/shopee/run/pause']]){
      try{await postRun(url,30000);results.push(name+'已暂停');}
      catch(err){if(err?.status===409)results.push(name+'当前无运行任务');else throw err;}
    }
    document.getElementById('v624RunMeta').textContent='已暂停';
    setMessage('v624RunMessage',results.join('；')+'。','success');
  }catch(err){
    setMessage('v624RunMessage','暂停失败：'+String(err?.message||err),'error');
  }finally{runBusy=false;}
}

function setupImport(){
  const file=document.getElementById('v624ImportFile');
  file?.addEventListener('change',()=>{
    const selected=file.files?.[0];
    document.getElementById('v624ImportFileName').textContent=selected?.name||'选择综合日报 Excel';
  });
  document.getElementById('v624ImportButton')?.addEventListener('click',doUnifiedImport);
  document.getElementById('v624RunStart')?.addEventListener('click',startUnified);
  document.getElementById('v624RunResume')?.addEventListener('click',resumeUnified);
  document.getElementById('v624RunPause')?.addEventListener('click',pauseUnified);
  void loadLatestImport();
}

function setText(id,value){
  const el=document.getElementById(id);
  if(el)el.textContent=value===undefined||value===null||value===''?'—':String(value);
}

async function loadSettings(){
  setMessage('v624CeMessage','正在读取CE连接状态。');
  try{
    const [sessionResult,ceResult,stateResult]=await Promise.allSettled([
      json('/api/session',7000),
      json('/api/ce-auth-status',7000),
      json('/api/state?compact=1',7000)
    ]);
    if(sessionResult.status==='fulfilled'){
      const user=sessionResult.value?.user||{};
      setText('v624UserName',user.displayName||user.username||user.email||'当前用户');
      setText('v624UserRole',user.role||'—');
      setText('v624UserScope',user.businessScope||'ALL');
      setText('v624SessionState','已登录');
    }else setText('v624SessionState','读取失败');

    if(ceResult.status==='fulfilled'){
      const auth=ceResult.value?.authStatus||{};
      setText('v624CeStatus',auth.loggedIn&&!auth.expired?'已连接':'未连接');
      if(auth.tenantId)document.getElementById('v624CeTenant').value=auth.tenantId;
      if(auth.account)document.getElementById('v624CeUser').value=auth.account;
      setMessage('v624CeMessage',auth.loggedIn
        ? 'CE账号 '+(auth.account||'—')+' 已登录'+(auth.expiresAt?' · 到期 '+auth.expiresAt:'')
        : 'CE系统当前未登录。',auth.loggedIn?'success':'');
    }else{
      setText('v624CeStatus','读取失败');
      setMessage('v624CeMessage','CE连接状态读取失败。','error');
    }

    if(stateResult.status==='fulfilled'){
      const state=stateResult.value?.state||{};
      const db=state.dbStatus||{};
      const network=state.network||{};
      const shops=state.shopCodes||{};
      setText('v624DbState',db.ok===false?'异常':(db.sqlite||'正常')+(db.lastProcessedReportDate?' · '+db.lastProcessedReportDate:''));
      setText('v624LocalUrl',network.localUrl||location.origin);
      setText('v624LanUrl',network.lanUrl||'未启用');
      const shopCount=num(first(shops,['count','total','active','size']));
      setText('v624ShopMeta',shopCount!==null?fmt(shopCount)+' 个CP码':'已读取');
      setMessage('v624ShopMessage',shopCount!==null?'当前已配置 '+fmt(shopCount)+' 个门店CP码。':'门店CP码状态已读取。','success');
    }
  }catch(err){
    setMessage('v624CeMessage','系统设置读取失败：'+String(err?.message||err),'error');
  }
}

async function loginCe(){
  const username=document.getElementById('v624CeUser')?.value?.trim()||'';
  const password=document.getElementById('v624CePassword')?.value||'';
  const tenantId=document.getElementById('v624CeTenant')?.value?.trim()||'000000';
  if(!username||!password){setMessage('v624CeMessage','请输入CE账号和密码。','error');return;}
  setMessage('v624CeMessage','正在登录CE系统…');
  try{
    const result=await request('/api/ce-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId,username,password})},30000);
    document.getElementById('v624CePassword').value='';
    setText('v624CeStatus','已连接');
    setMessage('v624CeMessage','CE系统登录成功：'+(result?.authStatus?.account||username),'success');
  }catch(err){setMessage('v624CeMessage','CE登录失败：'+String(err?.message||err),'error');}
}
async function logoutCe(){
  try{
    await request('/api/ce-logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},15000);
    setText('v624CeStatus','未连接');
    setMessage('v624CeMessage','已退出CE系统。','success');
  }catch(err){setMessage('v624CeMessage','退出失败：'+String(err?.message||err),'error');}
}
async function importShopCodes(){
  const file=document.getElementById('v624ShopFile')?.files?.[0];
  if(!file){setMessage('v624ShopMessage','请选择门店CP码 Excel。','error');return;}
  const fd=new FormData();fd.append('file',file);
  setMessage('v624ShopMessage','正在更新门店CP码…');
  try{
    const result=await request('/api/import-shop-codes',{method:'POST',body:fd},60000);
    const count=num(first(result,['imported.count','imported.total','imported.active']));
    setText('v624ShopMeta',count!==null?fmt(count)+' 个CP码':'更新完成');
    setMessage('v624ShopMessage','门店CP码更新成功。','success');
  }catch(err){setMessage('v624ShopMessage','更新失败：'+String(err?.message||err),'error');}
}

function renderAuditRows(rows){
  const tbody=document.getElementById('v624AuditRows');
  if(!tbody)return;
  tbody.replaceChildren();
  if(!rows?.length){
    const tr=document.createElement('tr'),td=document.createElement('td');
    td.colSpan=7;td.textContent='暂无审计记录';tr.appendChild(td);tbody.appendChild(tr);return;
  }
  for(const row of rows){
    const tr=document.createElement('tr');
    const values=[row.createdAt,row.userEmail,row.userRole,row.action,row.businessType,row.reportDate,row.ipAddress];
    for(const value of values){const td=document.createElement('td');td.textContent=value||'—';tr.appendChild(td);}
    tbody.appendChild(tr);
  }
}
function renderRuntimeLogs(rows){
  const root=document.getElementById('v624RuntimeLogs');
  if(!root)return;
  root.replaceChildren();
  if(!rows?.length){root.textContent='暂无运行日志';return;}
  for(const line of rows.slice().reverse().slice(0,120)){
    const div=document.createElement('div');
    div.className='v624-log-item';
    div.textContent=String(line||'');
    root.appendChild(div);
  }
}

async function loadLogs(){
  const [auditResult,runtimeResult]=await Promise.allSettled([
    json('/api/admin/audit-logs',7000),
    json('/api/logs/recent',7000)
  ]);
  if(auditResult.status==='fulfilled'){
    const rows=auditResult.value?.rows||[];
    renderAuditRows(rows);
    setText('v624AuditMeta',rows.length+' 条');
  }else{
    renderAuditRows([]);
    setText('v624AuditMeta','无管理员权限或读取失败');
  }
  if(runtimeResult.status==='fulfilled'){
    const rows=runtimeResult.value?.logs||[];
    renderRuntimeLogs(rows);
    setText('v624RuntimeLogMeta',rows.length+' 条');
  }else{
    renderRuntimeLogs([]);
    setText('v624RuntimeLogMeta','读取失败');
  }
}

async function loadSimpleOperation(){
  const title=document.getElementById('v624SimpleTitle');
  const body=document.getElementById('v624SimpleBody');
  const labels={tracking:'轨迹查询',exceptions:'异常明细',reports:'报表导出','data-management':'数据管理'};
  title.textContent=labels[page]||'功能页面';
  body.textContent='该模块已脱离旧前端，目前正在迁移正式业务内容。页面导航和其他已迁移模块不受影响。';
}

function setupSettings(){
  document.getElementById('v624CeLogin')?.addEventListener('click',loginCe);
  document.getElementById('v624CeLogout')?.addEventListener('click',logoutCe);
  const shop=document.getElementById('v624ShopFile');
  shop?.addEventListener('change',()=>setText('v624ShopFileName',shop.files?.[0]?.name||'选择门店CP码 Excel'));
  document.getElementById('v624ShopImport')?.addEventListener('click',importShopCodes);
  void loadSettings();
}

function reload(){
  if(page==='home')void loadHome();
  else if(business)void loadBusiness(business);
  else if(page==='import')void loadLatestImport();
  else if(page==='settings')void loadSettings();
  else if(page==='logs')void loadLogs();
  else void loadSimpleOperation();
}

document.getElementById('v624Reload')?.addEventListener('click',reload);

if(page==='home')void loadHome();
else if(business)void loadBusiness(business);
else if(page==='import')setupImport();
else if(page==='settings')setupSettings();
else if(page==='logs')void loadLogs();
else void loadSimpleOperation();
})();