(function installV172WhppDashboardParity(global){
  if(global.__CE_QC_V172_WHPP_DASHBOARD_PARITY__)return;
  const VERSION='2026-08-17-v172-whpp-dashboard-parity-v1';
  let trendTimer=null,lastTrendKey='',lastTrendAt=0,lastTrend=null,observer=null,observed=null,detailRequest=0;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const page=()=>document.getElementById('whppFastPage');
  const dateNow=()=>String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||global.__CE_QC_V132_WHPP_FAST__?.reportDate||new Date().toISOString().slice(0,10)).slice(0,10);
  const mapLabel={
    'WHPP本土':'all','今日POD':'pod','POD率':'pod','签收率':'pod','签收件数':'pod','已退回件':'returned','退回率':'returned','订单取消':'cancelled','取消率':'cancelled','当前未闭环':'unresolved',
    'Pending不连续':'pendingNonContinuous','Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3','OC1+':'oc1','OC2+':'oc2','OC3+':'oc3','盘点2天+':'cycle2','入库无扫描':'inboundNoScan','派送中':'delivery','CCSLCN':'ccslCnDiversion','CEZT':'ccslZtDiversion','CCSL580':'ccsl580Retention','金边门店':'phnomPenhShop','外省门店':'provinceShop','今日件数':'all'
  };
  function jsonFetch(url){return fetch(url,{cache:'no-store',credentials:'same-origin'}).then(async response=>{const text=await response.text();let body={};try{body=text?JSON.parse(text):{};}catch{}if(!response.ok||body.ok===false)throw new Error(body.error||body.message||`HTTP ${response.status}`);return body;});}
  function chart(title,type,dates,values,oc=false){return {title,type,oc,dates:Array.isArray(dates)?dates:[],series:[{name:'WHPP',values:(Array.isArray(values)?values:[]).map(v=>Number(v||0))}]};}
  async function loadTrend(){const key=dateNow();if(lastTrend&&lastTrendKey===key&&Date.now()-lastTrendAt<10000)return lastTrend;const body=await jsonFetch(`/api/v171/whpp-trends?reportDate=${encodeURIComponent(key)}`);lastTrend=body;lastTrendKey=key;lastTrendAt=Date.now();return body;}
  function ensureTrendHost(){const root=page();if(!root)return null;let section=document.getElementById('v152WhppTrend');if(!section){section=document.createElement('section');section.id='v152WhppTrend';}section.className='v18-panel v18-trend-section';const detail=document.getElementById('whppV132Detail');const region=[...root.querySelectorAll('.v18-panel')].find(node=>node.querySelector(':scope > h2')?.textContent?.trim()==='区域');if(detail?.parentNode===root)root.insertBefore(section,detail);else if(region?.nextSibling)root.insertBefore(section,region.nextSibling);else root.appendChild(section);return section;}
  function hideEmptyDetail(){const host=document.getElementById('whppV132Detail');if(!host)return;const hasTable=Boolean(host.querySelector('table'));const text=String(host.textContent||'').trim();if(!hasTable&&(!text||/点击上方指标查看对应明细/.test(text)))host.hidden=true;}
  function renderTrend(data){const root=page();if(!root||root.hidden||location.pathname!=='/whpp')return;const section=ensureTrendHost();if(!section)return;const dates=Array.isArray(data?.dates)?data.dates:[];const charts=[chart('今日票数趋势','count',dates,data?.ticket||[]),chart('POD率趋势','rate',dates,data?.podRate||[]),chart('OC率趋势','rate',dates,data?.ocRate||[],true),chart('退回率趋势','rate',dates,data?.returnRate||[])];section.innerHTML=`<h2>趋势图表</h2><section class="v18-chart-grid">${charts.map((_,i)=>`<article class="v18-chart-card" data-chart-index="${i}"></article>`).join('')}</section>`;const renderer=global.RateTrendCardV18?.render;if(typeof renderer!=='function'){section.innerHTML='<h2>趋势图表</h2><div class="empty-state">趋势组件正在加载…</div>';return false;}section.querySelectorAll('.v18-chart-card').forEach((node,i)=>renderer(node,charts[i]));hideEmptyDetail();return true;}
  async function refreshTrend(){if(location.pathname!=='/whpp')return;try{const ok=renderTrend(await loadTrend());if(ok===false)setTimeout(refreshTrend,300);}catch(error){const section=ensureTrendHost();if(section)section.innerHTML=`<h2>趋势图表</h2><div class="empty-state">趋势读取失败：${esc(error.message||error)}</div>`;}}
  function scheduleTrend(ms=80){clearTimeout(trendTimer);trendTimer=setTimeout(refreshTrend,ms);}

  function keyFromInline(button){const text=String(button?.getAttribute?.('onclick')||'');return text.match(/openWhppV132Detail\(\s*['"]([^'"]+)['"]\s*\)/)?.[1]||'';}
  function regionContext(button){const block=button?.closest?.('.region-block');if(!block)return {region:'',tab:''};const title=String(block.querySelector('h4')?.textContent||'');const region=/本省|PP/.test(title)?'PP':/外省|PV/.test(title)?'PV':'';const label=String(button.querySelector('span')?.textContent||'').trim();return {region,tab:mapLabel[label]||''};}
  function cardContext(button){const region=regionContext(button);if(region.tab)return region;const label=String(button.querySelector('.v18-metric-label')?.textContent||button.querySelector('span')?.textContent||'').trim();return {region:'',tab:keyFromInline(button)||mapLabel[label]||''};}
  function detailFields(rows){const preferred=['shipmentCode','regionCode','primaryCategory','currentState','POD状态','退回状态','Pending当前次数','OC天数','latestEventTime','最后节点'];return preferred.filter(key=>rows.some(row=>row?.[key]!==undefined));}
  async function openDetail(tab='all',region=''){
    const host=document.getElementById('whppV132Detail');if(!host)return;const request=++detailRequest;host.hidden=false;host.innerHTML='<div class="empty-state">正在读取对应明细…</div>';host.scrollIntoView({behavior:'smooth',block:'start'});
    try{const params=new URLSearchParams({reportDate:dateNow(),tab:tab||'all',region:region||'',page:'1',pageSize:'300'});const payload=await jsonFetch(`/api/v172/whpp-metric-detail?${params}`);if(request!==detailRequest)return;const rows=Array.isArray(payload.rows)?payload.rows:[],fields=detailFields(rows);host.innerHTML=rows.length?`<div class="panel-title"><h3>${esc(payload.label||tab)}</h3><span>${fmt(payload.total)}票</span></div><div class="preview-table-wrap"><table class="preview-table"><thead><tr>${fields.map(f=>`<th>${esc(f)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${fields.map(f=>`<td>${esc(row?.[f]??'—')}</td>`).join('')}</tbody></table></div>`:`<div class="empty-state">${esc(payload.label||tab)} 当前没有匹配明细</div>`;host.scrollIntoView({behavior:'smooth',block:'start'});}catch(error){if(request===detailRequest){host.innerHTML=`<div class="empty-state">明细读取失败：${esc(error.message||error)}</div>`;host.scrollIntoView({behavior:'smooth',block:'start'});}}
  }
  function onClick(event){if(location.pathname!=='/whpp')return;const root=page();if(!root||root.hidden)return;const button=event.target?.closest?.('#whppFastPage .v18-business-card,#whppFastPage .v18-metric-card,#whppFastPage .region-block button');if(!button)return;const {tab,region}=cardContext(button);if(!tab)return;event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void openDetail(tab,region);}
  function normalize(){const root=page();if(!root)return;root.querySelectorAll('.v18-business-card,.v18-metric-card,.region-block button').forEach(button=>{button.style.cursor='pointer';button.title='点击查看对应明细';});hideEmptyDetail();ensureTrendHost();}
  function observe(){const root=page();if(!root||root===observed)return;observer?.disconnect?.();observed=root;observer=new MutationObserver(()=>{if(location.pathname!=='/whpp')return;normalize();if(!document.getElementById('v152WhppTrend')||!document.querySelector('#v152WhppTrend .v18-chart-grid'))scheduleTrend(50);});observer.observe(root,{childList:true,subtree:true});}
  function burst(){if(location.pathname!=='/whpp')return;normalize();observe();scheduleTrend(50);setTimeout(()=>{normalize();scheduleTrend(0);},350);setTimeout(()=>{normalize();scheduleTrend(0);},1000);}
  global.openWhppV132Detail=(tab)=>openDetail(tab,'');
  global.addEventListener('click',onClick,true);
  global.addEventListener('popstate',burst);
  document.addEventListener('click',event=>{if(event.target?.closest?.('[data-page="whpp"],#topRangeQuery,#dashboardRangeQuery'))setTimeout(burst,40);});
  document.addEventListener('ce-qc-run-complete',()=>{lastTrendAt=0;setTimeout(burst,60);});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',burst,{once:true});else burst();
  global.__CE_QC_V172_WHPP_DASHBOARD_PARITY__={version:VERSION,refresh:burst,openDetail};
  console.info('[CE-QC][V172_WHPP_DASHBOARD_PARITY]',VERSION);
})(window);
