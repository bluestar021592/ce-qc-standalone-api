(function installDashboardCorrectnessV49(global){
  const VERSION='2026-08-11-v49-dashboard-correctness-ui-v2';
  const SPECIAL={
    ccslCnDiversion:'CCSLCN分流',
    ccslZtDiversion:'CCSLZT分流',
    ccsl580Retention:'580滞留包裹',
    ccsl580Diversion:'580滞留包裹',
    phnomPenhShop:'金边门店'
  };
  const LABEL_TAB={
    'CCSLCN分流':'ccslCnDiversion','CECN滞留包裹':'ccslCnDiversion',
    'CCSLZT分流':'ccslZtDiversion','CEZT滞留包裹':'ccslZtDiversion',
    '580滞留包裹':'ccsl580Retention','CCSL580分流':'ccsl580Retention','CCSL580滞留包裹':'ccsl580Retention',
    '金边门店':'phnomPenhShop'
  };
  let whppTrendTimer=null;
  let whppTrendKey='';

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  function range(){
    let from='',to='';
    try{from=String(dashboardPeriodRange?.fromDate||'');to=String(dashboardPeriodRange?.toDate||'');}catch{}
    from=from||document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||'';
    to=to||document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'';
    if(!to){try{to=String(historyModeDate||unifiedImportState?.reportDate||'');}catch{}}
    if(!from)from=to;
    return{from,to};
  }
  function exactBusinessType(type){
    const value=String(type||'').toUpperCase();
    if(value==='SHOPEE'){
      try{return shopeeRecipientGroup==='CN'?'SHOPEECN':shopeeRecipientGroup==='VN'?'SHOPEEVN':'SHOPEE';}catch{return'SHOPEE';}
    }
    if(value==='HOME')return'CCSL';
    return value||'CCSL';
  }
  function previewPanel(type){return String(type).startsWith('SHOPEE')?document.getElementById('shopeePreviewPanel'):document.getElementById('ccslPreviewPanel');}
  function columns(rows){
    const keys=['shipmentCode','businessType','reportDate','regionCode','recipient_raw','当前分类','primaryCategory','POD状态','Pending次数','pendingDays','OC天数','ocDays','最新节点','最新时间'];
    return keys.filter(key=>rows.some(row=>row?.[key]!==undefined)).slice(0,14);
  }
  function name(key){return({shipmentCode:'运单号',businessType:'业务',reportDate:'日报日期',regionCode:'区域',recipient_raw:'收件人',primaryCategory:'当前分类',pendingDays:'Pending天数',ocDays:'OC天数',最新节点:'最终/最新节点',最新时间:'最新时间'})[key]||key;}
  function renderSpecialDetail(panel,data,label){
    const rows=data.rows||[],cols=columns(rows),maxPage=Math.max(1,Math.ceil(Number(data.total||0)/Number(data.pageSize||200)));
    panel.innerHTML=`<div class="v27-detail-head"><div><h3>${esc(label)}</h3><div class="v27-detail-meta">${esc(data.fromDate)} ～ ${esc(data.toDate)} · 共 ${fmt(data.total)} 票 · 当前第 ${data.page}/${maxPage} 页</div></div></div><div class="v27-detail-scroll">${rows.length?`<table class="v27-detail-table"><thead><tr>${cols.map(k=>`<th>${esc(name(k))}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${cols.map(k=>`<td>${esc(row?.[k]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="empty-state">该指标当前没有匹配的逐票数据</div>'}</div>`;
  }
  async function openSpecial(type,tab,label){
    const businessType=exactBusinessType(type),r=range(),panel=previewPanel(businessType);if(!panel||!r.to)return;
    panel.classList.add('v27-detail-panel');
    panel.innerHTML=`<div class="v27-loading"><b>正在读取 ${esc(label)} 明细…</b></div>`;
    panel.scrollIntoView({behavior:'smooth',block:'start'});
    try{
      const params=new URLSearchParams({businessType,from:r.from,to:r.to,tab,page:'1',pageSize:'200'});
      const response=await fetch(`/api/v27/metric-detail?${params}`,{cache:'no-store',credentials:'same-origin'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);
      renderSpecialDetail(panel,data,label);
    }catch(error){panel.innerHTML=`<div class="empty-state">明细读取失败：${esc(error.message||error)}</div>`;}
  }

  function installMetricWrapper(){
    if(global.openV18MetricDetail?.__v49ExactDrilldown)return;
    const original=global.openV18MetricDetail;
    const wrapped=function(type,metricKey,label){
      const key=String(metricKey||''),text=String(label||'');
      const tab=SPECIAL[key]?key:LABEL_TAB[text];
      if(tab)return void openSpecial(type,tab,SPECIAL[tab]||text);
      if(text==='退件率'&&typeof original==='function')return original.call(this,type,metricKey,'退回率');
      return typeof original==='function'?original.apply(this,arguments):undefined;
    };
    wrapped.__v49ExactDrilldown=true;
    global.openV18MetricDetail=wrapped;
  }

  function renameShopeeReturnRate(model){
    if(!String(model?.businessType||'').toUpperCase().startsWith('SHOPEE'))return model;
    for(const row of [...(model.cards||[]),...(model.core||[])])if(String(row?.label||'')==='退回率')row.label='退件率';
    return model;
  }
  function renameVisibleShopeeReturnRate(){
    if(!['/shopeecn','/shopeevn'].includes(location.pathname))return;
    document.querySelectorAll('#shopeePage button span,#shopeePage h3').forEach(node=>{if(node.textContent?.trim()==='退回率')node.textContent='退件率';});
  }
  function installRenderWrapper(){
    if(!global.DashboardV18||global.DashboardV18.__v49ReturnRateWrapped)return;
    const original=global.DashboardV18.renderBusiness;
    global.DashboardV18.renderBusiness=function(root,model){
      const value=original.call(this,root,renameShopeeReturnRate(model));
      queueMicrotask(renameVisibleShopeeReturnRate);
      return value;
    };
    global.DashboardV18.__v49ReturnRateWrapped=true;
  }

  function series(name,color,values){return{name,color,values:(values||[]).map(v=>Number.isFinite(Number(v))?Number(v):null)};}
  function whppCharts(data){return[
    {title:'今日票数趋势',type:'count',dates:data.dates||[],series:[series('票数','#1677ff',data.ticket)]},
    {title:'POD率趋势',type:'rate',dates:data.dates||[],series:[series('POD率','#16a36a',data.podRate)]},
    {title:'OC率趋势',type:'rate',oc:true,dates:data.dates||[],series:[series('OC率','#ff8a00',data.ocRate)]},
    {title:'退件率趋势',type:'rate',dates:data.dates||[],series:[series('退件率','#6c4cf5',data.returnRate)]}
  ];}
  async function hydrateWhppTrends(){
    if(location.pathname!=='/whpp')return;
    const root=document.getElementById('shopeePage');if(!root||root.hidden)return;
    const cards=[...root.querySelectorAll('.v18-trend-section .v18-chart-card')];if(cards.length<4)return;
    const r=range(),to=r.to||document.querySelector('#shopeePage .v18-page-heading p')?.textContent?.match(/\d{4}-\d{2}-\d{2}/)?.[0]||'';if(!to)return;
    const key=`${to}:${cards.length}`;if(whppTrendKey===key&&cards[0]?.dataset.v49TrendReady==='1')return;
    whppTrendKey=key;cards[0].dataset.v49TrendReady='1';
    try{
      const response=await fetch(`/api/v49/whpp-trends?to=${encodeURIComponent(to)}`,{cache:'no-store',credentials:'same-origin'});
      const data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);
      whppCharts(data).forEach((chart,index)=>{if(cards[index]&&global.RateTrendCardV18)global.RateTrendCardV18.render(cards[index],chart);});
    }catch(error){console.warn('[CE-QC][V49][WHPP_TREND]',error);cards[0].dataset.v49TrendReady='0';}
  }
  function scheduleWhppTrends(){clearTimeout(whppTrendTimer);whppTrendTimer=setTimeout(()=>void hydrateWhppTrends(),100);}
  function installObserver(){
    const target=document.querySelector('.app-shell')||document.body;
    const observer=new MutationObserver(mutations=>{
      if(!mutations.some(m=>m.addedNodes?.length))return;
      if(location.pathname==='/whpp')scheduleWhppTrends();
      if(['/shopeecn','/shopeevn'].includes(location.pathname))renameVisibleShopeeReturnRate();
    });
    observer.observe(target,{subtree:true,childList:true});
    global.addEventListener('popstate',()=>{scheduleWhppTrends();renameVisibleShopeeReturnRate();});
    document.addEventListener('click',event=>{if(event.target?.closest?.('[data-page="whpp"],#topRangeQuery,.top-range-query'))setTimeout(scheduleWhppTrends,150);},true);
  }

  function install(){
    installRenderWrapper();
    setTimeout(installMetricWrapper,0);
    setTimeout(installMetricWrapper,500);
    setTimeout(renameVisibleShopeeReturnRate,100);
    installObserver();
    scheduleWhppTrends();
    console.info('[CE-QC][DASHBOARD_V49]',VERSION);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
