(function installWhppSevenBusinessFastV132(global){
  if(global.__CE_QC_V132_WHPP_FAST__)return;
  const VERSION='2026-09-03-v419-whpp-one-global-range-board-v2';
  const REVISION='2026-09-03-v419-whpp-range-summary-trend-detail-v2';
  const CACHE_KEY='ce_qc_v132_whpp_fast_summary_v419_2';
  let currentSummary=readCache();
  let trendRequest=0,detailRequest=0,rangeTimer=null;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const pct=value=>`${Number(value||0).toFixed(2).replace(/\.00$/,'')}%`;
  const normalizeDate=value=>{const text=String(value||'').trim().replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};
  function readCache(){try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'null');}catch{return null;}}
  function saveCache(value){try{localStorage.setItem(CACHE_KEY,JSON.stringify(value));}catch{}}
  function selectedRange(){
    try{const shared=global.__CE_QC_GLOBAL_PERIOD_RANGE__?.get?.();const from=normalizeDate(shared?.from),to=normalizeDate(shared?.to);if(from&&to&&from<=to)return{from,to,multi:from!==to};}catch{}
    const to=normalizeDate(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||document.getElementById('periodExportTo')?.value);
    const from=normalizeDate(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||document.getElementById('periodExportFrom')?.value||to);
    if(from&&to&&from<=to)return{from,to,multi:from!==to};
    const reportDate=normalizeDate(document.getElementById('reportDate')?.value);if(reportDate)return{from:reportDate,to:reportDate,multi:false};
    try{const value=normalizeDate(unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate||'');if(value)return{from:value,to:value,multi:false};}catch{}
    const cached=normalizeDate(currentSummary?.toDate||currentSummary?.reportDate||'');return cached?{from:normalizeDate(currentSummary?.fromDate)||cached,to:cached,multi:Boolean(currentSummary?.fromDate&&normalizeDate(currentSummary.fromDate)!==cached)}:{from:'',to:'',multi:false};
  }
  function selectedDate(){return selectedRange().to;}
  async function jsonFetch(url,options={}){const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{}if(!response.ok||payload?.ok===false){const error=new Error(payload.error||payload.message||`HTTP ${response.status}`);error.status=response.status;error.code=payload.code||`HTTP_${response.status}`;error.payload=payload;throw error;}return payload;}
  function normalizeRangeSummary(payload,range){
    const m=payload?.whpp||{},regions=m?.regions||{};
    return {ok:true,version:VERSION,reportDate:range.to,fromDate:range.from,toDate:range.to,range:true,snapshotStatus:payload?.snapshotStatus||'',completed:Boolean(payload?.analysisComplete),metrics:m,regions,state:{businessType:'WHPP',reportDate:range.to,periodStart:range.from,periodEnd:range.to,snapshotStatus:payload?.snapshotStatus||'',completed:Boolean(payload?.analysisComplete)},source:'V419_GLOBAL_RANGE_CURRENT_SUMMARY'};
  }
  async function fetchFast(){
    const range=selectedRange();
    if(range.from&&range.to&&range.multi){
      const payload=await jsonFetch(`/api/v234/current-summary?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
      currentSummary=normalizeRangeSummary(payload,range);saveCache(currentSummary);return currentSummary;
    }
    const target=range.to||selectedDate(),query=target?`?reportDate=${encodeURIComponent(target)}`:'';
    const payload=await jsonFetch(`/api/v132/whpp-fast-summary${query}`);currentSummary={...payload,fromDate:target,toDate:target,range:false};saveCache(currentSummary);return currentSummary;
  }
  function canonicalCompleted(data={}){
    if(data.range)return data.completed===true||String(data.snapshotStatus||'').toUpperCase()==='COMPLETED';
    const state=data.state||{},snapshotStatus=String(state.snapshotStatus||data.snapshotStatus||'').toUpperCase(),reportDate=normalizeDate(state.reportDate||data.reportDate||selectedDate()),truth=global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__?.lastTruth||null,truthComplete=Boolean(truth?.complete===true&&normalizeDate(truth?.reportDate)===reportDate);
    return Boolean(state.completed===true||data.completed===true||snapshotStatus==='COMPLETED'||snapshotStatus==='COMPLETED_WITH_RETRY'||truthComplete);
  }
  function scheduleCompletionSync(){[250,800,1800].forEach(ms=>setTimeout(()=>{if(location.pathname!=='/whpp'||!currentSummary)return;if(canonicalCompleted(currentSummary))render(currentSummary);},ms));}
  function ensureNav(){const nav=document.querySelector('.side-nav');if(!nav)return;let button=nav.querySelector('[data-page="whpp"]');if(!button){button=document.createElement('button');button.className='side-link';button.dataset.page='whpp';button.dataset.path='/whpp';button.innerHTML='<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-package"></use></svg><span class="side-label">WHPP本土看板</span>';const anchor=nav.querySelector('[data-page="ali1688"]');if(anchor?.nextSibling)nav.insertBefore(button,anchor.nextSibling);else nav.appendChild(button);}}
  function ensurePage(){let page=document.getElementById('whppFastPage');if(page)return page;page=document.createElement('section');page.id='whppFastPage';page.className='app-page v18-dashboard-page v18-business-page';page.hidden=true;document.querySelector('main.main-content')?.appendChild(page);return page;}
  function activatePage(push=true){ensureNav();const page=ensurePage();document.querySelectorAll('.app-page').forEach(node=>{node.hidden=node!==page;node.classList.toggle('active',node===page);});document.querySelectorAll('.side-link').forEach(node=>node.classList.toggle('active',node.dataset.page==='whpp'));const title=document.getElementById('pageTitle');if(title)title.textContent='WHPP本土看板';try{currentPage='whpp';}catch{}if(push&&location.pathname!=='/whpp')history.pushState({page:'whpp'},'', '/whpp');return page;}
  function share(value,total){return `占本业务 ${total?(Number(value||0)*100/Number(total)).toFixed(2):'0.00'}%`;}
  function topCard(label,value,unit,total,key,tone='blue',rangeMode=false){const display=unit==='%'?pct(value):fmt(value),timeLabel=rangeMode?'区间票数':'今日票数';return `<button class="v18-business-card ${tone}" data-whpp-tab="${esc(key)}" onclick="window.openWhppV132Detail('${esc(key)}','')"><span>${esc(label)}</span><small>${unit==='%'?'当前比率':timeLabel}</small><b>${display}</b><em>${label==='WHPP本土'?'占本业务 100.00%':unit==='%'?`当前比率 ${display}`:share(value,total)}</em></button>`;}
  function metric(label,value,total,key,unit='件'){return `<button class="v18-metric-card" data-whpp-tab="${esc(key)}" onclick="window.openWhppV132Detail('${esc(key)}','')"><i aria-hidden="true">●</i><span>${esc(label)}</span><b>${unit==='%'?pct(value):fmt(value)}</b><small>${unit==='%'?`当前比率 ${pct(value)}`:share(value,total)}</small></button>`;}
  function regionBlock(label,code,row={},rangeMode=false){const incomplete=rangeMode&&row?.ready===false,first=rangeMode?'区间件数':'今日件数',items=[[first,row.total,'all'],['签收率',pct(row.podRate),'pod'],['签收件数',row.pod,'pod'],['Pending1+',row.pending1,'pending1'],['Pending2+',row.pending2,'pending2'],['Pending3+',row.pending3,'pending3'],['OC1+',row.oc1,'oc1'],['OC2+',row.oc2,'oc2'],['OC3+',row.oc3,'oc3'],['已退回件',row.returned,'returned'],['当前未闭环',row.unresolved,'unresolved']];return `<section class="region-block" data-region="${code}"><h4>${esc(label)}</h4><div>${items.map(([name,value,key])=>`<button type="button" data-whpp-tab="${key}" data-whpp-region="${code}" onclick="window.openWhppV132Detail('${key}','${code}')"><span>${esc(name)}</span><b>${incomplete?'—':typeof value==='string'?esc(value):fmt(value)}</b></button>`).join('')}</div>${incomplete?'<small>历史PP/PV区域证据不完整，暂不显示可能失真的0值</small>':''}</section>`;}
  function chartModel(title,type,dates,values,oc=false){return {title,type,oc,dates:Array.isArray(dates)?dates:[],series:[{name:'WHPP',values:(Array.isArray(values)?values:[]).map(value=>value===null||value===undefined?null:Number(value))}]};}
  async function mountTrends(retry=0){
    const host=document.getElementById('v152WhppTrend');if(!host||location.pathname!=='/whpp')return;const request=++trendRequest,range=selectedRange();if(!range.from||!range.to)return;
    try{const data=await jsonFetch(`/api/v234/trends?businessType=WHPP&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);if(request!==trendRequest||!host.isConnected)return;const renderer=global.RateTrendCardV18?.render;if(typeof renderer!=='function'){if(retry<8)setTimeout(()=>mountTrends(retry+1),250);return;}const dates=Array.isArray(data.dates)?data.dates:[];const charts=[chartModel('票数趋势','count',dates,data.ticket||[]),chartModel('POD率趋势','rate',dates,data.podRate||[]),chartModel('OC率趋势','rate',dates,data.ocRate||[],true),chartModel('退回率趋势','rate',dates,data.returnRate||[])];host.innerHTML=`<h2>趋势图表</h2><section class="v18-chart-grid">${charts.map((_,index)=>`<article class="v18-chart-card" data-chart-index="${index}"></article>`).join('')}</section>`;host.querySelectorAll('.v18-chart-card').forEach((node,index)=>renderer(node,charts[index]));}catch(error){if(request===trendRequest&&host.isConnected)host.innerHTML=`<h2>趋势图表</h2><div class="empty-state">趋势读取失败：${esc(error.message||error)}</div>`;}
  }
  function render(payload=currentSummary,note=''){
    const page=activatePage(false);if(!page)return;const data=payload||{},range=selectedRange(),rangeMode=Boolean(data.range||range.multi),m=data.metrics||{},regions=data.regions||{},total=Number(m.total||data.total||0),completed=canonicalCompleted(data);
    const span=rangeMode?`${esc(data.fromDate||range.from||'—')} ~ ${esc(data.toDate||range.to||'—')}`:`${esc(data.reportDate||range.to||'—')}`;
    const regionCoverageNote=rangeMode&&m.regionCoverageComplete===false?' · 历史PP/PV区域证据不完整，区域暂以—显示':'';
    const statusText=(rangeMode?`区间 ${span} · WHPP与全局日期范围一致 · ${completed?'当前已保存结果':'部分日期仍待完成'}`:completed?`日报 ${span} · 当前业务正式结果已保存`:total>0?`日报 ${span} · WHPP已从同一份日报分类 ${fmt(total)} 票，等待统一七业务流程自动进入本土阶段。`:`日报 ${span} · 当前无WHPP本土数据`)+regionCoverageNote;
    const podLabel=rangeMode?'区间POD':'今日POD';
    const top=[['WHPP本土',total,'件','all','purple'],[podLabel,m.pod,'件','pod','blue'],['POD率',m.podRate,'%','pod','blue'],['已退回件',m.returned,'件','returned','blue'],['订单取消',m.cancelled,'件','cancelled','blue'],['当前未闭环',m.unresolved,'件','unresolved','blue']];
    const core=[['Pending不连续',m.pendingNonContinuous,'pendingNonContinuous'],['Pending1+',m.pending1,'pending1'],['Pending2+',m.pending2,'pending2'],['Pending3+',m.pending3,'pending3'],['OC1+',m.oc1,'oc1'],['OC2+',m.oc2,'oc2'],['OC3+',m.oc3,'oc3'],['盘点2天+',m.cycle2,'cycle2'],['入库无扫描',m.inboundNoScan,'inboundNoScan'],['已退回件',m.returned,'returned'],['当前未闭环',m.unresolved,'unresolved'],['派送中',m.delivery??m.deliveryStay,'delivery'],['CCSLCN',m.ccslCnDiversion,'ccslCnDiversion'],['CEZT',m.ccslZtDiversion,'ccslZtDiversion'],['CCSL580',m.ccsl580Retention,'ccsl580Retention'],['金边门店',m.phnomPenhShop,'phnomPenhShop'],['外省门店',m.provinceShop,'provinceShop']];
    page.innerHTML=`<section class="v18-page-heading"><div><h2>WHPP本土看板</h2><p>${statusText}</p></div></section>${note?`<div class="processing-notice running"><b>状态</b><span>${esc(note)}</span></div>`:''}<section class="v18-business-grid">${top.map(([label,value,unit,key,tone])=>topCard(label,value,unit,total,key,tone,rangeMode)).join('')}</section><section class="v18-panel v18-core"><h2>核心指标</h2><div class="v18-core-grid">${core.map(([label,value,key])=>metric(label,value,total,key)).join('')}</div></section><section class="v18-panel"><h2>区域</h2><div class="region-summary-grid">${regionBlock('本省（PP）','PP',regions.PP||{},rangeMode)}${regionBlock('外省（PV）','PV',regions.PV||{},rangeMode)}</div></section><section id="v152WhppTrend" class="v18-panel v18-trend-section"><h2>趋势图表</h2><div class="empty-state">正在读取所选区间趋势…</div></section><section id="whppV132Detail" class="panel v18-detail-preview" hidden></section>`;
    page.querySelectorAll('[data-whpp-tab]').forEach(button=>{button.style.cursor='pointer';button.title='点击查看所选日期范围对应逐票明细';});void mountTrends();
  }
  async function navigate(push=true){activatePage(push);const range=selectedRange(),cached=currentSummary&&normalizeDate(currentSummary.toDate||currentSummary.reportDate)===range.to&&normalizeDate(currentSummary.fromDate||currentSummary.reportDate)===range.from?currentSummary:null;if(cached)render(cached,'正在后台校验所选日期范围最新WHPP摘要…');else ensurePage().innerHTML='<div class="empty-state">正在读取WHPP范围摘要…</div>';try{render(await fetchFast());}catch(error){if(cached)render(cached,`最新摘要读取失败：${error.message}`);else ensurePage().innerHTML=`<div class="empty-state">WHPP读取失败：${esc(error.message)}</div>`;}scheduleCompletionSync();}
  function detailFields(rows){const preferred=['reportMembershipDate','shipmentCode','regionCode','primaryCategory','currentState','POD状态','退回状态','Pending当前次数','OC天数','latestEventTime','最后节点'];const found=preferred.filter(field=>rows.some(row=>row?.[field]!==undefined));return found.length?found:Object.keys(rows[0]||{}).slice(0,12);}
  async function openDetail(tab='all',region=''){
    const host=document.getElementById('whppV132Detail');if(!host)return;const request=++detailRequest;host.hidden=false;host.innerHTML='<div class="empty-state">正在读取对应明细…</div>';host.scrollIntoView({behavior:'smooth',block:'start'});
    try{const range=selectedRange(),params=new URLSearchParams({from:range.from,to:range.to,tab:tab||'all',region:region||'',page:'1',pageSize:'500'});const payload=await jsonFetch(`/api/v172/whpp-metric-detail?${params}`);if(request!==detailRequest)return;const rows=Array.isArray(payload.rows)?payload.rows:[];if(!rows.length){host.innerHTML=`<div class="empty-state">${esc(payload.label||tab)} 当前日期范围没有匹配明细</div>`;return;}const fields=detailFields(rows);host.innerHTML=`<div class="panel-title"><h3>${esc(payload.label||tab)}</h3><span>${esc(payload.fromDate||range.from)} ~ ${esc(payload.toDate||range.to)} · ${fmt(payload.total)}票</span></div><div class="preview-table-wrap"><table class="preview-table"><thead><tr>${fields.map(field=>`<th>${esc(field==='reportMembershipDate'?'日报成员日期':field)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${fields.map(field=>`<td>${esc(row?.[field]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}catch(error){if(request===detailRequest)host.innerHTML=`<div class="empty-state">明细读取失败：${esc(error.message)}</div>`;}
  }
  function scheduleRangeReload(){clearTimeout(rangeTimer);rangeTimer=setTimeout(()=>{if(location.pathname==='/whpp')void navigate(false);},140);}
  function install(){
    ensureNav();global.navigateWhppPage=()=>navigate(true);global.openWhppV132Detail=(tab,region='')=>openDetail(tab,region);
    document.addEventListener('click',event=>{const whpp=event.target?.closest?.('.side-link[data-page="whpp"]');if(whpp){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void navigate(true);return;}if(event.target?.closest?.('#topRangeQuery,.top-range-query,#dashboardRangeQuery'))scheduleRangeReload();},true);
    document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo,#periodExportFrom,#periodExportTo'))scheduleRangeReload();},true);
    global.addEventListener('popstate',()=>{if(location.pathname==='/whpp')void navigate(false);});
    document.addEventListener('ce-qc-run-complete',()=>{void fetchFast().then(value=>{if(location.pathname==='/whpp'){render(value);scheduleCompletionSync();}}).catch(()=>{});});
    if(location.pathname==='/whpp')void navigate(false);
    global.__CE_QC_V132_WHPP_FAST__={version:VERSION,revision:REVISION,displayOnly:true,authoritativeRunner:'V67',navigate,fetchSummary:fetchFast,selectedDate,selectedRange,openDetail,mountTrends,canonicalCompleted};
    console.info('[CE-QC][V132_WHPP_GLOBAL_RANGE]',REVISION,'WHPP cards, regions, trends and drilldowns follow the same global from/to range as HOME and all other business boards; incomplete historical PP/PV region evidence renders dash instead of fake zero; single-day fast path remains available.');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,20),{once:true});else setTimeout(install,20);
})(window);