(function installDashboardReconciliationV55(global){
  const VERSION='2026-08-11-v55-dashboard-reconciliation-ui-v4';
  const CCSL_PATHS=new Map([['/ce','CE'],['/ceaf','CEAF'],['/tbkh','TBKH'],['/ali1688','ALI1688']]);
  const SHOPEE_PATHS=new Map([['/shopeecn','SHOPEECN'],['/shopeevn','SHOPEEVN']]);
  const summaryCache=new Map();
  let detailContext=null,syncing=false,syncTimer=null;
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const pct=(value,total)=>Number(total||0)?`占本业务 ${(Number(value||0)*100/Number(total)).toFixed(2)}%`:'占本业务 0.00%';

  function exactType(){const path=location.pathname.toLowerCase();return CCSL_PATHS.get(path)||SHOPEE_PATHS.get(path)||'';}
  function currentState(){try{return typeof global.currentBusinessState==='function'?global.currentBusinessState():null;}catch{return null;}}
  function range(){
    let from='',to='';try{from=String(global.dashboardPeriodRange?.fromDate||'');to=String(global.dashboardPeriodRange?.toDate||'');}catch{}
    from=from||document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||'';
    to=to||document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'';
    if(!to){try{to=String(global.historyModeDate||global.unifiedImportState?.reportDate||currentState()?.reportDate||'');}catch{to=String(currentState()?.reportDate||'');}}
    if(!from)from=to;return{from:String(from).slice(0,10),to:String(to).slice(0,10)};
  }
  function panel(type){return String(type).startsWith('SHOPEE')?document.getElementById('shopeePreviewPanel'):document.getElementById('ccslPreviewPanel');}
  function canonicalLabel(label=''){
    const value=String(label||'').trim();
    if(['CECN滞留包裹','CCSLCN滞留包裹'].includes(value))return'CCSLCN分流';
    if(['CEZT滞留包裹','CCSLZT滞留包裹'].includes(value))return'CCSLZT分流';
    if(['CCSL580分流','CCSL580滞留包裹'].includes(value))return'580滞留包裹';return value;
  }
  function localSummary(){const state=currentState();return state?.v55Summary||state?.dashboard?.v55Summary||null;}
  async function authoritativeSummary(type=exactType()){
    if(!type)return null;const local=localSummary();if(local&&Number.isFinite(Number(local.total)))return local;
    const r=range();if(!r.to)return null;const key=`${type}|${r.from}|${r.to}`;if(summaryCache.has(key))return summaryCache.get(key);
    try{const q=new URLSearchParams({from:r.from,to:r.to});const response=await fetch(`/api/v55/reconciliation?${q}`,{cache:'no-store',credentials:'same-origin'});const data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);const value=data.summary?.[type]||null;if(value)summaryCache.set(key,value);return value;}catch(error){console.warn('[CE-QC][V55][SUMMARY]',error);return null;}
  }

  function ccslValues(s){return{'签收件数':s.pod,'今日POD':s.pod,'已退回件':s.returned,'当前未闭环':s.open,'未闭环':s.open,'签收率':s.podRate,'POD率':s.podRate,'对账差异':s.accountingDifference,'Pending不连续':s.pendingNonContinuous,'Pending1+':s.pending1,'Pending2+':s.pending2,'Pending3+':s.pending3,'OC1+':s.oc1,'OC 1天+':s.oc1,'OC2+':s.oc2,'OC 2天+':s.oc2,'OC3+':s.oc3,'OC 3天+':s.oc3,'盘点2天+':s.cycle2,'盘点 2天+':s.cycle2,'入库无扫描':s.inboundNoScan,'入库无扫描节点':s.inboundNoScan,'工单':s.workOrder,'工单未处理':s.workOrder,'严重异常':s.abnormal,'外省未完结POD件':s.provinceOpen,'CCSLCN分流':s.ccslCnDiversion,'CCSLZT分流':s.ccslZtDiversion,'580滞留包裹':s.ccsl580Retention,'金边门店':s.phnomPenhShop,'外省门店':s.provinceShop};}
  function shopeeValues(s){return{'今日POD':s.pod,'签收件数':s.pod,'POD率':s.podRate,'签收率':s.podRate,'已退回件':s.returned,'退件率':s.returnRate,'退回率':s.returnRate,'当前未闭环':s.unresolved,'未闭环':s.unresolved,'Pending不连续':s.pendingNonContinuous,'Pending1+':s.pending1,'Pending2+':s.pending2,'Pending3+':s.pending3plus,'OC1+':s.oc1,'OC2+':s.oc2,'OC3+':s.oc3plus,'盘点2天+':s.cycle2plus,'入库无扫描':s.inboundNoScan,'派送中':s.deliveryStay};}
  function valueFor(type,s,label){const values=String(type).startsWith('SHOPEE')?shopeeValues(s):ccslValues(s);return Object.hasOwn(values,label)?values[label]:undefined;}
  function isRateLabel(label){return /率$/.test(label);}

  function patchModel(model,s){
    if(!model||!s)return model;const type=String(model.businessType||'').toUpperCase(),total=Number(s.total||0),values=String(type).startsWith('SHOPEE')?shopeeValues(s):ccslValues(s);
    for(const row of [...(model.cards||[]),...(model.core||[])]){const label=canonicalLabel(row.label);if(label===String(model.businessType||'')||label===String(model.label||'')){row.value=total;row.ratio='占本业务 100.00%';continue;}if(Object.hasOwn(values,label)){row.value=Number(values[label]||0);row.ratio=isRateLabel(label)?`当前比率 ${Number(row.value||0).toFixed(2)}%`:pct(row.value,total);}}
    if(!String(type).startsWith('SHOPEE')){const wanted=['未闭环','严重异常','CCSLCN分流','CCSLZT分流','580滞留包裹','金边门店','外省门店'],cleaned=[],seen=new Set();for(const row of model.core||[]){const label=canonicalLabel(row.label);if(['门店途中','门店入库','门店滞留'].includes(label)||wanted.includes(label))continue;row.label=label;const key=`${label}|${row.unit||'件'}`;if(!seen.has(key)){seen.add(key);cleaned.push(row);}}for(const label of wanted)cleaned.push({key:`v55-${label}`,label,value:Number(values[label]||0),unit:'件',ratio:pct(values[label],total)});model.core=cleaned;}return model;
  }
  function installRenderWrapper(){if(!global.DashboardV18||global.DashboardV18.__v55Reconciled)return false;const original=global.DashboardV18.renderBusiness;global.DashboardV18.renderBusiness=function(root,model){const s=localSummary();if(s)patchModel(model,s);const result=original.call(this,root,model);scheduleSync();return result;};global.DashboardV18.__v55Reconciled=true;return true;}

  function cardLabel(card){return canonicalLabel(card?.querySelector('span')?.textContent||card?.querySelector('.v18-metric-label')?.textContent||'');}
  function setText(node,text){if(node&&node.textContent!==text)node.textContent=text;}
  function setCard(card,value,label,total){if(value===undefined)return;const number=Number(value||0),valueNode=card.querySelector('b'),note=card.querySelector('em,small');setText(valueNode,isRateLabel(label)?`${number.toFixed(2).replace(/\.00$/,'')}%`:fmt(number));setText(note,isRateLabel(label)?`当前比率 ${number.toFixed(2)}%`:pct(number,total));}
  function ensureCoreCard(grid,type,label,value,total){if([...grid.querySelectorAll('.v18-metric-card')].some(card=>cardLabel(card)===label))return;const button=document.createElement('button');button.className='v18-metric-card';button.dataset.metric=`v55-${label}`;button.innerHTML=`<i aria-hidden="true">●</i><span>${esc(label)}</span><b>${fmt(value)}</b><small>${esc(pct(value,total))}</small>`;button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const tab=tabFor(type,label);if(tab)void openDetail(type,tab,label,1);});grid.appendChild(button);}
  async function syncVisibleBusinessPage(){
    if(syncing)return;const type=exactType();if(!type)return;syncing=true;
    try{const s=await authoritativeSummary(type);if(!s)return;const total=Number(s.total||0);document.querySelectorAll('.v18-business-grid .v18-business-card,.v18-core-grid .v18-metric-card').forEach(card=>{const label=cardLabel(card);if(label===type||label===type.replace('SHOPEE','SHOPEE '))setCard(card,total,label,total);else setCard(card,valueFor(type,s,label),label,total);});if(!String(type).startsWith('SHOPEE')){const grid=document.querySelector('.v18-core-grid');if(grid)for(const label of ['未闭环','严重异常','CCSLCN分流','CCSLZT分流','580滞留包裹','金边门店','外省门店'])ensureCoreCard(grid,type,label,Number(valueFor(type,s,label)||0),total);}document.documentElement.dataset.v55Reconciled='1';}finally{syncing=false;}
  }
  function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>void syncVisibleBusinessPage(),30);}

  function tabFor(type,label,key=''){
    label=canonicalLabel(label);const common={'签收件数':'podClosed','今日POD':'podClosed','签收率':'podClosed','POD率':'podClosed','首次妥投率':'podClosed','已退回件':'accountingReturned','退回率':'accountingReturned','退件率':'accountingReturned','当前未闭环':'accountingOpen','未闭环':'accountingOpen','对账差异':'accountingDifference','严重异常':'severeAbnormal','Pending不连续':'pendingNonContinuous','Pending1+':'pendingAll','Pending2+':'pending2plus','Pending3+':'pending3','OC1+':'ocAll','OC 1天+':'ocAll','OC2+':'oc2plus','OC 2天+':'oc2plus','OC3+':'oc3','OC 3天+':'oc3','盘点2天+':'cycle2','盘点 2天+':'cycle2','入库无扫描':'inboundNoScan','入库无扫描节点':'inboundNoScan','工单':'workOrderAbnormal','工单未处理':'workOrderAbnormal','外省未完结POD件':'provinceOpen','仓库自提件':'selfPickup','CCSLCN分流':'ccslCnDiversion','CCSLZT分流':'ccslZtDiversion','580滞留包裹':'ccsl580Retention','金边门店':'phnomPenhShop','外省门店':'provinceShop'};
    if(!String(type).startsWith('SHOPEE'))return common[label]||(/^v55-/.test(String(key))?common[canonicalLabel(String(key).slice(4))]:'')||(['CE','CEAF','TBKH','ALI1688'].includes(label)?'allData':'');
    const sh={'今日POD':'pod','POD率':'pod','签收件数':'pod','签收率':'pod','已退回件':'returned','退件率':'returned','退回率':'returned','当前未闭环':'unresolved','未闭环':'unresolved','Pending不连续':'pendingNonContinuous','Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3','OC1+':'oc1','OC2+':'oc2','OC3+':'oc3','盘点2天+':'cycle2','入库无扫描':'inboundNoScan','派送中':'deliveryStay','退回待处理':'returnRequired'};return sh[label]||(['SHOPEE CN','SHOPEE VN','SHOPEECN','SHOPEEVN'].includes(label)?'all':'');
  }
  function columns(rows){const keys=['shipmentCode','businessType','reportDate','regionCode','物理位置','当前分类','POD状态','Pending次数','pendingDistinctDayCount','OC天数','盘点天数','最新节点','最新时间'];return keys.filter(key=>rows.some(row=>row?.[key]!==undefined)).slice(0,13);}
  function displayName(key){return({shipmentCode:'运单号',businessType:'业务',reportDate:'日报日期',regionCode:'区域',物理位置:'当前位置区域',当前分类:'当前分类',pendingDistinctDayCount:'Pending天数',最新节点:'最新节点',最新时间:'最新时间'})[key]||key;}
  function renderDetail(host,data,label){const rows=data.rows||[],cols=columns(rows),maxPage=Math.max(1,Math.ceil(Number(data.total||0)/Number(data.pageSize||200)));host.classList.add('v27-detail-panel');host.innerHTML=`<div class="v27-detail-head"><div><h3>${esc(label)}</h3><div class="v27-detail-meta">${esc(data.fromDate)} ～ ${esc(data.toDate)} · 共 ${fmt(data.total)} 票 · 当前第 ${data.page}/${maxPage} 页</div></div></div><div class="v27-detail-scroll">${rows.length?`<table class="v27-detail-table"><thead><tr>${cols.map(k=>`<th>${esc(displayName(k))}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${cols.map(k=>`<td>${esc(row?.[k]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="empty-state">该指标当前没有匹配的逐票数据</div>'}</div><div class="v27-detail-pager"><button ${data.page<=1?'disabled':''} data-v55-page="${data.page-1}">上一页</button><button ${data.page>=maxPage?'disabled':''} data-v55-page="${data.page+1}">下一页</button></div>`;host.querySelectorAll('[data-v55-page]').forEach(button=>button.addEventListener('click',()=>{const page=Number(button.dataset.v55Page||1);if(detailContext&&page>0)void openDetail(detailContext.type,detailContext.tab,detailContext.label,page);}));}
  async function openDetail(type,tab,label,pageNo=1){const host=panel(type),r=range();if(!host||!r.to)return false;detailContext={type,tab,label};host.classList.add('v27-detail-panel');host.innerHTML=`<div class="v27-loading"><b>正在读取 ${esc(label)} 明细…</b><br>卡片数字与明细使用同一V55逐票口径。</div>`;host.scrollIntoView({behavior:'smooth',block:'start'});try{const params=new URLSearchParams({businessType:type,from:r.from,to:r.to,tab,page:String(pageNo),pageSize:'200'});const response=await fetch(`/api/v55/metric-detail?${params}`,{cache:'no-store',credentials:'same-origin'}),data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);renderDetail(host,data,label);return true;}catch(error){host.innerHTML=`<div class="empty-state">明细读取失败：${esc(error.message||error)}</div>`;return false;}}

  function installDirectDrilldown(){
    if(global.__CE_QC_V55_DIRECT_DRILLDOWN__)return;global.__CE_QC_V55_DIRECT_DRILLDOWN__=true;const previousV18=global.openV18MetricDetail;
    global.openV18MetricDetail=function v55OpenV18MetricDetail(type,key,label){const exact=exactType()||String(type||'').toUpperCase(),tab=tabFor(exact,label,key);if(exact&&tab){void openDetail(exact,tab,canonicalLabel(label),1);return false;}if(typeof previousV18==='function')return previousV18.apply(this,arguments);return false;};
    const previousMetric=global.openMetricDetail;global.openMetricDetail=function v55OpenMetricDetail(type,metricKey,label,extra={}){const exact=exactType()||String(type||'').toUpperCase(),tab=tabFor(exact,label,metricKey);if(exact&&tab){void openDetail(exact,tab,canonicalLabel(label),1);return false;}if(typeof previousMetric==='function')return previousMetric.apply(this,arguments);return false;};
    global.addEventListener('click',event=>{const type=exactType();if(!type)return;const card=event.target?.closest?.('.v18-metric-card,.v18-business-card');if(!card)return;const label=cardLabel(card),tab=tabFor(type,label,card.dataset.metric||'');if(!tab)return;event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void openDetail(type,tab,label,1);},true);
  }
  function installObserver(){
    if(global.__CE_QC_V55_OBSERVER__)return;global.__CE_QC_V55_OBSERVER__=true;
    const observer=new MutationObserver(records=>{const relevant=records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(node.matches?.('.v18-business-grid,.v18-core-grid,.v18-dashboard-page')||node.querySelector?.('.v18-business-grid,.v18-core-grid'))));if(relevant&&exactType())scheduleSync();});observer.observe(document.documentElement,{subtree:true,childList:true});
  }
  function install(){installDirectDrilldown();installObserver();if(!installRenderWrapper()){let attempts=0;const timer=setInterval(()=>{attempts++;if(installRenderWrapper()||attempts>40){clearInterval(timer);scheduleSync();}},50);}else scheduleSync();global.addEventListener('popstate',scheduleSync);global.addEventListener('hashchange',scheduleSync);console.info('[CE-QC][DASHBOARD_V55]',VERSION);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
