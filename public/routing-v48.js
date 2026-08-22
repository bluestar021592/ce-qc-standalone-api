(function installRoutingV48(global){
  const VERSION='2026-08-23-v239-owner-retired-passive-routing-v1';
  if(global.__CE_QC_V237_DASHBOARD_OWNER__){
    global.__CE_QC_V48_ROUTING_RETIRED__={version:VERSION,reason:'V239_SINGLE_DASHBOARD_OWNER'};
    console.info('[CE-QC][V239_ROUTING_V48_RETIRED]',VERSION,'passive /api/v48/routing scans disabled; V238 current cards own routing metrics and drilldown');
    return;
  }
  const PATH_TYPE={
    '/ce':'CE','/ceaf':'CEAF','/tbkh':'TBKH','/ali1688':'ALI1688'
  };
  const ROUTES=[
    {key:'CCSLCN',label:'CCSLCN分流',tab:'ccslCnDiversion'},
    {key:'CCSLZT',label:'CCSLZT分流',tab:'ccslZtDiversion'},
    {key:'CCSL580',label:'580滞留包裹',tab:'ccsl580Retention'}
  ];
  const ROUTING_LABELS=new Set(['CECN滞留包裹','CCSLCN分流','CEZT滞留包裹','CCSLZT分流','CCSL580分流','CCSL580滞留包裹','580滞留包裹']);
  let scheduled=false;
  let activeRequest='';
  let lastKey='';
  let lastPayload=null;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');

  function businessType(){return PATH_TYPE[location.pathname]||'';}
  function relevantPath(){return Boolean(businessType()||location.pathname==='/whpp');}
  function range(){
    const from=document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||'';
    const to=document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||from;
    if(from&&to&&from<=to)return{from,to};
    let date='';
    try{date=typeof historyModeDate!=='undefined'?historyModeDate:'';}catch{}
    if(!date){try{date=typeof unifiedImportState!=='undefined'?unifiedImportState?.reportDate||'':'';}catch{}}
    return{from:date,to:date};
  }
  function grid(){
    const root=document.getElementById('ccslPage');
    return root?.querySelector('.v18-core-grid')||root?.querySelector('#ccslMetrics .core-metric-grid')||root?.querySelector('.core-metric-grid')||null;
  }
  function metricCards(container){return [...(container?.querySelectorAll('.v18-metric-card,.metric-card,.core-metric-card')||[])];}
  function labelOf(card){return String(card?.querySelector('span')?.textContent||card?.querySelector('.metric-label')?.textContent||'').trim();}

  async function fetchPayload(type,from,to){
    if(!type||!from||!to)return null;
    const key=`${type}:${from}:${to}`;
    if(key===lastKey&&lastPayload)return lastPayload;
    if(activeRequest===key)return null;
    activeRequest=key;
    try{
      const params=new URLSearchParams({businessType:type,from,to});
      const response=await fetch(`/api/v48/routing?${params}`,{cache:'no-store',credentials:'same-origin'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);
      lastKey=key;lastPayload=data;return data;
    }catch(error){console.warn('[CE-QC][ROUTING_V48]',error);return null;}
    finally{activeRequest='';}
  }

  function valueFor(payload,key){
    const s=payload?.summary||{};
    if(key==='CCSLCN')return Number(s.ccslCnDiversion||0);
    if(key==='CCSLZT')return Number(s.ccslZtDiversion||0);
    if(key==='CCSL580')return Number(s.ccsl580Retention||0);
    return 0;
  }

  function removeOldRoutingCards(container){
    for(const card of metricCards(container))if(ROUTING_LABELS.has(labelOf(card)))card.remove();
  }

  function makeCard(route,value,total,type,from,to){
    const button=document.createElement('button');
    button.type='button';
    button.className='v18-metric-card v48-routing-card';
    button.dataset.routingDestination=route.key;
    button.innerHTML=`<i aria-hidden="true">●</i><span>${esc(route.label)}</span><b>${fmt(value)}</b><small>占本业务 ${total?(value*100/total).toFixed(2):'0.00'}%</small>`;
    button.title=`仅显示最终轨迹位于 ${route.key==='CCSL580'?'CEL:CCSL580':`CEL:${route.key}`} 的运单`;
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();void openDetail(type,from,to,route.key,route.label);});
    return button;
  }

  function applyWhpp580(){
    if(location.pathname!=='/whpp')return;
    const container=document.querySelector('#shopeePage .v18-core-grid');
    if(!container)return;
    for(const card of metricCards(container)){
      const label=labelOf(card);
      if(!['CCSL580分流','CCSL580滞留包裹','580滞留包裹'].includes(label))continue;
      const span=card.querySelector('span');
      if(span)span.textContent='580滞留包裹';
      card.title='仅显示最终轨迹位于 CEL:CCSL580 的运单';
      card.onclick=event=>{event.preventDefault();event.stopPropagation();if(typeof global.openWhppDetailV44==='function')global.openWhppDetailV44('ccsl580Retention');};
    }
  }

  async function apply(){
    scheduled=false;
    if(location.pathname==='/whpp'){applyWhpp580();return;}
    const type=businessType();if(!type)return;
    const container=grid();if(!container)return;
    const {from,to}=range();if(!from||!to)return;
    const payload=await fetchPayload(type,from,to);if(!payload)return;
    if(type!==businessType())return;
    removeOldRoutingCards(container);
    const total=Number(payload.total||0);
    for(const route of ROUTES)container.appendChild(makeCard(route,valueFor(payload,route.key),total,type,from,to));
  }

  async function openDetail(type,from,to,destination,label){
    try{
      const params=new URLSearchParams({businessType:type,from,to,destination,pageSize:'1000'});
      const response=await fetch(`/api/v48/routing?${params}`,{cache:'no-store',credentials:'same-origin'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);
      showDetail(`${label} · 最终节点 ${destination==='CCSL580'?'CEL:CCSL580':`CEL:${destination}`}`,data.rows||[],data.total||0);
    }catch(error){alert(`明细读取失败：${error.message}`);}
  }

  function showDetail(title,rows,total){
    const dialog=document.getElementById('metricDetailDialog');
    const titleNode=document.getElementById('metricDetailTitle');
    const body=document.getElementById('metricDetailBody');
    const columns=[
      ['shipmentCode','运单号'],['businessType','业务板块'],['reportDate','日报日期'],['regionCode','区域'],
      ['finalRoutingNode','最终轨迹节点'],['primaryCategory','当前分类'],['latestEventTime','最新时间']
    ];
    const table=rows.length?`<div style="overflow:auto;max-height:620px"><table class="preview-table"><thead><tr>${columns.map(([,name])=>`<th>${esc(name)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(([key])=>`<td>${esc(row?.[key]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">当前指标暂无明细</div>';
    if(dialog&&titleNode&&body){titleNode.textContent=`${title} · ${fmt(total)}票`;body.innerHTML=table;dialog.hidden=false;return;}
    const panel=document.getElementById('ccslPreviewPanel');
    if(panel){panel.innerHTML=`<div class="panel-title"><h3>${esc(title)} · ${fmt(total)}票</h3></div>${table}`;panel.scrollIntoView({behavior:'smooth',block:'start'});}
  }

  function schedule(){if(scheduled)return;scheduled=true;setTimeout(apply,60);}
  function install(){
    const observer=new MutationObserver(mutations=>{
      if(!relevantPath())return;
      if(mutations.some(m=>m.type==='childList'&&m.addedNodes.length))schedule();
    });
    observer.observe(document.querySelector('.app-shell')||document.body,{subtree:true,childList:true});
    global.addEventListener('popstate',()=>{lastKey='';lastPayload=null;schedule();});
    document.addEventListener('change',event=>{if(['topRangeFrom','topRangeTo','dashboardRangeFrom','dashboardRangeTo'].includes(event.target?.id)){lastKey='';lastPayload=null;schedule();}},true);
    document.addEventListener('click',event=>{if(event.target?.closest?.('#topRangeQuery,.top-range-query')){lastKey='';lastPayload=null;setTimeout(schedule,100);}},true);
    schedule();
    console.info('[CE-QC][ROUTING_V48]',VERSION);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
