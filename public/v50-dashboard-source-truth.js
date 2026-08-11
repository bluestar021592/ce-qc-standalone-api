(function installDashboardSourceTruthV50(global){
  const VERSION='2026-08-11-v50-dashboard-source-truth-ui-v1';
  const TAB_BY_LABEL={
    'CCSLCN分流':'ccslCnDiversion','CECN滞留包裹':'ccslCnDiversion',
    'CCSLZT分流':'ccslZtDiversion','CEZT滞留包裹':'ccslZtDiversion',
    '580滞留包裹':'ccsl580Retention','CCSL580分流':'ccsl580Retention','CCSL580滞留包裹':'ccsl580Retention',
    '金边门店':'phnomPenhShop'
  };
  let detailContext=null;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  function businessType(){
    const path=location.pathname.toLowerCase();
    return ({'/ce':'CE','/ceaf':'CEAF','/tbkh':'TBKH','/ali1688':'ALI1688','/shopeecn':'SHOPEECN','/shopeevn':'SHOPEEVN'})[path]||'';
  }
  function range(){
    let from='',to='';
    try{from=String(dashboardPeriodRange?.fromDate||'');to=String(dashboardPeriodRange?.toDate||'');}catch{}
    from=from||document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||'';
    to=to||document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'';
    if(!to){try{to=String(historyModeDate||unifiedImportState?.reportDate||'');}catch{}}
    if(!from)from=to;
    return{from,to};
  }
  function panel(type){return String(type).startsWith('SHOPEE')?document.getElementById('shopeePreviewPanel'):document.getElementById('ccslPreviewPanel');}
  function labelOf(card){return String(card?.querySelector('span')?.textContent||card?.querySelector('.metric-label')?.textContent||'').trim();}
  function detailColumns(rows){
    const preferred=['shipmentCode','businessType','reportDate','regionCode','recipient_raw','当前分类','primaryCategory','POD状态','Pending次数','pendingDays','OC天数','ocDays','最新节点','最新时间'];
    return preferred.filter(key=>rows.some(row=>row?.[key]!==undefined)).slice(0,12);
  }
  function displayName(key){return({shipmentCode:'运单号',businessType:'业务',reportDate:'日报日期',regionCode:'区域',recipient_raw:'收件人',primaryCategory:'当前分类',pendingDays:'Pending天数',ocDays:'OC天数',最新节点:'最新节点',最新时间:'最新时间'})[key]||key;}
  function renderDetail(host,data,label){
    const rows=data.rows||[],cols=detailColumns(rows),maxPage=Math.max(1,Math.ceil(Number(data.total||0)/Number(data.pageSize||200)));
    host.classList.add('v27-detail-panel');
    host.innerHTML=`<div class="v27-detail-head"><div><h3>${esc(label)}</h3><div class="v27-detail-meta">${esc(data.fromDate)} ～ ${esc(data.toDate)} · 共 ${fmt(data.total)} 票 · 当前第 ${data.page}/${maxPage} 页</div></div></div>
      <div class="v27-detail-scroll">${rows.length?`<table class="v27-detail-table"><thead><tr>${cols.map(k=>`<th>${esc(displayName(k))}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${cols.map(k=>`<td>${esc(row?.[k]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="empty-state">该指标当前没有匹配的逐票数据</div>'}</div>
      <div class="v27-detail-pager"><button ${data.page<=1?'disabled':''} data-v50-page="${data.page-1}">上一页</button><button ${data.page>=maxPage?'disabled':''} data-v50-page="${data.page+1}">下一页</button></div>`;
    host.querySelectorAll('[data-v50-page]').forEach(button=>button.addEventListener('click',()=>{const page=Number(button.dataset.v50Page||1);if(detailContext&&page>0)void openSpecial(detailContext.type,detailContext.tab,detailContext.label,page);}));
  }
  async function openSpecial(type,tab,label,pageNo=1){
    const host=panel(type),r=range();if(!host||!r.to)return;
    detailContext={type,tab,label};
    host.classList.add('v27-detail-panel');
    host.innerHTML=`<div class="v27-loading"><b>正在读取 ${esc(label)} 明细…</b><br>按最终有效位置读取，不返回整个业务全量。</div>`;
    host.scrollIntoView({behavior:'smooth',block:'start'});
    try{
      const params=new URLSearchParams({businessType:type,from:r.from,to:r.to,tab,page:String(pageNo),pageSize:'200'});
      const response=await fetch(`/api/v50/special-detail?${params}`,{cache:'no-store',credentials:'same-origin'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);
      renderDetail(host,data,label);
    }catch(error){host.innerHTML=`<div class="empty-state">明细读取失败：${esc(error.message||error)}</div>`;}
  }

  // Capture phase intentionally runs before legacy inline onclick. This prevents a
  // special routing/location card from falling through to the old all/allData tab.
  document.addEventListener('click',event=>{
    const card=event.target?.closest?.('.v18-metric-card,.v18-business-card,.core-metric-card,.metric-card');
    if(!card)return;
    const label=labelOf(card),tab=TAB_BY_LABEL[label],type=businessType();
    if(!tab||!type)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    void openSpecial(type,tab,label,1);
  },true);

  function renameReturnRate(){
    if(!['/shopeecn','/shopeevn'].includes(location.pathname.toLowerCase()))return;
    document.querySelectorAll('.v18-business-card span,.v18-metric-card span,.recipient-metric-grid span').forEach(node=>{
      if(String(node.textContent||'').trim()==='退回率')node.textContent='退件率';
    });
  }
  let timer=null;
  const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(renameReturnRate,50);});
  observer.observe(document.querySelector('.app-shell')||document.body,{subtree:true,childList:true});
  global.addEventListener('popstate',()=>setTimeout(renameReturnRate,50));
  renameReturnRate();
  console.info('[CE-QC][DASHBOARD_V50]',VERSION);
})(window);
