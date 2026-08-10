(function installV27DashboardFix(global){
  if (new URLSearchParams(location.search).has('visualTest')) return;
  const cache=new Map();
  let detailContext=null;
  let carryStatus='OPEN';
  let carryTimer=null;

  const css=document.createElement('style');
  css.textContent=`
    .v27-loading{padding:36px;text-align:center;color:#6b7f9b}.v27-loading b{color:#1677ff}
    .v27-detail-panel{margin-top:16px}.v27-detail-head{display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid #e4edf8}.v27-detail-head h3{margin:0;color:#0b315b}.v27-detail-meta{font-size:13px;color:#7187a4}
    .v27-detail-table{width:100%;border-collapse:collapse;font-size:13px}.v27-detail-table th,.v27-detail-table td{padding:10px 12px;border-bottom:1px solid #e8eff8;text-align:left;white-space:nowrap}.v27-detail-table th{background:#f5f9ff;color:#244d78;position:sticky;top:0}.v27-detail-scroll{overflow:auto;max-height:560px}.v27-detail-pager{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px}.v27-detail-pager button{border:1px solid #c9daf0;background:white;border-radius:6px;padding:6px 12px;cursor:pointer}.v27-detail-pager button:disabled{opacity:.4}
    .v27-clickable{cursor:pointer!important}.v27-clickable:hover{outline:2px solid rgba(22,119,255,.22);outline-offset:2px;border-radius:6px}.v27-attempt-section{margin-top:14px}.v27-attempt-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.v27-attempt-grid.single{grid-template-columns:1fr}.v27-attempt-card{min-height:300px;background:#fff;border:1px solid #dbe7f5;border-radius:9px;padding:10px}
    .v27-carry-toolbar{display:flex;gap:8px;align-items:center;margin-bottom:14px}.v27-carry-toolbar button{border:1px solid #c7d9ee;background:#fff;border-radius:6px;padding:8px 14px;cursor:pointer}.v27-carry-toolbar button.active{background:#1677ff;color:#fff;border-color:#1677ff}.v27-carry-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}.v27-carry-summary article{background:#fff;border:1px solid #dbe7f5;border-radius:8px;padding:15px}.v27-carry-summary span{color:#7085a0}.v27-carry-summary b{display:block;font-size:25px;color:#0b315b;margin-top:6px}.v27-new-node{color:#0a9f5a;font-weight:700}.v27-stale{color:#e45959;font-weight:700}.v27-carry-page .panel{overflow:hidden}
    @media(max-width:900px){.v27-attempt-grid,.v27-carry-summary{grid-template-columns:1fr 1fr}}
  `;
  document.head.appendChild(css);

  function esc(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
  function fmt(value){return Number(value||0).toLocaleString('zh-CN');}
  function normalizeRatioText(model){
    for(const item of [...(model?.cards||[]),...(model?.core||[])]){
      const label=String(item?.label||'');
      if(item?.unit==='%'||/(率|百分比)$/.test(label)){
        const value=Number(item?.value||0);
        item.ratio=`当前比率 ${Number.isFinite(value)?value.toFixed(2):'0.00'}%`;
      }
    }
    return model;
  }
  function currentRange(){
    try{
      if(typeof dashboardPeriodRange!=='undefined'&&dashboardPeriodRange?.fromDate&&dashboardPeriodRange?.toDate) return {from:dashboardPeriodRange.fromDate,to:dashboardPeriodRange.toDate};
    }catch{}
    const from=document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value;
    const to=document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value;
    if(from&&to&&from<=to) return {from,to};
    let date='';
    try{date=historyModeDate||unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate||'';}catch{}
    return {from:date,to:date};
  }
  function localTab(type,label,metricKey){
    try{if(typeof tabForMetric==='function') return tabForMetric(type.startsWith('SHOPEE')?'SHOPEE':'CCSL',label||metricKey);}catch{}
    const sh={'已退回件':'returned','退回率':'returned','当前未闭环':'unresolved','Pending不连续':'pendingNonContinuous','Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3','OC1+':'oc1','OC2+':'oc2','OC3+':'oc3','入库无扫描':'inboundNoScan','派送中':'deliveryStay','外省派送中':'pvDelivery','外省门店滞留':'pvStoreRetention'};
    const cc={'签收件数':'podClosed','已退回件':'accountingReturned','当前未闭环':'accountingOpen','Pending1+':'pendingAll','Pending2+':'pending2plus','Pending3+':'pending3','OC1+':'ocAll','OC2+':'oc2plus','OC3+':'oc3','入库无扫描':'inboundNoScan','入库无扫描节点':'inboundNoScan','工单未处理':'workOrderAbnormal','严重异常':'severeAbnormal'};
    return (type.startsWith('SHOPEE')?sh:cc)[label]||(type.startsWith('SHOPEE')?'all':'allData');
  }
  function exactType(type){
    const raw=String(type||'').toUpperCase();
    if(raw==='HOME') return 'CCSL';
    if(raw==='SHOPEE'){
      try{return shopeeRecipientGroup==='CN'?'SHOPEECN':shopeeRecipientGroup==='VN'?'SHOPEEVN':'SHOPEE';}catch{return 'SHOPEE';}
    }
    return raw||'CCSL';
  }
  function panelForContext(type){
    if(String(currentPage)==='home'){
      let panel=document.getElementById('v27HomeDetailPanel');
      if(!panel){
        panel=document.createElement('section');panel.id='v27HomeDetailPanel';panel.className='v18-panel v27-detail-panel';
        (document.querySelector('#homePage .v18-trend-section')||document.getElementById('homePage'))?.insertAdjacentElement('afterend',panel);
        if(!panel.isConnected) document.getElementById('homePage')?.appendChild(panel);
      }
      return panel;
    }
    return document.getElementById(String(type).startsWith('SHOPEE')?'shopeePreviewPanel':'ccslPreviewPanel');
  }
  function detailColumns(rows){
    const preferred=['shipmentCode','businessType','reportDate','regionCode','recipient_raw','customerName','当前分类','primaryCategory','POD状态','Pending次数','pendingDays','OC天数','ocDays','最新节点','lastEventDesc','最新时间','lastEventTime'];
    const available=[];
    for(const key of preferred){if(rows.some(r=>r?.[key]!==undefined)&&!available.includes(key)) available.push(key);}
    return available.slice(0,12);
  }
  function displayName(key){return ({shipmentCode:'运单号',businessType:'业务',reportDate:'日报日期',regionCode:'区域',recipient_raw:'收件人',customerName:'收件人',primaryCategory:'当前分类',pendingDays:'Pending天数',ocDays:'OC天数',lastEventDesc:'最新节点',lastEventTime:'最新时间'})[key]||key;}
  function renderDetail(panel,data,label){
    const rows=data.rows||[], cols=detailColumns(rows), maxPage=Math.max(1,Math.ceil(Number(data.total||0)/Number(data.pageSize||200)));
    panel.innerHTML=`<div class="v27-detail-head"><div><h3>${esc(label||'指标明细')}</h3><div class="v27-detail-meta">${esc(data.fromDate)} ～ ${esc(data.toDate)} · 共 ${fmt(data.total)} 票 · 当前第 ${data.page}/${maxPage} 页</div></div><button class="text-button" onclick="this.closest('.v27-detail-panel').scrollIntoView({behavior:'smooth'})">已加载</button></div>
      <div class="v27-detail-scroll">${rows.length?`<table class="v27-detail-table"><thead><tr>${cols.map(k=>`<th>${esc(displayName(k))}</th>`).join('')}<th>操作</th></tr></thead><tbody>${rows.map(row=>`<tr>${cols.map(k=>`<td>${esc(row[k]??'—')}</td>`).join('')}<td><button class="text-button" data-v27row="${encodeURIComponent(JSON.stringify({shipmentCode:row.shipmentCode,businessType:row.businessType,reportDate:row.reportDate,region:row.regionCode,category:row.primaryCategory||row.当前分类||''}))}" onclick="window.v27OpenTracking(this.dataset.v27row)">查看轨迹</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">该指标当前没有匹配的逐票数据</div>'}</div>
      <div class="v27-detail-pager"><button ${data.page<=1?'disabled':''} onclick="window.v27DetailPage(${data.page-1})">上一页</button><button ${data.page>=maxPage?'disabled':''} onclick="window.v27DetailPage(${data.page+1})">下一页</button></div>`;
  }
  async function loadDetail(ctx,page=1){
    const panel=ctx.panel||panelForContext(ctx.businessType);if(!panel)return;
    panel.classList.add('v27-detail-panel');
    panel.innerHTML=`<div class="v27-loading"><b>正在读取 ${esc(ctx.label)} 明细…</b><br>只查询当前指标，不重新加载整个看板。</div>`;
    panel.scrollIntoView({behavior:'smooth',block:'start'});
    const range=currentRange();
    const params=new URLSearchParams({businessType:ctx.businessType,from:range.from,to:range.to,tab:ctx.tab,page:String(page),pageSize:'200'});
    if(ctx.region)params.set('region',ctx.region);if(ctx.attempt)params.set('attempt',String(ctx.attempt));
    try{
      const data=await api(`/api/v27/metric-detail?${params}`);detailContext={...ctx,page};renderDetail(panel,data,ctx.label);
    }catch(error){panel.innerHTML=`<div class="empty-state">明细读取失败：${esc(error.message)}</div>`;}
  }
  function openDetail(type,metricKey,label,extra={}){
    const businessType=exactType(type), tab=extra.tab||localTab(businessType,label,metricKey);
    void loadDetail({businessType,tab,label:label||metricKey||'指标明细',region:extra.region||'',attempt:extra.attempt||0,panel:extra.panel||null},1);
  }
  global.v27DetailPage=page=>{if(detailContext)void loadDetail(detailContext,Math.max(1,page));};
  global.v27OpenTracking=encoded=>{try{const row=JSON.parse(decodeURIComponent(encoded));if(typeof openTrackingDrawer==='function')openTrackingDrawer(row);}catch(error){console.warn(error);}};
  global.openV18MetricDetail=function(type,metricKey,label){openDetail(type,metricKey,label);};
  try{openMetricDetail=function(type,tab){const businessType=exactType(type);openDetail(businessType,tab,tab,{tab});};}catch{}

  function wireShopeeSpecial(){
    document.querySelectorAll('.v18-special-grid>div').forEach(block=>{
      const title=block.querySelector('h3')?.textContent||'';
      const tab=title.includes('Pending')?'pendingNonContinuous':title.includes('退回')?'returned':'';
      if(!tab)return;
      block.querySelectorAll('span').forEach(span=>{
        const group=/\bCN\b/.test(span.textContent)?'CN':/\bVN\b/.test(span.textContent)?'VN':'';if(!group)return;
        span.classList.add('v27-clickable');span.title='点击查看对应明细';span.onclick=()=>openDetail(group==='CN'?'SHOPEECN':'SHOPEEVN',tab,title,{tab});
      });
    });
    document.querySelectorAll('.v18-dispatch-grid>div').forEach(groupNode=>{
      const groupLabel=groupNode.querySelector('h3')?.textContent||'';const group=groupLabel.startsWith('CN')?'CN':groupLabel.startsWith('VN')?'VN':'';const region=groupLabel.endsWith('PV')?'PV':groupLabel.endsWith('PP')?'PP':'';
      if(!group)return;
      groupNode.querySelectorAll('span').forEach((span,index)=>{span.classList.add('v27-clickable');span.title=`点击查看${groupLabel} ${index+1}派明细`;span.onclick=()=>openDetail(group==='CN'?'SHOPEECN':'SHOPEEVN',`attempt${index+1}`,`${groupLabel} ${index+1}派`,{tab:'all',region,attempt:index+1});});
    });
  }
  function series(name,color,values,numerators=[],denominators=[]){return{name,color,values:(values||[]).map(v=>Number.isFinite(Number(v))?Number(v):null),numerators,denominators};}
  async function getTrends(type){
    const range=currentRange();if(!range.from||!range.to)return null;const key=`${type}:${range.from}:${range.to}`;if(cache.has(key))return cache.get(key);
    const promise=api(`/api/v27/trends?businessType=${encodeURIComponent(type)}&from=${range.from}&to=${range.to}`).catch(()=>null);cache.set(key,promise);return promise;
  }
  function genericCharts(data){
    if(!data)return[];return[
      {title:'今日票数趋势',type:'count',dates:data.dates,series:[series('票数','#1677ff',data.ticket)]},
      {title:'POD率趋势',type:'rate',dates:data.dates,series:[series('POD率','#16a36a',data.podRate)]},
      {title:'OC率趋势',type:'rate',oc:true,dates:data.dates,series:[series('OC率','#ff8a00',data.ocRate)]},
      {title:'首次妥投率趋势',type:'rate',dates:data.dates,series:[series('首次妥投率','#6c4cf5',data.firstRate)]}
    ];
  }
  function attemptChart(data,label){return{title:`${label} 1/2/3派成功率趋势`,type:'rate',dates:data.dates,series:[series('1派','#1677ff',data.attempt1,data.attempt1Count,data.attemptDenominator),series('2派','#16a36a',data.attempt2,data.attempt2Count,data.attemptDenominator),series('3派','#ff8a00',data.attempt3,data.attempt3Count,data.attemptDenominator)]};}
  async function enrichHome(){
    // Attempt trends are owned exclusively by v27-trend-mount-fix.js.
    // Keeping a second mount here created duplicate 1/2/3 panels on every Shopee page.
    wireShopeeSpecial();
  }
  async function enrichBusiness(model){
    const root=String(model.businessType||'').startsWith('SHOPEE')?document.getElementById('shopeePage'):document.getElementById('ccslPage');if(!root)return;
    const data=await getTrends(model.businessType);if(!data)return;
    root.querySelectorAll('.v18-chart-card').forEach((node,index)=>{const chart=genericCharts(data)[index];if(chart)RateTrendCardV18.render(node,chart);});
    // Attempt trend ownership: v27-trend-mount-fix.js only.
  }
  if(global.DashboardV18){
    const home=global.DashboardV18.renderHome, business=global.DashboardV18.renderBusiness;
    global.DashboardV18.renderHome=function(root,model){home(root,model);queueMicrotask(()=>void enrichHome());};
    global.DashboardV18.renderBusiness=function(root,model){normalizeRatioText(model);business(root,model);queueMicrotask(()=>void enrichBusiness(model));};
  }

  function ensureCarryPage(){
    const main=document.querySelector('.main-content');if(!main)return;
    if(!document.getElementById('carry-monitorPage')){
      const section=document.createElement('section');section.id='carry-monitorPage';section.className='app-page v27-carry-page';section.hidden=true;section.innerHTML=`<div class="page-heading"><div><h2>遗留异常动态</h2><p>跨日未闭环包裹 · 自动核对最新节点是否发生变化</p></div></div><div id="v27CarryContent" class="panel"><div class="v27-loading">正在读取遗留异常动态…</div></div>`;main.appendChild(section);
    }
    const nav=document.querySelector('.side-nav');if(nav&&!nav.querySelector('[data-page="carry-monitor"]')){
      const btn=document.createElement('button');btn.className='side-link';btn.dataset.page='carry-monitor';btn.innerHTML='<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-alert"></use></svg><span class="side-label">遗留异常动态</span>';btn.onclick=()=>navigatePage('carry-monitor');const exceptions=nav.querySelector('[data-page="exceptions"]');exceptions?.insertAdjacentElement('afterend',btn);
    }
  }
  async function loadCarry(){
    const host=document.getElementById('v27CarryContent');if(!host)return;host.innerHTML='<div class="v27-loading"><b>正在读取遗留异常最新节点…</b></div>';
    try{
      const data=await api(`/api/v27/carry-monitor?status=${carryStatus}&limit=500`);const s=data.summary||{};
      host.innerHTML=`<div class="v27-carry-toolbar"><button class="${carryStatus==='OPEN'?'active':''}" onclick="window.v27SetCarryStatus('OPEN')">未闭环</button><button class="${carryStatus==='ALL'?'active':''}" onclick="window.v27SetCarryStatus('ALL')">全部</button><span class="v27-detail-meta">数据更新时间 ${esc(data.generatedAt||'')}</span></div>
        <div class="v27-carry-summary"><article><span>当前遗留</span><b>${fmt(s.total)}</b></article><article><span>发现新节点</span><b class="v27-new-node">${fmt(s.newNode)}</b></article><article><span>3天+未更新</span><b class="v27-stale">${fmt(s.stale3)}</b></article><article><span>已闭环</span><b>${fmt(s.closed)}</b></article></div>
        <div class="v27-detail-scroll"><table class="v27-detail-table"><thead><tr><th>运单号</th><th>业务</th><th>来源日期</th><th>遗留天数</th><th>当前状态</th><th>最新节点</th><th>最新时间</th><th>节点变化</th><th>Pending</th><th>OC</th><th>操作</th></tr></thead><tbody>${(data.rows||[]).map(row=>`<tr><td>${esc(row.shipmentCode)}</td><td>${esc(row.businessType)}</td><td>${esc(row.sourceReportDate)}</td><td>${fmt(row.daysOpen)}天</td><td>${esc(row.category||row.currentState||'—')}</td><td>${esc(row.latestNode||'—')}</td><td>${esc(row.latestEventTime||'—')}</td><td class="${row.hasNewNode?'v27-new-node':row.daysOpen>=3?'v27-stale':''}">${row.hasNewNode?'有新节点':'暂无变化'}</td><td>${fmt(row.pendingDays)}</td><td>${fmt(row.ocDays)}</td><td><button class="text-button" data-v27row="${encodeURIComponent(JSON.stringify({shipmentCode:row.shipmentCode,businessType:row.businessType,reportDate:row.lastReportDate||row.sourceReportDate,category:row.category}))}" onclick="window.v27OpenTracking(this.dataset.v27row)">查看轨迹</button></td></tr>`).join('')}</tbody></table></div>`;
    }catch(error){host.innerHTML=`<div class="empty-state">遗留异常读取失败：${esc(error.message)}</div>`;}
  }
  global.v27SetCarryStatus=status=>{carryStatus=status;void loadCarry();};
  ensureCarryPage();
  const oldNavigate=global.navigatePage||navigatePage;
  const v27Navigate=function(page,anchor=''){
    if(page!=='carry-monitor')return oldNavigate(page,anchor);
    currentPage='carry-monitor';if(location.pathname!=='/carry')history.pushState({},'', '/carry');renderAll();document.getElementById('pageTitle').textContent='遗留异常动态';void loadCarry();if(carryTimer)clearInterval(carryTimer);carryTimer=setInterval(()=>{if(currentPage==='carry-monitor')void loadCarry();},600000);scrollTo({top:0,behavior:'smooth'});
  };
  global.navigatePage=v27Navigate;try{navigatePage=v27Navigate;}catch{}
  const oldPageFromPath=pageFromPath;try{pageFromPath=function(){return location.pathname.toLowerCase()==='/carry'?'carry-monitor':oldPageFromPath();};}catch{}
  if(location.pathname.toLowerCase()==='/carry'){setTimeout(()=>v27Navigate('carry-monitor'),0);}

  // Existing V26 bootstrap already preloads five compact business states. Prevent an
  // extra /api/business-state request on every click when the exact V27 state is ready.
  try{
    const oldHydrate=hydratePageData;
    hydratePageData=async function(page){
      if(['ce','tbkh','ali1688','shopeecn','shopeevn'].includes(page)){
        const type=currentBusinessType();const state=businessStates?.[type];const selected=historyModeDate||unifiedImportState?.reportDate||'';
        if(state?._v27Fast&&(!selected||state.reportDate===selected))return;
      }
      return oldHydrate(page);
    };
  }catch{}

  queueMicrotask(()=>{wireShopeeSpecial();if(currentPage==='home')void enrichHome();});
})(window);
