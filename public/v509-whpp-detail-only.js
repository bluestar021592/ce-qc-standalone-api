(function installV509WhppDetailOnly(global){
  if(global.__CE_QC_V509_WHPP_DETAIL_ONLY__)return;
  const VERSION='2026-09-13-v509-whpp-detail-only-v1';
  let observer=null,observed=null,detailRequest=0;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const page=()=>document.getElementById('whppFastPage');
  const dateNow=()=>String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||new Date().toISOString().slice(0,10)).slice(0,10);
  const mapLabel={'WHPP本土':'all','今日POD':'pod','POD率':'pod','签收率':'pod','签收件数':'pod','已退回件':'returned','退回率':'returned','订单取消':'cancelled','取消率':'cancelled','当前未闭环':'unresolved','Pending不连续':'pendingNonContinuous','Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3','OC1+':'oc1','OC2+':'oc2','OC3+':'oc3','盘点2天+':'cycle2','入库无扫描':'inboundNoScan','派送中':'delivery','CCSLCN':'ccslCnDiversion','CEZT':'ccslZtDiversion','CCSL580':'ccsl580Retention','金边门店':'phnomPenhShop','外省门店':'provinceShop','今日件数':'all'};

  async function jsonFetch(url){const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});const text=await response.text();let body={};try{body=text?JSON.parse(text):{};}catch{}if(!response.ok||body.ok===false)throw new Error(body.error||body.message||`HTTP ${response.status}`);return body;}
  function hideEmptyDetail(){const host=document.getElementById('whppV132Detail');if(!host)return;const hasTable=Boolean(host.querySelector('table'));const text=String(host.textContent||'').trim();if(!hasTable&&(!text||/点击上方指标查看对应明细/.test(text)))host.hidden=true;}
  function keyFromInline(button){const text=String(button?.getAttribute?.('onclick')||'');return text.match(/openWhppV132Detail\(\s*['"]([^'"]+)['"]\s*\)/)?.[1]||'';}
  function regionContext(button){const block=button?.closest?.('.region-block');if(!block)return {region:'',tab:''};const title=String(block.querySelector('h4')?.textContent||'');const region=/本省|PP/.test(title)?'PP':/外省|PV/.test(title)?'PV':'';const label=String(button.querySelector('span')?.textContent||'').trim();return {region,tab:mapLabel[label]||''};}
  function cardContext(button){const scoped=regionContext(button);if(scoped.tab)return scoped;const label=String(button.querySelector('.v18-metric-label')?.textContent||button.querySelector('span')?.textContent||'').trim();return {region:'',tab:keyFromInline(button)||mapLabel[label]||''};}
  function detailFields(rows){const preferred=['shipmentCode','regionCode','primaryCategory','currentState','POD状态','退回状态','Pending当前次数','OC天数','latestEventTime','最后节点'];const found=preferred.filter(key=>rows.some(row=>row?.[key]!==undefined));return found.length?found:Object.keys(rows[0]||{}).slice(0,10);}
  function detailTable(payload,tab){const rows=Array.isArray(payload.rows)?payload.rows:[];if(!rows.length)return `<div class="empty-state">${esc(payload.label||tab)} 当前没有匹配明细</div>`;const fields=detailFields(rows);const header=fields.map(f=>`<th>${esc(f)}</th>`).join('');const body=rows.map(row=>`<tr>${fields.map(f=>`<td>${esc(row?.[f]??'—')}</td>`).join('')}</tr>`).join('');return `<div class="panel-title"><h3>${esc(payload.label||tab)}</h3><span>${fmt(payload.total)}票</span></div><div class="preview-table-wrap"><table class="preview-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;}
  async function openDetail(tab='all',region=''){const host=document.getElementById('whppV132Detail');if(!host)return;const request=++detailRequest;host.hidden=false;host.innerHTML='<div class="empty-state">正在读取对应明细…</div>';host.scrollIntoView({behavior:'smooth',block:'start'});try{const params=new URLSearchParams({reportDate:dateNow(),tab:tab||'all',region:region||'',page:'1',pageSize:'300'});const payload=await jsonFetch(`/api/v172/whpp-metric-detail?${params}`);if(request!==detailRequest)return;host.innerHTML=detailTable(payload,tab);host.scrollIntoView({behavior:'smooth',block:'start'});}catch(error){if(request===detailRequest){host.innerHTML=`<div class="empty-state">明细读取失败：${esc(error.message||error)}</div>`;host.scrollIntoView({behavior:'smooth',block:'start'});}}}
  function onClick(event){if(location.pathname!=='/whpp')return;const root=page();if(!root||root.hidden)return;const button=event.target?.closest?.('#whppFastPage .v18-business-card,#whppFastPage .v18-metric-card,#whppFastPage .region-block button');if(!button)return;const {tab,region}=cardContext(button);if(!tab)return;event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void openDetail(tab,region);}
  function normalize(){const root=page();if(!root)return;root.querySelectorAll('.v18-business-card,.v18-metric-card,.region-block button').forEach(button=>{button.style.cursor='pointer';button.title='点击查看对应明细';});document.getElementById('v152WhppTrend')?.remove();hideEmptyDetail();}
  function observe(){const root=page();if(!root||root===observed)return;observer?.disconnect?.();observed=root;observer=new MutationObserver(()=>{if(location.pathname==='/whpp')normalize();});observer.observe(root,{childList:true,subtree:true});}
  function burst(){if(location.pathname!=='/whpp')return;normalize();observe();setTimeout(normalize,300);}

  global.openWhppV132Detail=tab=>openDetail(tab,'');
  global.addEventListener('click',onClick,true);
  global.addEventListener('popstate',burst);
  document.addEventListener('click',event=>{if(event.target?.closest?.('[data-page="whpp"],#topRangeQuery,#dashboardRangeQuery'))setTimeout(burst,40);});
  document.addEventListener('ce-qc-run-complete',()=>setTimeout(burst,60));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',burst,{once:true});else burst();
  global.__CE_QC_V509_WHPP_DETAIL_ONLY__={version:VERSION,refresh:burst,openDetail};
  console.info('[CE-QC][V509_WHPP_DETAIL_ONLY]',VERSION,'WHPP metric drill-down retained; all live trend rendering/fetching removed.');
})(window);
