(function installV252QcLifecycleUi(global){
  if(global.__CE_QC_V252_LIFECYCLE_UI__)return;
  global.__CE_QC_V252_LIFECYCLE_UI__=true;
  const VERSION='2026-08-23-v252-qc-lifecycle-ui-v2';
  const nativeFetch=global.fetch.bind(global);
  let timer=null,rendering=false;
  const num=value=>Number.isFinite(Number(value))?Number(value):0;
  const fmt=value=>Math.round(num(value)).toLocaleString('zh-CN');
  const pct=value=>value===null||value===undefined?'—':`${num(value).toFixed(2)}%`;
  const days=value=>value===null||value===undefined?'—':`${num(value).toFixed(2)}天`;
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const path=()=>String(location.pathname||'/').toLowerCase().replace(/\/+$/,'')||'/';
  const businessType=()=>path()==='/shopeecn'?'SHOPEECN':path()==='/shopeevn'?'SHOPEEVN':'';
  const onHome=()=>path()==='/'||path()==='/home';
  function range(){const to=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);const from=String(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to).slice(0,10);return{from,to};}

  // Old V247/V251 callers omitted regions=. Intercept only this read-only endpoint
  // and default them to lifecycle-only SQL so opening a page never pays the historical
  // PP/PV join. V252 requests that explicitly ask regions=1 remain untouched.
  global.fetch=function v252FastShopeeFetch(input,init){
    try{
      const raw=typeof input==='string'?input:String(input?.url||'');
      if(raw.includes('/api/v246/shopee-trends')&&!/[?&]regions=/.test(raw)){
        const join=raw.includes('?')?'&':'?';const next=`${raw}${join}regions=0`;
        if(typeof input==='string')return nativeFetch(next,init);
        return nativeFetch(new Request(next,input),init);
      }
    }catch{}
    return nativeFetch(input,init);
  };

  async function read(type,{from,to},regions=0,exact=false){
    const q=new URLSearchParams({businessType:type,from,to,regions:String(regions),exact:exact?'1':'0'});
    const response=await nativeFetch(`/api/v246/shopee-trends?${q}`,{cache:'no-store',credentials:'same-origin'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.ok===false)throw new Error(data?.error||`HTTP ${response.status}`);
    return data;
  }
  function latest(data,date=''){const rows=Array.isArray(data?.daily)?data.daily:[];return rows.find(row=>String(row.reportDate||'')===date)||rows.at(-1)||null;}
  function ensureStyle(){if(document.getElementById('v252LifecycleStyle'))return;const style=document.createElement('style');style.id='v252LifecycleStyle';style.textContent=`
    #v252HomeShopeeLifecycle{margin-top:14px}
    #v252HomeShopeeLifecycle .v252-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:14px 16px 10px}
    #v252HomeShopeeLifecycle h2{margin:0;color:#17365d;font-size:19px}
    #v252HomeShopeeLifecycle p{margin:5px 0 0;color:#6d819d;font-size:12px;line-height:1.65}
    #v252HomeShopeeLifecycle .v252-tag{white-space:nowrap;background:#edf5ff;color:#2468d8;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:700}
    #v252HomeShopeeLifecycle .v252-wrap{overflow:auto;padding:0 14px 14px}
    #v252HomeShopeeLifecycle table{width:100%;min-width:1180px;border-collapse:collapse;font-size:13px}
    #v252HomeShopeeLifecycle th,#v252HomeShopeeLifecycle td{padding:11px 10px;border:1px solid #e8eef6;text-align:right;font-variant-numeric:tabular-nums}
    #v252HomeShopeeLifecycle th{background:#f4f8fd;color:#536b88;font-weight:700}
    #v252HomeShopeeLifecycle th:first-child,#v252HomeShopeeLifecycle td:first-child{text-align:left;font-weight:800;color:#1f5fbf}
    #v252HomeShopeeLifecycle .unknown{color:#a16207;font-weight:700}
    #v252HomeShopeeLifecycle .days{color:#6842d9;font-weight:800}
    #v252HomeShopeeLifecycle .ready{color:#16815f}
  `;document.head.appendChild(style);}
  function summaryRow(label,data,date){
    const row=latest(data,date)||{};const pod=num(row.pod),known=num(row.attempt1)+num(row.attempt2)+num(row.attempt3),ready=Boolean(row.ledgerReady);
    return `<tr><td>${esc(label)}</td><td>${fmt(row.total)}</td><td>${fmt(pod)}</td><td>${fmt(row.attempt1)} / ${pct(row.attempt1Rate)}</td><td>${fmt(row.attempt2)} / ${pct(row.attempt2Rate)}</td><td>${fmt(row.attempt3)} / ${pct(row.attempt3Rate)}</td><td class="ready">${pod?pct(row.attemptCoverageRate):'—'} <small>(${fmt(known)}/${fmt(pod)})</small></td><td class="unknown">${fmt(row.attemptUnknown)}</td><td class="days">${days(row.avgPodDays)}</td><td>${pod?`${fmt(row.podDaysCount)}/${fmt(pod)}`:'—'}</td><td>${ready?'已锁定':'账本补齐中'}</td></tr>`;
  }
  function findOldHomeHost(root){for(const h of root.querySelectorAll('h2,h3,h4')){if(/SHOPEE\s*1\s*\/\s*2\s*\/\s*3派|1\s*\/\s*2\s*\/\s*3派.*趋势/.test(String(h.textContent||'')))return h.closest('section')||h.closest('article');}return root.querySelector('#v247HomeShopeeAttempts');}
  function renderHomeSummary(cn,vn,date){
    const root=document.getElementById('homePage');if(!root||root.hidden)return;ensureStyle();
    const existing=root.querySelector('#v252HomeShopeeLifecycle');
    const stale=findOldHomeHost(root);
    if(existing&&stale&&stale!==existing)stale.remove();
    let host=existing||stale;
    if(!host){host=document.createElement('section');const trend=root.querySelector('.v18-trend-section');(trend?.parentNode||root).insertBefore(host,trend?.nextSibling||null);}
    host.id='v252HomeShopeeLifecycle';host.className='v18-panel';host.dataset.v252=VERSION;
    host.innerHTML=`<div class="v252-head"><div><h2>SHOPEE 派次与签收摘要</h2><p>首页只看当前QC结果；7天详细趋势进入 CN/VN 看板。派次来自持续轨迹：70 START → Pending/失败 → 新START；平均签收天数按第一次日报日期 → 实际POD日期（含首尾当天）。</p></div><span class="v252-tag">持续追踪账本</span></div><div class="v252-wrap"><table><thead><tr><th>板块</th><th>首日报成员</th><th>当前POD</th><th>1派签收 / 占POD</th><th>2派签收 / 占POD</th><th>3派+ / 占POD</th><th>派次证据覆盖</th><th>未识别POD</th><th>平均签收天数</th><th>签收天数覆盖</th><th>账本状态</th></tr></thead><tbody>${summaryRow('SHOPEE CN',cn,date)}${summaryRow('SHOPEE VN',vn,date)}</tbody></table></div>`;
  }
  function setDispatchGroup(node,region){if(!node)return;const rates=[region?.attempt1Rate,region?.attempt2Rate,region?.attempt3Rate];[...node.querySelectorAll(':scope > span')].forEach((span,index)=>{const value=rates[index],bar=span.querySelector('i b'),em=span.querySelector('em');if(bar)bar.style.width=value===null||value===undefined?'0%':`${Math.max(0,Math.min(100,num(value)))}%`;if(em)em.textContent=value===null||value===undefined?'—':`${num(value).toFixed(2)}%`;});}
  function renderHomeRegions(cn,vn,date){const root=document.getElementById('homePage');if(!root||root.hidden)return;const c=latest(cn,date),v=latest(vn,date),map={'CN-PP':c?.regions?.PP,'CN-PV':c?.regions?.PV,'VN-PP':v?.regions?.PP,'VN-PV':v?.regions?.PV};root.querySelectorAll('.v18-dispatch-grid > div').forEach(node=>setDispatchGroup(node,map[String(node.querySelector('h3')?.textContent||'').trim()]));}
  async function refreshHome(){const rg=range();if(!onHome()||!rg.to)return;try{const [cn,vn]=await Promise.all([read('SHOPEECN',rg,0,false),read('SHOPEEVN',rg,0,false)]);renderHomeSummary(cn,vn,rg.to);Promise.all([read('SHOPEECN',{from:rg.to,to:rg.to},1,true),read('SHOPEEVN',{from:rg.to,to:rg.to},1,true)]).then(([c,v])=>renderHomeRegions(c,v,rg.to)).catch(error=>console.warn('[CE-QC][V252_HOME_REGION]',error?.message||error));}catch(error){console.warn('[CE-QC][V252_HOME_SUMMARY]',error?.message||error);}}
  async function refreshBusiness(){const type=businessType(),rg=range();if(!type||!rg.to)return;try{const data=await read(type,rg,0,false);const owner=global.__CE_QC_V251_SHOPEE_FINAL_OWNER__;if(owner?.render)owner.render(data);}catch(error){console.warn('[CE-QC][V252_SHOPEE_PAGE]',error?.message||error);}}
  function refresh(){if(rendering)return;rendering=true;Promise.resolve(onHome()?refreshHome():refreshBusiness()).finally(()=>{rendering=false;});}
  function schedule(delay=50){clearTimeout(timer);timer=setTimeout(refresh,delay);}
  function bind(){
    ensureStyle();
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query,#dashboardRangeQuery'))schedule(80);},true);
    document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(100);},true);
    global.addEventListener('popstate',()=>schedule(80));
    const observer=new MutationObserver(records=>{if(rendering)return;const relevant=records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(node.matches?.('#v247HomeShopeeAttempts,.v18-trend-section')||node.querySelector?.('#v247HomeShopeeAttempts,.v18-trend-section'))));if(relevant)schedule(80);});
    if(document.body)observer.observe(document.body,{subtree:true,childList:true});
    [50,300,1200].forEach(ms=>setTimeout(refresh,ms));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V252_LIFECYCLE_UI__={version:VERSION,refresh,read,nativeFetch};
  console.info('[CE-QC][V252_LIFECYCLE_UI]',VERSION,'Shopee pages read regions=0 lifecycle facts; home uses one compact attempt/signing summary and exact-date PP/PV only');
})(window);
