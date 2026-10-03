(()=>{
'use strict';

const body=document.body;
const page=String(body.dataset.page||'home');
const business=String(body.dataset.business||'');
const home=document.getElementById('v624Home');
const biz=document.getElementById('v624Business');
const imp=document.getElementById('v624Import');
const simple=document.getElementById('v624SimpleOperation');

document.querySelectorAll('.v624-nav a[data-key]').forEach(a=>a.classList.toggle('active',a.dataset.key===page));
if(home)home.hidden=page!=='home';
if(biz)biz.hidden=!business;
if(imp)imp.hidden=page!=='import';
if(simple)simple.hidden=page==='home'||Boolean(business)||page==='import';

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
  const total=num(first(state,['total','today','dashboard.metrics.total','dashboard.total','dailySummary.total','dailyParseSummary.totalRecognized']));
  const pod=num(first(state,['pod','podCount','dashboard.metrics.pod','dashboard.metrics.todayPod','dashboard.pod']));
  const podRate=num(first(state,['podRate','dashboard.metrics.podRate','dashboard.podRate']));
  const pending=num(first(state,['pending','pendingCount','dashboard.metrics.pending','dashboard.metrics.pending1','dashboard.pending']));
  const oc=num(first(state,['oc','ocCount','dashboard.metrics.oc','dashboard.metrics.oc1','dashboard.oc']));
  const open=num(first(state,['unresolved','open','dashboard.metrics.unresolved','dashboard.metrics.currentOpen','dashboard.open']));
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
  let ok=0;
  await Promise.all(types.map(async type=>{
    try{
      const payload=await json('/api/business-state/'+encodeURIComponent(type)+'?compact=1',5000);
      const state=payload.state||payload;
      const card=document.querySelector('[data-card="'+type+'"] b');
      if(card)card.textContent=fmt(metrics(state).total);
      ok++;
    }catch{}
  }));
  status.textContent='已读取 '+ok+' / '+types.length+' 个业务看板。未返回的数据不会阻塞其他页面。';
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

async function loadSimpleOperation(){
  const title=document.getElementById('v624SimpleTitle');
  const body=document.getElementById('v624SimpleBody');
  const labels={
    tracking:'轨迹查询',
    exceptions:'异常明细',
    reports:'报表导出',
    settings:'系统设置',
    logs:'操作日志',
    'data-management':'数据管理'
  };
  title.textContent=labels[page]||'功能页面';
  body.textContent='该模块已经退出旧前端主路径。当前页面保持可操作，下一步继续迁移对应业务功能。';
  if(page==='logs'){
    try{
      const result=await json('/api/logs/recent',7000);
      body.textContent=JSON.stringify(result,null,2).slice(0,12000);
      body.style.whiteSpace='pre-wrap';
    }catch{}
  }
}

function reload(){
  if(page==='home')void loadHome();
  else if(business)void loadBusiness(business);
  else if(page==='import')void loadLatestImport();
  else void loadSimpleOperation();
}

document.getElementById('v624Reload')?.addEventListener('click',reload);

if(page==='home')void loadHome();
else if(business)void loadBusiness(business);
else if(page==='import')setupImport();
else void loadSimpleOperation();
})();