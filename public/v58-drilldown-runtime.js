(function installDrilldownRuntimeV58(global){
  const VERSION='2026-08-11-v61-canonical-drilldown-v4';
  const PATH_TYPES=new Map([['/ce','CE'],['/ceaf','CEAF'],['/tbkh','TBKH'],['/ali1688','ALI1688'],['/shopeecn','SHOPEECN'],['/shopeevn','SHOPEEVN']]);
  const COMMON={
    '签收件数':'podClosed','今日POD':'podClosed','签收率':'podClosed','POD率':'podClosed','首次妥投率':'podClosed',
    '已退回件':'accountingReturned','退回率':'accountingReturned','退件率':'accountingReturned',
    '当前未闭环':'accountingOpen','未闭环':'accountingOpen','对账差异':'accountingDifference','严重异常':'severeAbnormal',
    'Pending不连续':'pendingNonContinuous','Pending1+':'pendingAll','Pending2+':'pending2plus','Pending3+':'pending3',
    'OC1+':'ocAll','OC 1天+':'ocAll','OC2+':'oc2plus','OC 2天+':'oc2plus','OC3+':'oc3','OC 3天+':'oc3',
    '盘点2天+':'cycle2','盘点 2天+':'cycle2','入库无扫描':'inboundNoScan','入库无扫描节点':'inboundNoScan',
    '工单':'workOrderAbnormal','工单未处理':'workOrderAbnormal','外省未完结POD件':'provinceOpen','仓库自提件':'selfPickup',
    'CCSLCN':'ccslCnDiversion','CEZT':'ccslZtDiversion','CCSL580':'ccsl580Retention','金边门店':'phnomPenhShop','外省门店':'provinceShop'
  };
  const SHOPEE={
    '今日POD':'pod','POD率':'pod','签收件数':'pod','签收率':'pod','已退回件':'returned','退件率':'returned','退回率':'returned',
    '当前未闭环':'unresolved','未闭环':'unresolved','Pending不连续':'pendingNonContinuous','Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3',
    'OC1+':'oc1','OC2+':'oc2','OC3+':'oc3','盘点2天+':'cycle2','入库无扫描':'inboundNoScan','派送中':'deliveryStay','退回待处理':'returnRequired'
  };
  let activeRequest=0;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const setText=(node,text)=>{if(node&&node.textContent!==String(text))node.textContent=String(text);};

  function canonicalLabel(value=''){
    const label=String(value||'').trim();
    if(['CCSLCN','CCSLCN分流','CECN滞留包裹','CCSLCN滞留包裹'].includes(label))return'CCSLCN';
    if(['CEZT','CCSLZT分流','CEZT滞留包裹','CCSLZT滞留包裹'].includes(label))return'CEZT';
    if(['CCSL580','580滞留包裹','CCSL580分流','CCSL580滞留包裹'].includes(label))return'CCSL580';
    return label;
  }

  function cardLabel(card){return canonicalLabel(card?.querySelector('.v18-metric-label')?.textContent||card?.querySelector('span')?.textContent||card?.dataset?.label||'');}

  function inlineBusinessType(card){
    const inline=String(card?.getAttribute?.('onclick')||'');
    const match=inline.match(/openV18MetricDetail\?\.\(\s*['"]([^'"]+)['"]/i);
    return normalizeType(match?.[1]||'');
  }

  function normalizeType(value=''){
    const raw=String(value||'').trim().toUpperCase().replace(/\s+/g,'');
    if(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].includes(raw))return raw;
    return'';
  }

  function pageBusinessType(card){
    const path=(location.pathname.toLowerCase().replace(/\/+$/,'')||'/');
    if(PATH_TYPES.has(path))return PATH_TYPES.get(path);
    const inline=inlineBusinessType(card);if(inline)return inline;
    try{const current=normalizeType(global.currentBusinessType?.());if(current)return current;}catch{}
    try{const state=global.currentBusinessState?.();const current=normalizeType(state?.businessType||state?.dashboard?.businessType||'');if(current)return current;}catch{}
    const title=`${document.querySelector('.v18-page-heading h2')?.textContent||''} ${document.getElementById('pageTitle')?.textContent||''}`.toUpperCase();
    if(/SHOPEE\s*CN/.test(title))return'SHOPEECN';
    if(/SHOPEE\s*VN/.test(title))return'SHOPEEVN';
    if(/ALI1688/.test(title))return'ALI1688';
    if(/CEAF/.test(title))return'CEAF';
    if(/TBKH/.test(title))return'TBKH';
    if(/CE看板|\bCE\b/.test(title))return'CE';
    return'';
  }

  function tabFor(type,label,key=''){
    const normalized=canonicalLabel(label);
    if(String(type).startsWith('SHOPEE'))return SHOPEE[normalized]||(['SHOPEECN','SHOPEEVN'].includes(normalizeType(normalized))?'all':'');
    if(COMMON[normalized])return COMMON[normalized];
    const keyLabel=canonicalLabel(String(key||'').replace(/^v55-/,''));
    if(COMMON[keyLabel])return COMMON[keyLabel];
    if(['CE','CEAF','TBKH','ALI1688'].includes(normalizeType(normalized)))return'allData';
    return'';
  }

  function dateRange(){
    const from=document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||'';
    const to=document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'';
    let fallback='';
    try{fallback=String(global.historyModeDate||global.unifiedImportState?.reportDate||global.currentBusinessState?.()?.reportDate||'');}catch{}
    const end=String(to||fallback).slice(0,10),start=String(from||end).slice(0,10);
    return{from:start,to:end};
  }

  function ensureDetailHost(type){
    const id=String(type).startsWith('SHOPEE')?'shopeePreviewPanel':'ccslPreviewPanel';
    let host=document.getElementById(id);if(host)return host;
    const page=document.querySelector('.v18-business-page')||[...document.querySelectorAll('.app-page')].find(node=>!node.hidden);
    if(!page)return null;
    host=document.createElement('section');host.id=id;host.className='panel v18-detail-preview v27-detail-panel';page.appendChild(host);return host;
  }

  function columns(rows){
    const preferred=['shipmentCode','businessType','reportDate','regionCode','物理位置','当前分类','POD状态','Pending次数','pendingDistinctDayCount','OC天数','盘点天数','最新节点','最新时间'];
    const found=preferred.filter(key=>rows.some(row=>row?.[key]!==undefined));
    return (found.length?found:Object.keys(rows[0]||{})).slice(0,13);
  }
  function name(key){return({shipmentCode:'运单号',businessType:'业务',reportDate:'日报日期',regionCode:'区域',物理位置:'当前位置区域',当前分类:'当前分类',pendingDistinctDayCount:'Pending天数',最新节点:'最新节点',最新时间:'最新时间'})[key]||key;}

  function render(host,data,label){
    const rows=Array.isArray(data.rows)?data.rows:[],cols=columns(rows),maxPage=Math.max(1,Math.ceil(Number(data.total||0)/Number(data.pageSize||200)));
    host.classList.add('v27-detail-panel');
    host.innerHTML=`<div class="v27-detail-head"><div><h3>${esc(canonicalLabel(label))}</h3><div class="v27-detail-meta">${esc(data.fromDate||'')} ～ ${esc(data.toDate||'')} · 共 ${fmt(data.total)} 票 · 当前第 ${Number(data.page||1)}/${maxPage} 页</div></div></div><div class="v27-detail-scroll">${rows.length?`<table class="v27-detail-table"><thead><tr>${cols.map(key=>`<th>${esc(name(key))}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${cols.map(key=>`<td>${esc(row?.[key]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="empty-state">该指标当前没有匹配的逐票数据</div>'}</div>`;
  }

  async function openDetail(type,tab,label){
    const host=ensureDetailHost(type),range=dateRange();if(!host||!range.to)return;
    const request=++activeRequest,visibleLabel=canonicalLabel(label);
    host.innerHTML=`<div class="v27-loading"><b>正在读取 ${esc(visibleLabel)} 明细…</b></div>`;
    host.scrollIntoView({behavior:'smooth',block:'start'});
    try{
      const params=new URLSearchParams({businessType:type,from:range.from,to:range.to,tab,page:'1',pageSize:'200'});
      const response=await fetch(`/api/v61/metric-detail?${params}`,{cache:'no-store',credentials:'same-origin'});
      const data=await response.json().catch(()=>({}));if(request!==activeRequest)return;
      if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);
      render(host,data,visibleLabel);
    }catch(error){if(request===activeRequest)host.innerHTML=`<div class="empty-state">明细读取失败：${esc(error.message||error)}</div>`;}
  }

  function normalizeSpecialLabels(){
    document.querySelectorAll('.v18-metric-card').forEach(card=>{
      const node=card.querySelector('.v18-metric-label')||card.querySelector('span');if(!node)return;
      const next=canonicalLabel(node.textContent||'');if(next&&next!==String(node.textContent||'').trim())node.textContent=next;
      const metric=String(card.dataset?.metric||'');if(metric.startsWith('v55-'))card.dataset.metric=`v55-${canonicalLabel(metric.slice(4))}`;
    });
  }

  function dedupeCoreMetricCards(){
    document.querySelectorAll('.v18-core-grid').forEach(grid=>{
      const seen=new Set();
      [...grid.querySelectorAll('.v18-metric-card')].forEach(card=>{
        const label=cardLabel(card);if(!label)return;
        if(seen.has(label)){card.remove();return;}
        seen.add(label);
      });
    });
  }

  async function syncSevereMetric(){
    const type=pageBusinessType(null);if(!type||String(type).startsWith('SHOPEE'))return;
    const range=dateRange();if(!range.to)return;
    try{
      const params=new URLSearchParams({from:range.from,to:range.to});
      const response=await fetch(`/api/v55/reconciliation?${params}`,{cache:'no-store',credentials:'same-origin'}),data=await response.json().catch(()=>({}));
      const summary=data?.summary?.[type];if(!response.ok||!summary)return;
      document.querySelectorAll('.v18-core-grid .v18-metric-card').forEach(card=>{
        if(cardLabel(card)!=='严重异常')return;
        const value=Number(summary.severe??summary.severeAbnormal??summary.abnormal??0),total=Number(summary.total||0);
        setText(card.querySelector('b'),fmt(value));setText(card.querySelector('small'),total?`占本业务 ${(value*100/total).toFixed(2)}%`:'占本业务 0.00%');
      });
    }catch{}
  }

  function stabilizeMetrics(){normalizeSpecialLabels();dedupeCoreMetricCards();}

  function onClick(event){
    const card=event.target?.closest?.('.v18-metric-card,.v18-business-card');if(!card)return;
    const type=pageBusinessType(card),label=cardLabel(card),tab=tabFor(type,label,card.dataset?.metric||'');
    if(!type||!tab)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void openDetail(type,tab,label);
  }

  function install(){
    global.addEventListener('click',onClick,true);
    const observer=new MutationObserver(()=>{
      stabilizeMetrics();
      clearTimeout(global.__CE_QC_V58_SYNC_TIMER__);
      global.__CE_QC_V58_SYNC_TIMER__=setTimeout(syncSevereMetric,80);
    });
    observer.observe(document.documentElement,{subtree:true,childList:true});
    stabilizeMetrics();
    setTimeout(()=>{stabilizeMetrics();void syncSevereMetric();},100);
    setTimeout(stabilizeMetrics,500);
    document.documentElement.dataset.v58Drilldown='4';
    console.info('[CE-QC][DRILLDOWN_V61]',VERSION);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
