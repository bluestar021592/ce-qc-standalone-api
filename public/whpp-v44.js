(function (global) {
  const VERSION='2026-08-10-v44-whpp-native-shopee-layout-v3';
  let cached=null;
  let activeDate='';
  let observer=null;

  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const pct=value=>`${Number(value||0).toFixed(2).replace(/\.00$/,'')}%`;
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const attr=value=>esc(value).replace(/`/g,'&#96;');
  const share=(value,total)=>`占本业务 ${total?(Number(value||0)*100/Number(total)).toFixed(2):'0.00'}%`;

  function ensureNav(){
    const nav=document.querySelector('.side-nav');
    if(!nav)return;
    let button=nav.querySelector('[data-page="whpp"]');
    if(!button){
      button=document.createElement('button');
      button.className='side-link';
      button.dataset.page='whpp';
      button.dataset.path='/whpp';
      button.innerHTML='<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-package"></use></svg><span class="side-label">WHPP本土看板</span>';
      const anchor=nav.querySelector('[data-page="ali1688"]');
      if(anchor?.nextSibling)nav.insertBefore(button,anchor.nextSibling);else nav.appendChild(button);
    }
    button.onclick=event=>{event?.preventDefault?.();navigate();};
  }

  function host(){
    return document.getElementById('shopeePage')||document.querySelector('main.main-content .app-page');
  }

  function forceVisibility(){
    if(location.pathname!=='/whpp')return;
    ensureNav();
    const target=host();
    if(!target)return;
    document.querySelectorAll('.app-page').forEach(node=>{node.hidden=node!==target;node.classList.toggle('active',node===target);});
    document.querySelectorAll('.side-link').forEach(node=>node.classList.toggle('active',node.dataset.page==='whpp'));
    const title=document.getElementById('pageTitle');if(title)title.textContent='WHPP本土看板';
  }

  function zeroDashboard(){
    return {metrics:{total:0,pod:0,podRate:0,returned:0,returnRate:0,cancelled:0,cancelRate:0,unresolved:0,pendingNonContinuous:0,pending1:0,pending2:0,pending3:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,workOrder:0,delivery:0,normalDiversion:0,ccslCnDiversion:0,ccslZtDiversion:0,ccsl580Diversion:0,phnomPenhShop:0},regions:{PP:{},PV:{}}};
  }

  function topCard(label,value,unit,tone,tab,total){
    return `<button class="v18-business-card ${tone||''}" onclick="window.openWhppDetailV44('${attr(tab)}')"><span>${esc(label)}</span><small>${unit==='%'?'当前比率':'今日票数'}</small><b>${unit==='%'?pct(value):fmt(value)}</b><em>${label==='WHPP本土'?'占本业务 100.00%':share(value,total)}</em></button>`;
  }

  function metricCard(label,value,unit,tab,total){
    return `<button class="v18-metric-card" onclick="window.openWhppDetailV44('${attr(tab)}')"><i aria-hidden="true">●</i><span>${esc(label)}</span><b>${unit==='%'?pct(value):fmt(value)}</b><small>${share(value,total)}</small></button>`;
  }

  function regionBlock(code,row={}){
    const label=code==='PP'?'本省（PP）':'外省（PV）';
    const sub=code==='PP'?'金边/本省':'外省收件地址';
    const items=[
      ['今日件数',row.total,'all'],['签收率',pct(row.podRate),'pod'],['签收件数',row.pod,'pod'],
      ['Pending1+',row.pending1,'pending1'],['Pending2+',row.pending2,'pending2'],['Pending3+',row.pending3,'pending3'],
      ['OC1+',row.oc1,'oc1'],['OC2+',row.oc2,'oc2'],['OC3+',row.oc3,'oc3'],
      ['已退回件',row.returned,'returned'],['订单取消',row.cancelled,'cancelled'],['当前未闭环',row.unresolved,'unresolved'],['金边门店',row.phnomPenhShop,'phnomPenhShop']
    ];
    return `<article class="panel region-card ${code.toLowerCase()}"><section class="region-block ${code.toLowerCase()}"><h4>${label}<small>${sub}</small></h4><div>${items.map(([name,value,key])=>`<button onclick="window.openWhppRegionDetailV44('${code}','${key}')"><span>${esc(name)}</span><b>${typeof value==='string'?value:fmt(value)}</b></button>`).join('')}</div></section></article>`;
  }

  function sevenDates(date){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return Array(7).fill('—');
    const end=new Date(`${date}T00:00:00Z`);
    return Array.from({length:7},(_,index)=>{const day=new Date(end);day.setUTCDate(end.getUTCDate()+index-6);return day.toISOString().slice(0,10);});
  }

  function chart(title,type,value,date,oc=false){
    const values=Array(6).fill(null).concat([Number(value||0)]);
    return {title,type,oc,dates:sevenDates(date),series:[{name:'WHPP',color:'#1677ff',values}]};
  }

  function renderCharts(target,charts){
    const nodes=target.querySelectorAll('.v18-chart-card');
    nodes.forEach((node,index)=>global.RateTrendCardV18?.render?.(node,charts[index]));
  }

  function render(data=cached,error=''){
    const target=host();if(!target)return;
    const state=data?.state||{};
    const dashboard=data?.dashboard||zeroDashboard();
    const m=dashboard.metrics||{};
    const regions=dashboard.regions||{};
    const total=Number(m.total||0);
    const date=state.reportDate||activeDate||'';
    const top=[
      ['WHPP本土',m.total,'件','purple','all'],['今日POD',m.pod,'件','blue','pod'],['POD率',m.podRate,'%','blue','pod'],
      ['已退回件',m.returned,'件','blue','returned'],['订单取消',m.cancelled,'件','blue','cancelled'],['当前未闭环',m.unresolved,'件','blue','unresolved']
    ];
    const core=[
      ['Pending不连续',m.pendingNonContinuous,'件','pendingNonContinuous'],['Pending1+',m.pending1,'件','pending1'],['Pending2+',m.pending2,'件','pending2'],['Pending3+',m.pending3,'件','pending3'],
      ['OC1+',m.oc1,'件','oc1'],['OC2+',m.oc2,'件','oc2'],['OC3+',m.oc3,'件','oc3'],['盘点2天+',m.cycle2,'件','cycle2'],['入库无扫描',m.inboundNoScan,'件','inboundNoScan'],
      ['已退回件',m.returned,'件','returned'],['退回率',m.returnRate,'%','returned'],['订单取消',m.cancelled,'件','cancelled'],['取消率',m.cancelRate,'%','cancelled'],
      ['当前未闭环',m.unresolved,'件','unresolved'],['派送中',m.delivery,'件','delivery'],['工单',m.workOrder,'件','workOrder'],
      ['CCSLCN分流',m.ccslCnDiversion,'件','ccslCnDiversion'],['CCSLZT分流',m.ccslZtDiversion,'件','ccslZtDiversion'],['CCSL580分流',m.ccsl580Diversion,'件','ccsl580Diversion'],['金边门店',m.phnomPenhShop,'件','phnomPenhShop']
    ];
    const charts=[
      chart('今日票数趋势','count',m.total,date),chart('POD率趋势','rate',m.podRate,date),chart('OC率趋势','rate',total?Number(m.oc1||0)*100/total:0,date,true),chart('退回率趋势','rate',m.returnRate,date)
    ];
    const status=error
      ? `WHPP读取失败：${error}`
      : state.reportDate
        ? '数据来自WHPP本土当前业务有效快照'
        : '当前数据库暂无WHPP本土日报；重新导入日报后，CE开头运单将进入本土看板';
    target.className='app-page v18-dashboard-page v18-business-page';
    target.innerHTML=`
      <section class="v18-page-heading"><div><h2>WHPP本土看板</h2><p>日报 ${esc(date||'—')} · ${esc(status)}</p></div></section>
      <section class="v18-business-grid">${top.map(row=>topCard(...row,total)).join('')}</section>
      <section class="v18-panel v18-core"><h2>核心指标</h2><div class="v18-core-grid">${core.map(row=>metricCard(...row,total)).join('')}</div></section>
      <section class="v18-panel"><h2>区域</h2><div class="v18-business-extra"><div class="region-summary-grid">${regionBlock('PP',regions.PP||{})}${regionBlock('PV',regions.PV||{})}</div></div></section>
      <section class="v18-panel v18-trend-section"><h2>趋势图表</h2><section class="v18-chart-grid">${charts.map((_,index)=>`<article class="v18-chart-card" data-chart-index="${index}"></article>`).join('')}</section></section>
      <section id="whppPreviewPanel" class="panel v18-detail-preview" aria-live="polite"><div class="empty-state">点击上方指标查看对应明细</div></section>`;
    renderCharts(target,charts);
    forceVisibility();
  }

  async function fetchState(date=''){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5000);
    try{
      const q=date?`?reportDate=${encodeURIComponent(date)}`:'';
      const response=await fetch(`/api/whpp/state${q}`,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);
      return data;
    }finally{clearTimeout(timer);}
  }

  async function navigate(date=''){
    activeDate=date||activeDate||'';
    if(location.pathname!=='/whpp')history.pushState({page:'whpp'},'', '/whpp');
    forceVisibility();
    try{
      cached=await fetchState(activeDate);
      activeDate=cached?.state?.reportDate||activeDate;
      render(cached,'');
    }catch(error){
      render(cached||{state:{reportDate:activeDate},dashboard:zeroDashboard()},error.name==='AbortError'?'读取超过5秒，已停止等待':error.message);
    }
  }

  function rowMatches(row,key){
    const pending=Number(row.Pending当前次数??row.Pending次数??row.pendingDistinctDayCount??0)||0;
    const oc=Number(row.OC天数||0)||0;
    const category=String(row.primaryCategory||row.主分类||row.异常分类||'');
    const state=String(row.currentState||'').toUpperCase();
    const special=String(row.specialState||row.primaryCategory||row.主分类||'').toUpperCase();
    const pod=row.是否POD==='是'||row.POD状态==='POD'||state==='POD';
    const returned=row.退回状态==='已退回'||['RETURNED','RETURN_COMPLETED'].includes(state)||category==='退回';
    const cancelled=row.订单取消==='是'||state==='ORDER_CANCELLED';
    const normalDiversion=['SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','CCSL580_RETENTION','CECN_RETENTION','CEZT_RETENTION'].includes(special)||category==='正常分流节点'||row.matchedRule==='NORMAL_FINAL_HUB';
    const actionable=!pod&&!returned&&!cancelled&&!normalDiversion;
    if(key==='all')return true;
    if(key==='pod')return pod;
    if(key==='returned')return returned;
    if(key==='cancelled')return cancelled;
    if(key==='pending1')return actionable&&pending>=1;
    if(key==='pending2')return actionable&&pending>=2;
    if(key==='pending3')return actionable&&pending>=3;
    if(key==='oc1')return actionable&&oc>=1;
    if(key==='oc2')return actionable&&oc>=2;
    if(key==='oc3')return actionable&&oc>=3;
    if(key==='unresolved')return actionable;
    if(key==='phnomPenhShop')return ['SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT'].includes(String(row.shopState||''));
    return true;
  }

  async function fetchDetail(tab){
    const response=await fetch(`/api/whpp/metric-detail?reportDate=${encodeURIComponent(activeDate||'')}&tab=${encodeURIComponent(tab)}&pageSize=300`,{cache:'no-store',credentials:'same-origin'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'明细读取失败');
    return data;
  }

  function showRows(title,rows,total){
    const dialog=document.getElementById('metricDetailDialog');
    const titleNode=document.getElementById('metricDetailTitle');
    const body=document.getElementById('metricDetailBody');
    if(!dialog||!titleNode||!body)return;
    titleNode.textContent=`WHPP · ${title} · ${fmt(total??rows.length)}票`;
    const fields=['shipmentCode','regionCode','primaryCategory','currentState','POD状态','退回状态','订单取消','Pending当前次数','OC天数','shopState','latestEventTime','最后节点'];
    body.innerHTML=rows.length?`<table class="preview-table"><thead><tr>${fields.map(f=>`<th>${esc(f)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${fields.map(f=>`<td>${esc(row?.[f]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="empty-state">暂无明细</div>';
    dialog.hidden=false;
  }

  async function openDetail(tab){
    try{const data=await fetchDetail(tab);showRows(data.label||tab,data.rows||[],data.total);}catch(error){alert(error.message);}
  }

  async function openRegionDetail(code,key){
    try{
      const data=await fetchDetail(String(code||'').toLowerCase());
      const rows=(data.rows||[]).filter(row=>rowMatches(row,key));
      showRows(`${code} · ${key}`,rows,rows.length);
    }catch(error){alert(error.message);}
  }

  function install(){
    ensureNav();
    const previousNavigate=global.navigatePage;
    if(typeof previousNavigate==='function'&&!previousNavigate.__whppNativeV44){
      const wrapped=function(page){if(page==='whpp')return navigate();return previousNavigate.apply(this,arguments);};
      wrapped.__whppNativeV44=true;
      global.navigatePage=wrapped;
    }
    global.navigateWhppPage=navigate;
    global.openWhppDetailV44=openDetail;
    global.openWhppRegionDetailV44=openRegionDetail;
    observer=new MutationObserver(()=>{ensureNav();if(location.pathname==='/whpp')forceVisibility();});
    observer.observe(document.querySelector('.app-shell')||document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class']});
    global.addEventListener('popstate',()=>{if(location.pathname==='/whpp')navigate(activeDate);});
    if(location.pathname==='/whpp')navigate(activeDate);
    console.info('[CE-QC][WHPP_NATIVE_UI]',VERSION);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
