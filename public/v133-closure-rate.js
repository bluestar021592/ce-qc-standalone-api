(function installUnifiedClosureRateV133(global){
  if(global.__CE_QC_V133_CLOSURE_RATE__)return;
  const VERSION='2026-08-23-v239-owner-local-closure-v1';
  const CACHE_KEY='ce_qc_v133_closure_summary';
  const ownerActive=()=>Boolean(global.__CE_QC_V237_DASHBOARD_OWNER__);
  let cached=readCache();
  let inflight=null;

  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const pct=value=>value===null||value===undefined?'—':`${Number(value||0).toFixed(2).replace(/\.00$/,'')}%`;
  function readCache(){try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'null');}catch{return null;}}
  function saveCache(value){try{localStorage.setItem(CACHE_KEY,JSON.stringify(value));}catch{}}
  function selectedDate(){
    const dom=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(dom))return dom;
    try{const value=String(unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate||cached?.reportDate||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;}catch{}
    return String(cached?.reportDate||'').slice(0,10);
  }
  async function fetchSummary(date=''){
    if(ownerActive())return null;
    if(inflight)return inflight;
    const query=date?`?reportDate=${encodeURIComponent(date)}`:'';
    inflight=fetch(`/api/v133/closure-summary${query}`,{cache:'no-store',credentials:'same-origin'})
      .then(async response=>{const payload=await response.json().catch(()=>({}));if(!response.ok||payload?.ok===false)throw new Error(payload?.error||`HTTP ${response.status}`);cached=payload;saveCache(payload);patchVisible(payload);return payload;})
      .catch(error=>{console.warn('[CE-QC][V133_CLOSURE] summary skipped',error);return null;})
      .finally(()=>{inflight=null;});
    return inflight;
  }
  function parseNumber(text){const cleaned=String(text||'').replace(/[^0-9.\-]/g,'');const value=Number(cleaned);return Number.isFinite(value)?value:0;}
  function businessTypeFromPath(){return ({'/ce':'CE','/ceaf':'CEAF','/tbkh':'TBKH','/ali1688':'ALI1688','/shopeecn':'SHOPEECN','/shopeevn':'SHOPEEVN','/whpp':'WHPP'})[location.pathname.toLowerCase()]||'';}
  function closureCardHtml(rateValue,closed,total,complete=true){
    const display=complete?pct(rateValue):'—';
    const note=complete?`已闭环 ${fmt(closed)} / 总票 ${fmt(total)}`:'处理中，待正式快照';
    return `<div class="v18-business-card green v133-closure-card" data-v133-closure="1" role="status"><span>闭环率</span><small>当前比率</small><b>${display}</b><em>${note}</em></div>`;
  }
  function homeMetricHtml(rateValue,closed,total,complete=true){
    const display=complete?pct(rateValue):'—';
    const note=complete?`已闭环 ${fmt(closed)} / 总票 ${fmt(total)}`:'七业务处理中，待正式快照';
    return `<div class="v18-metric-card v133-home-closure-card" data-v133-home-closure="1" role="status"><i aria-hidden="true">●</i><span>总闭环率</span><b>${display}</b><small>${note}</small></div>`;
  }
  function immediateFromModel(model){
    const cards=Array.isArray(model?.cards)?model.cards:[];
    const core=Array.isArray(model?.core)?model.core:[];
    const total=Number(cards[0]?.value||0);
    const unresolvedRow=cards.find(row=>String(row?.label||'').trim()==='当前未闭环')||core.find(row=>String(row?.label||'').trim()==='当前未闭环');
    if(!unresolvedRow&&total>0)return {total,unresolved:0,closed:0,closureRate:null,completed:false};
    const unresolved=Math.max(0,Math.min(total,Number(unresolvedRow?.value||0)));
    const closed=Math.max(0,total-unresolved);
    return {total,unresolved,closed,closureRate:total?Number((closed*100/total).toFixed(2)):0,completed:true};
  }
  function injectBusiness(root,data){
    if(!root)return;
    const grid=root.querySelector('.v18-business-grid');if(!grid)return;
    grid.querySelector('[data-v133-closure="1"]')?.remove();
    grid.insertAdjacentHTML('beforeend',closureCardHtml(data.closureRate,data.closed,data.total,data.completed!==false));
  }
  function injectHome(root,data){
    if(!root)return;
    const grid=root.querySelector('.v18-core-grid');if(!grid)return;
    grid.querySelector('[data-v133-home-closure="1"]')?.remove();
    grid.insertAdjacentHTML('beforeend',homeMetricHtml(data.closureRate,data.closed,data.total,data.completed!==false));
  }
  function patchWhppFromDom(){
    if(location.pathname.toLowerCase()!=='/whpp')return;
    const page=document.getElementById('whppFastPage');if(!page)return;
    const cards=[...page.querySelectorAll('.v18-business-card')];
    const byLabel=label=>cards.find(card=>String(card.querySelector('span')?.textContent||'').trim()===label);
    const total=parseNumber(byLabel('WHPP本土')?.querySelector('b')?.textContent);
    const unresolved=parseNumber(byLabel('当前未闭环')?.querySelector('b')?.textContent);
    const closed=Math.max(0,total-unresolved);
    const summary=ownerActive()?null:cached?.byBusiness?.WHPP;
    const completed=ownerActive()?total>0:(summary?.completed!==false && !/尚未完成独立扫描\/轨迹/.test(String(page.querySelector('.v18-page-heading p')?.textContent||'')));
    const rateValue=summary&&Number(summary.total)===total?summary.closureRate:(total?Number((closed*100/total).toFixed(2)):0);
    injectBusiness(page,{total,closed,closureRate:rateValue,completed});
  }
  function patchVisible(payload=cached){
    if(ownerActive())return;
    const date=selectedDate();if(!payload||date&&payload.reportDate!==date)return;
    if(location.pathname==='/'||location.pathname==='/home')injectHome(document.getElementById('homePage'),payload);
    const type=businessTypeFromPath();
    if(type==='WHPP'){patchWhppFromDom();return;}
    if(type){
      const data=payload.byBusiness?.[type];
      const root=['SHOPEECN','SHOPEEVN'].includes(type)?document.getElementById('shopeePage'):document.getElementById('ccslPage');
      if(data&&root)injectBusiness(root,data);
    }
  }
  function wrapDashboards(){
    if(!global.DashboardV18||global.DashboardV18.__v133ClosureWrapped)return;
    const oldHome=global.DashboardV18.renderHome;
    const oldBusiness=global.DashboardV18.renderBusiness;
    global.DashboardV18.renderHome=function v133RenderHome(root,model){
      const result=oldHome.call(this,root,model);
      if(!ownerActive()){
        if(cached&&(!model?.reportDate||cached.reportDate===String(model.reportDate)))injectHome(root,cached);
        void fetchSummary(String(model?.reportDate||selectedDate()));
      }
      return result;
    };
    global.DashboardV18.renderBusiness=function v133RenderBusiness(root,model){
      const result=oldBusiness.call(this,root,model);
      const type=String(model?.businessType||'').toUpperCase();
      if(ownerActive())injectBusiness(root,immediateFromModel(model));
      else{
        const source=cached?.reportDate===String(model?.reportDate||'')?cached?.byBusiness?.[type]:null;
        injectBusiness(root,source||immediateFromModel(model));
        void fetchSummary(String(model?.reportDate||selectedDate()));
      }
      return result;
    };
    global.DashboardV18.__v133ClosureWrapped=true;
  }
  function scheduleWhppPatch(){[0,80,300].forEach(ms=>setTimeout(patchWhppFromDom,ms));}
  function install(){
    wrapDashboards();
    if(ownerActive()){
      document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page="whpp"]'))scheduleWhppPatch();},true);
      global.addEventListener('popstate',()=>{wrapDashboards();if(location.pathname==='/whpp')scheduleWhppPatch();});
      if(location.pathname==='/whpp')scheduleWhppPatch();
      global.__CE_QC_V133_CLOSURE_RATE__={version:VERSION,fetchSummary,patchVisible,ownerLocal:true};
      console.info('[CE-QC][V239_CLOSURE_LOCAL]',VERSION,'passive /api/v133/closure-summary reads disabled');
      return;
    }
    document.addEventListener('click',event=>{
      if(event.target?.closest?.('.side-link[data-page="whpp"]'))scheduleWhppPatch();
      if(event.target?.closest?.('#topRangeQuery,#dashboardRangeQuery'))setTimeout(()=>void fetchSummary(selectedDate()),40);
    },true);
    global.addEventListener('popstate',()=>{wrapDashboards();setTimeout(()=>{patchVisible();if(location.pathname==='/whpp')scheduleWhppPatch();},30);});
    document.addEventListener('ce-qc-run-complete',()=>setTimeout(()=>void fetchSummary(selectedDate()),80));
    wrapDashboards();patchVisible();void fetchSummary(selectedDate());if(location.pathname==='/whpp')scheduleWhppPatch();
    global.__CE_QC_V133_CLOSURE_RATE__={version:VERSION,fetchSummary,patchVisible};
    console.info('[CE-QC][V133_CLOSURE_RATE]',VERSION);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,30),{once:true});else setTimeout(install,30);
})(window);
