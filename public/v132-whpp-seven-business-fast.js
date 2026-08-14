(function installWhppSevenBusinessFastV132(global){
  if(global.__CE_QC_V132_WHPP_FAST__)return;
  const VERSION='2026-08-14-v132-whpp-seven-business-fast-v1';
  const CACHE_KEY='ce_qc_v132_whpp_fast_summary';
  let busy=false;
  let currentSummary=readCache();

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const pct=value=>`${Number(value||0).toFixed(2).replace(/\.00$/,'')}%`;
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  function readCache(){try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'null');}catch{return null;}}
  function saveCache(value){try{localStorage.setItem(CACHE_KEY,JSON.stringify(value));}catch{}}
  function selectedDate(){
    const dom=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(dom))return dom;
    try{const value=String(unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;}catch{}
    return String(currentSummary?.reportDate||'').slice(0,10);
  }
  async function jsonFetch(url,options={}){
    const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});
    const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{}
    if(!response.ok||payload?.ok===false){const error=new Error(payload.error||payload.message||`HTTP ${response.status}`);error.status=response.status;error.code=payload.code||`HTTP_${response.status}`;error.payload=payload;throw error;}
    return payload;
  }
  async function fetchFast(date=''){
    const query=date?`?reportDate=${encodeURIComponent(date)}`:'';
    const payload=await jsonFetch(`/api/v132/whpp-fast-summary${query}`);
    currentSummary=payload;saveCache(payload);return payload;
  }

  function ensureNav(){
    const nav=document.querySelector('.side-nav');if(!nav)return;
    let button=nav.querySelector('[data-page="whpp"]');
    if(!button){button=document.createElement('button');button.className='side-link';button.dataset.page='whpp';button.dataset.path='/whpp';button.innerHTML='<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-package"></use></svg><span class="side-label">WHPP本土看板</span>';const anchor=nav.querySelector('[data-page="ali1688"]');if(anchor?.nextSibling)nav.insertBefore(button,anchor.nextSibling);else nav.appendChild(button);}
  }
  function ensurePage(){
    let page=document.getElementById('whppFastPage');
    if(page)return page;
    page=document.createElement('section');page.id='whppFastPage';page.className='app-page v18-dashboard-page v18-business-page';page.hidden=true;
    document.querySelector('main.main-content')?.appendChild(page);return page;
  }
  function activatePage(push=true){
    ensureNav();const page=ensurePage();
    document.querySelectorAll('.app-page').forEach(node=>{node.hidden=node!==page;node.classList.toggle('active',node===page);});
    document.querySelectorAll('.side-link').forEach(node=>node.classList.toggle('active',node.dataset.page==='whpp'));
    const title=document.getElementById('pageTitle');if(title)title.textContent='WHPP本土看板';
    try{currentPage='whpp';}catch{}
    if(push&&location.pathname!=='/whpp')history.pushState({page:'whpp'},'', '/whpp');
    return page;
  }
  function share(value,total){return `占本业务 ${total?(Number(value||0)*100/Number(total)).toFixed(2):'0.00'}%`;}
  function topCard(label,value,unit,total,key,tone='blue'){
    const display=unit==='%'?pct(value):fmt(value);
    return `<button class="v18-business-card ${tone}" onclick="window.openWhppV132Detail('${esc(key)}')"><span>${esc(label)}</span><small>${unit==='%'?'当前比率':'今日票数'}</small><b>${display}</b><em>${label==='WHPP本土'?'占本业务 100.00%':unit==='%'?`当前比率 ${display}`:share(value,total)}</em></button>`;
  }
  function metric(label,value,total,key,unit='件'){
    return `<button class="v18-metric-card" onclick="window.openWhppV132Detail('${esc(key)}')"><i aria-hidden="true">●</i><span>${esc(label)}</span><b>${unit==='%'?pct(value):fmt(value)}</b><small>${unit==='%'?`当前比率 ${pct(value)}`:share(value,total)}</small></button>`;
  }
  function regionBlock(label,row={}){
    const items=[['今日件数',row.total],['签收率',pct(row.podRate)],['签收件数',row.pod],['Pending1+',row.pending1],['Pending2+',row.pending2],['Pending3+',row.pending3],['OC1+',row.oc1],['OC2+',row.oc2],['OC3+',row.oc3],['已退回件',row.returned],['当前未闭环',row.unresolved]];
    return `<section class="region-block"><h4>${esc(label)}</h4><div>${items.map(([name,value])=>`<button type="button"><span>${esc(name)}</span><b>${typeof value==='string'?esc(value):fmt(value)}</b></button>`).join('')}</div></section>`;
  }
  function render(payload=currentSummary,note=''){
    const page=activatePage(false);if(!page)return;
    const data=payload||{};const m=data.metrics||{};const regions=data.regions||{};const total=Number(m.total||data.total||0);const completed=Boolean(data.completed||data.snapshotStatus==='COMPLETED');
    const statusText=completed
      ? `日报 ${esc(data.reportDate||selectedDate()||'—')} · 已完成WHPP独立扫描/轨迹/闭环快照${data.cacheHit?' · 快速缓存命中':''}`
      : total>0
        ? `日报 ${esc(data.reportDate||selectedDate()||'—')} · WHPP日报已分类但尚未完成独立扫描/轨迹。当前“未闭环”只是待处理占位，不代表${fmt(total)}票真实全部未闭环。`
        : `日报 ${esc(data.reportDate||selectedDate()||'—')} · 当前无WHPP本土数据`;
    const top=[['WHPP本土',total,'件','all','purple'],['今日POD',m.pod,'件','pod','blue'],['POD率',m.podRate,'%','pod','blue'],['已退回件',m.returned,'件','returned','blue'],['订单取消',m.cancelled,'件','cancelled','blue'],['当前未闭环',m.unresolved,'件','unresolved','blue']];
    const core=[['Pending不连续',m.pendingNonContinuous,'pendingNonContinuous'],['Pending1+',m.pending1,'pending1'],['Pending2+',m.pending2,'pending2'],['Pending3+',m.pending3,'pending3'],['OC1+',m.oc1,'oc1'],['OC2+',m.oc2,'oc2'],['OC3+',m.oc3,'oc3'],['盘点2天+',m.cycle2,'cycle2'],['入库无扫描',m.inboundNoScan,'inboundNoScan'],['已退回件',m.returned,'returned'],['当前未闭环',m.unresolved,'unresolved'],['派送中',m.delivery,'delivery'],['CCSLCN',m.ccslCnDiversion,'ccslCnDiversion'],['CEZT',m.ccslZtDiversion,'ccslZtDiversion'],['CCSL580',m.ccsl580Retention,'ccsl580Retention'],['金边门店',m.phnomPenhShop,'phnomPenhShop'],['外省门店',m.provinceShop,'provinceShop']];
    page.innerHTML=`<section class="v18-page-heading"><div><h2>WHPP本土看板</h2><p>${statusText}</p></div>${!completed&&total>0?'<div><button class="btn primary" type="button" onclick="window.runUnified()">继续七业务处理</button></div>':''}</section>
      ${note?`<div class="processing-notice running"><b>状态</b><span>${esc(note)}</span></div>`:''}
      <section class="v18-business-grid">${top.map(args=>topCard(...args,total)).join('')}</section>
      <section class="v18-panel v18-core"><h2>核心指标</h2><div class="v18-core-grid">${core.map(([label,value,key])=>metric(label,value,total,key)).join('')}</div></section>
      <section class="v18-panel"><h2>区域</h2><div class="region-summary-grid">${regionBlock('本省（PP）',regions.PP||{})}${regionBlock('外省（PV）',regions.PV||{})}</div></section>
      <section id="whppV132Detail" class="panel v18-detail-preview"><div class="empty-state">点击上方指标查看对应明细</div></section>`;
  }
  async function navigate(push=true){
    activatePage(push);const date=selectedDate();const cached=currentSummary&&(!date||currentSummary.reportDate===date)?currentSummary:null;
    if(cached)render(cached,'正在后台校验最新WHPP摘要…');else{const page=ensurePage();page.innerHTML='<div class="empty-state">正在读取WHPP轻量摘要…</div>';}
    try{render(await fetchFast(date));}catch(error){if(cached)render(cached,`最新摘要读取失败：${error.message}`);else ensurePage().innerHTML=`<div class="empty-state">WHPP读取失败：${esc(error.message)}</div>`;}
  }

  async function openDetail(tab){
    const host=document.getElementById('whppV132Detail');if(!host)return;
    host.innerHTML='<div class="empty-state">正在读取对应明细…</div>';
    try{
      const date=String(currentSummary?.reportDate||selectedDate()||'');
      const payload=await jsonFetch(`/api/whpp/metric-detail?reportDate=${encodeURIComponent(date)}&tab=${encodeURIComponent(tab)}&page=1&pageSize=200`);
      const rows=Array.isArray(payload.rows)?payload.rows:[];const fields=['shipmentCode','regionCode','primaryCategory','currentState','POD状态','退回状态','Pending当前次数','OC天数','latestEventTime','最后节点'];
      host.innerHTML=rows.length?`<div class="panel-title"><h3>${esc(payload.label||tab)}</h3><span>${fmt(payload.total)}票</span></div><div class="preview-table-wrap"><table class="preview-table"><thead><tr>${fields.map(f=>`<th>${esc(f)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${fields.map(f=>`<td>${esc(row?.[f]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">当前指标暂无明细</div>';
    }catch(error){host.innerHTML=`<div class="empty-state">明细读取失败：${esc(error.message)}</div>`;}
  }

  function runStatus(text,level='warning'){
    const node=document.getElementById('ccslRunStatus');if(node)node.innerHTML=`<span class="status-pill ${level}">${esc(text)}</span>`;
  }
  function setBusy(value){busy=Boolean(value);const button=document.querySelector('[data-testid="global-auto-process"]');if(button){button.disabled=busy;button.textContent=busy?'七业务处理中…':'开始全自动处理';}}
  async function waitForWhpp(maxMs=300000){
    const deadline=Date.now()+maxMs;
    while(Date.now()<deadline){
      const summary=await fetchFast(selectedDate()).catch(()=>null);if(summary?.completed||summary?.snapshotStatus==='COMPLETED')return summary;
      const progress=await jsonFetch('/api/whpp/progress').catch(()=>null);
      if(!progress?.processing?.running)return summary;
      runStatus(`WHPP本土处理中：${progress.processing?.phase||'扫描/轨迹'}，等待最终快照…`);
      await wait(1200);
    }
    throw new Error('WHPP处理仍在后台执行，尚未生成最终快照');
  }
  async function ensureWhppCompleted(){
    let summary=await fetchFast(selectedDate());
    if(Number(summary.total||0)<=0||summary.completed||summary.snapshotStatus==='COMPLETED')return {ok:true,skipped:Number(summary.total||0)<=0,summary};
    for(let attempt=0;attempt<2;attempt+=1){
      const progress=await jsonFetch('/api/whpp/progress').catch(()=>null);
      if(progress?.processing?.running){summary=await waitForWhpp();if(summary?.completed)return {ok:true,summary};continue;}
      runStatus(`WHPP本土尚未闭环，正在${attempt?'继续断点':'启动'}扫描/轨迹处理…`);
      try{await jsonFetch(attempt?'/api/whpp/run/resume':'/api/whpp/run/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}catch(error){
        if(error.code==='WHPP_RUN_ALREADY_ACTIVE'){summary=await waitForWhpp();if(summary?.completed)return {ok:true,summary};continue;}
        if(error.code==='WHPP_PARTIAL_API_FAILURE'&&attempt===0)continue;
        throw error;
      }
      summary=await fetchFast(selectedDate());if(summary.completed||summary.snapshotStatus==='COMPLETED')return {ok:true,summary};
    }
    summary=await fetchFast(selectedDate());
    if(summary.completed||summary.snapshotStatus==='COMPLETED')return {ok:true,summary};
    throw new Error(`WHPP ${fmt(summary.total)}票仍未生成最终快照，系统不会把它误报为七业务处理完成`);
  }
  async function runSeven(mode='start'){
    if(busy)return;
    setBusy(true);runStatus('正在启动七业务处理，请勿重复点击');
    try{
      const base=global.__CE_QC_V67_RESILIENT_RUN_GUARD__?.run;
      let baseResult={ok:true,results:[]};
      if(typeof base==='function')baseResult=await base(mode);
      else throw new Error('七业务基础处理器尚未就绪，请刷新页面后重试');
      const whpp=await ensureWhppCompleted();
      const failed=(baseResult?.results||[]).filter(item=>item?.ok===false&&!/WHPP/i.test(String(item?.label||'')));
      if(failed.length){runStatus(`WHPP已完成，但${failed.map(item=>item.label).join('、')}仍有待重试批次。`,'warning');}
      else runStatus('七业务处理完成：WHPP最终快照已验证。','success');
      document.dispatchEvent(new CustomEvent('ce-qc-run-complete',{detail:{...(baseResult||{}),whppVerified:true}}));
      try{if(typeof global.refresh==='function')await global.refresh();}catch{}
      if(location.pathname==='/whpp')render(whpp.summary);
      return {ok:failed.length===0,baseResult,whpp};
    }catch(error){runStatus(`七业务处理未完成：${error.message}`,'danger');if(location.pathname==='/whpp'){try{render(await fetchFast(selectedDate()),error.message);}catch{}}return {ok:false,error:error.message};}
    finally{setBusy(false);}
  }

  function install(){
    ensureNav();
    global.navigateWhppPage=()=>navigate(true);
    global.openWhppV132Detail=tab=>openDetail(tab);
    global.runUnified=()=>runSeven('start');
    global.resumeUnified=()=>runSeven('resume');
    document.addEventListener('click',event=>{
      const whpp=event.target?.closest?.('.side-link[data-page="whpp"]');
      if(whpp){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void navigate(true);return;}
      const button=event.target?.closest?.('button');if(!button)return;
      const inline=String(button.getAttribute('onclick')||'');
      if(button.matches('[data-testid="global-auto-process"]')||/\b(?:runUnified|resumeUnified)\s*\(/.test(inline)){
        event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void runSeven(/resumeUnified/.test(inline)?'resume':'start');
      }
    },true);
    global.addEventListener('popstate',()=>{if(location.pathname==='/whpp')void navigate(false);});
    document.addEventListener('ce-qc-run-complete',()=>{void fetchFast(selectedDate()).then(value=>{if(location.pathname==='/whpp')render(value);}).catch(()=>{});});
    if(location.pathname==='/whpp')void navigate(false);
    global.__CE_QC_V132_WHPP_FAST__={version:VERSION,navigate,run:runSeven,fetchSummary:fetchFast,ensureWhppCompleted};
    console.info('[CE-QC][V132_WHPP_SEVEN_BUSINESS_FAST]',VERSION);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,20),{once:true});else setTimeout(install,20);
})(window);
