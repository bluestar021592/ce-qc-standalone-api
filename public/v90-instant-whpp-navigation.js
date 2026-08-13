(function installInstantWhppNavigationV90(global){
  if(global.__CE_QC_V90_INSTANT_WHPP_NAV__)return;
  const VERSION='2026-08-13-v90-instant-whpp-navigation-v1';
  const SUMMARY_CACHE_KEY='ce_qc_v89_instant_dashboard';
  let lastSummary=readSummary();
  let navigating=false;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const pct=value=>`${Number(value||0).toFixed(2).replace(/\.00$/,'')}%`;
  const share=(value,total)=>`占本业务 ${total?(Number(value||0)*100/Number(total)).toFixed(2):'0.00'}%`;

  function readSummary(){
    try{return JSON.parse(localStorage.getItem(SUMMARY_CACHE_KEY)||'null');}catch{return null;}
  }
  function selectedDate(){
    const dom=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(dom))return dom;
    try{
      const date=String(unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate||'').slice(0,10);
      if(/^\d{4}-\d{2}-\d{2}$/.test(date))return date;
    }catch{}
    return '';
  }
  function summaryForDate(date){
    const current=lastSummary||readSummary();
    return current&&(!date||current.reportDate===date)?current:null;
  }
  function ensureNav(){
    const nav=document.querySelector('.side-nav');if(!nav)return;
    let button=nav.querySelector('[data-page="whpp"]');
    if(!button){
      button=document.createElement('button');
      button.className='side-link';button.dataset.page='whpp';button.dataset.path='/whpp';
      button.innerHTML='<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-package"></use></svg><span class="side-label">WHPP本土看板</span>';
      const anchor=nav.querySelector('[data-page="ali1688"]');
      if(anchor?.nextSibling)nav.insertBefore(button,anchor.nextSibling);else nav.appendChild(button);
    }
  }
  function host(){return document.getElementById('shopeePage')||document.querySelector('main.main-content .app-page');}
  function forceWhppVisibility(){
    if(location.pathname!=='/whpp')return;
    ensureNav();
    const target=host();if(!target)return;
    document.querySelectorAll('.app-page').forEach(node=>{node.hidden=node!==target;node.classList.toggle('active',node===target);});
    document.querySelectorAll('.side-link').forEach(node=>node.classList.toggle('active',node.dataset.page==='whpp'));
    const title=document.getElementById('pageTitle');if(title)title.textContent='WHPP本土看板';
  }
  function metricCard(label,value,unit,total,key){
    return `<button class="v18-metric-card" onclick="window.openWhppDetailV44?.('${esc(key)}')"><i aria-hidden="true">●</i><span>${esc(label)}</span><b>${unit==='%'?pct(value):fmt(value)}</b><small>${unit==='%'?`当前比率 ${pct(value)}`:share(value,total)}</small></button>`;
  }
  function topCard(label,value,unit,total,key,tone='blue'){
    return `<button class="v18-business-card ${tone}" onclick="window.openWhppDetailV44?.('${esc(key)}')"><span>${esc(label)}</span><small>${unit==='%'?'当前比率':'今日票数'}</small><b>${unit==='%'?pct(value):fmt(value)}</b><em>${label==='WHPP本土'?'占本业务 100.00%':share(value,total)}</em></button>`;
  }
  function renderInstant(status='正在读取最新WHPP数据…'){
    if(location.pathname!=='/whpp')return;
    const date=selectedDate();
    const payload=summaryForDate(date);
    const source=payload?.whppSummary?.metrics||{};
    const hasData=Boolean(payload?.whppSummary&&(!date||payload.reportDate===date));
    const total=Number(source.total??payload?.counts?.WHPP??0);
    const metrics={
      total,
      pod:Number(source.pod||0),podRate:Number(source.podRate||0),
      returned:Number(source.returned||0),returnRate:Number(source.returnRate||0),
      cancelled:Number(source.cancelled||0),cancelRate:Number(source.cancelRate||0),
      unresolved:Number(source.unresolved||0),pendingNonContinuous:Number(source.pendingNonContinuous||0),
      pending1:Number(source.pending1||0),pending2:Number(source.pending2||0),pending3:Number(source.pending3||0),
      oc1:Number(source.oc1||0),oc2:Number(source.oc2||0),oc3:Number(source.oc3||0),
      cycle2:Number(source.cycle2||0),inboundNoScan:Number(source.inboundNoScan||0),
      delivery:Number(source.delivery||0),workOrder:Number(source.workOrder||0)
    };
    const target=host();if(!target)return;
    const top=[
      ['WHPP本土',metrics.total,'件','all','purple'],['今日POD',metrics.pod,'件','pod','blue'],['POD率',metrics.podRate,'%','pod','blue'],
      ['已退回件',metrics.returned,'件','returned','blue'],['订单取消',metrics.cancelled,'件','cancelled','blue'],['当前未闭环',metrics.unresolved,'件','unresolved','blue']
    ];
    const core=[
      ['Pending不连续',metrics.pendingNonContinuous,'件','pendingNonContinuous'],['Pending1+',metrics.pending1,'件','pending1'],['Pending2+',metrics.pending2,'件','pending2'],['Pending3+',metrics.pending3,'件','pending3'],
      ['OC1+',metrics.oc1,'件','oc1'],['OC2+',metrics.oc2,'件','oc2'],['OC3+',metrics.oc3,'件','oc3'],['盘点2天+',metrics.cycle2,'件','cycle2'],['入库无扫描',metrics.inboundNoScan,'件','inboundNoScan'],
      ['已退回件',metrics.returned,'件','returned'],['退回率',metrics.returnRate,'%','returned'],['订单取消',metrics.cancelled,'件','cancelled'],['取消率',metrics.cancelRate,'%','cancelled'],
      ['当前未闭环',metrics.unresolved,'件','unresolved'],['派送中',metrics.delivery,'件','delivery']
    ];
    target.className='app-page v18-dashboard-page v18-business-page';
    target.innerHTML=`<section class="v18-page-heading"><div><h2>WHPP本土看板</h2><p>日报 ${esc(date||payload?.reportDate||'—')} · ${esc(hasData?'已先显示本机最近验证数据，后台正在校验最新值':status)}</p></div></section>
      <section class="v18-business-grid">${top.map(([label,value,unit,key,tone])=>topCard(label,value,unit,total,key,tone)).join('')}</section>
      <section class="v18-panel v18-core"><h2>核心指标</h2><div class="v18-core-grid">${core.map(([label,value,unit,key])=>metricCard(label,value,unit,total,key)).join('')}</div></section>
      <section class="v18-panel"><h2>区域与趋势</h2><div class="empty-state">WHPP页面已切换完成；区域/趋势数据正在后台更新，不再保留上一页SHOPEE内容。</div></section>
      <section id="whppPreviewPanel" class="panel v18-detail-preview" aria-live="polite"><div class="empty-state">点击上方指标查看对应明细</div></section>`;
    forceWhppVisibility();
  }

  async function refreshTinySummary(date){
    try{
      const api=global.__CE_QC_V89_FAST_DASHBOARD__?.fetchSummary;
      if(typeof api!=='function')return null;
      const payload=await api(date||selectedDate());
      if(payload){lastSummary=payload;renderInstant('WHPP最新摘要已更新');}
      return payload;
    }catch(error){console.warn('[CE-QC][V90_WHPP] tiny summary skipped',error);return null;}
  }

  function setCurrentPage(){try{currentPage='whpp';}catch{}}
  function beginWhppNavigation(push=true){
    if(navigating)return;
    navigating=true;
    try{
      setCurrentPage();
      if(push&&location.pathname!=='/whpp')history.pushState({page:'whpp'},'', '/whpp');
      renderInstant();
      const date=selectedDate();
      void refreshTinySummary(date);
      // The legacy WHPP reader still fills region/trend/detail-compatible fields in
      // the background, but it is no longer allowed to delay the visible route switch.
      setTimeout(()=>{
        if(location.pathname==='/whpp'&&typeof global.navigateWhppPage==='function'){
          Promise.resolve(global.navigateWhppPage(date)).catch(error=>console.warn('[CE-QC][V90_WHPP] full refresh skipped',error));
        }
      },250);
    }finally{setTimeout(()=>{navigating=false;},30);}
  }

  const oldRenderAll=global.renderAll;
  if(typeof oldRenderAll==='function'&&!oldRenderAll.__v90WhppWrapped){
    const wrapped=function(){
      const result=oldRenderAll.apply(this,arguments);
      if(location.pathname==='/whpp')queueMicrotask(()=>renderInstant());
      return result;
    };
    wrapped.__v90WhppWrapped=true;
    global.renderAll=wrapped;
  }

  // Capture before WHPP V44's target onclick so the old SHOPEE DOM can never stay
  // visible while an async WHPP request is pending.
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('.side-link[data-page="whpp"]');
    if(!button)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    beginWhppNavigation(true);
  },true);

  global.addEventListener('popstate',()=>{
    if(location.pathname==='/whpp')beginWhppNavigation(false);
  });
  global.addEventListener('ce-qc-startup-truth-ready',()=>{
    if(location.pathname==='/whpp')void refreshTinySummary(selectedDate());
  });

  ensureNav();
  if(location.pathname==='/whpp')beginWhppNavigation(false);
  global.__CE_QC_V90_INSTANT_WHPP_NAV__={version:VERSION,navigate:beginWhppNavigation,render:renderInstant};
  console.info('[CE-QC][V90_INSTANT_WHPP_NAV]',VERSION);
})(window);
