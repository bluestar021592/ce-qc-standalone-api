(function installInstantBusinessNavigationV166(global){
  if(global.__CE_QC_V109_INSTANT_BUSINESS_NAV__)return;
  const VERSION='2026-08-21-v205-ceaf-prepaint-navigation-v1';
  const GOLIVE_COMPAT_VERSION='2026-08-17-v166-summary-first-navigation-throttle-v1';
  const original=global.hydratePageData;
  if(typeof original!=='function')return;
  const pending=new Map();
  const lastHydratedAt=new Map();
  const typeByPage={ce:'CE',ceaf:'CEAF',tbkh:'TBKH',ali1688:'ALI1688',shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN'};
  const MIN_BACKGROUND_HYDRATE_MS=60_000;
  const FAST_SUMMARY_CACHE='ce_qc_v89_instant_dashboard';
  const CEAF_EXACT_CACHE='ce_qc_v205_ceaf_exact_state';

  function currentSelectedDate(){
    try{return String(historyModeDate||unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate||'').slice(0,10);}catch{return '';}
  }
  function selectedSnapshotId(){
    const date=currentSelectedDate();
    try{
      const historical=(historyCatalog?.UNIFIED||[]).find(row=>String(row?.reportDate||'').slice(0,10)===date);
      if(historical?.snapshotId)return String(historical.snapshotId);
      if(String(unifiedImportState?.reportDate||'').slice(0,10)===date&&unifiedImportState?.snapshotId)return String(unifiedImportState.snapshotId);
      if(businessStates?.CEAF?.snapshotId)return String(businessStates.CEAF.snapshotId);
    }catch{}
    return '';
  }
  function snapshotKey(page){
    const type=typeByPage[String(page||'')];
    let snapshot='';
    try{snapshot=String(businessStates?.[type]?.snapshotId||selectedSnapshotId()||'');}catch{}
    return `${page}|${currentSelectedDate()}|${snapshot}`;
  }
  function canUseSummary(page){
    const type=typeByPage[String(page||'')];
    if(!type)return false;
    try{
      if(dashboardPeriodMode)return false;
      const state=businessStates?.[type];
      const date=currentSelectedDate();
      return Boolean(state?.dashboard&&date&&String(state.reportDate||'').slice(0,10)===date);
    }catch{return false;}
  }
  function cachedFastSummary(){
    try{
      const value=JSON.parse(localStorage.getItem(FAST_SUMMARY_CACHE)||'null');
      const date=currentSelectedDate();
      return value?.reportDate&&String(value.reportDate).slice(0,10)===date?value:null;
    }catch{return null;}
  }
  function readExactCeafCache(){
    try{
      const value=JSON.parse(localStorage.getItem(CEAF_EXACT_CACHE)||'null');
      const state=value?.state||value;
      const date=currentSelectedDate();
      const snapshotId=selectedSnapshotId();
      if(!state||String(state.reportDate||'').slice(0,10)!==date)return null;
      if(snapshotId&&state.snapshotId&&String(state.snapshotId)!==snapshotId)return null;
      return state;
    }catch{return null;}
  }
  function saveExactCeafCache(state){
    try{if(state?.reportDate)localStorage.setItem(CEAF_EXACT_CACHE,JSON.stringify({savedAt:Date.now(),state}));}catch{}
  }
  function visibleCeafCount(){
    try{
      const cards=[...document.querySelectorAll('.v18-business-card')];
      const card=cards.find(node=>/CEAF/i.test(String(node.querySelector('span')?.textContent||'')));
      if(!card)return null;
      const value=Number(String(card.querySelector('b')?.textContent||'').replace(/[,\s]/g,''));
      return Number.isFinite(value)&&value>=0?value:null;
    }catch{return null;}
  }
  function expectedCeafCount(){
    try{
      const direct=Number(unifiedImportState?.classificationCounts?.CEAF);
      if(Number.isFinite(direct)&&direct>=0)return direct;
    }catch{}
    const summary=cachedFastSummary();
    const cached=Number(summary?.counts?.CEAF);
    if(Number.isFinite(cached)&&cached>=0)return cached;
    return visibleCeafCount();
  }
  function stateTotal(state={}){
    const values=[state.dailyParseSummary?.totalRecognized,state.dashboard?.pnh,state.dashboard?.totalMonitored,state.sourceTotal,state.total];
    for(const value of values){const n=Number(value);if(Number.isFinite(n)&&n>=0)return n;}
    return Array.isArray(state.pnhBills)?state.pnhBills.length:0;
  }
  function seedCeafBeforeNavigation(){
    if(typeof businessStates==='undefined'||dashboardPeriodMode)return false;
    const date=currentSelectedDate();
    if(!date)return false;
    const expected=expectedCeafCount();
    const exact=readExactCeafCache();
    if(exact&&(!Number.isFinite(expected)||stateTotal(exact)===expected)){
      businessStates.CEAF={...exact,__v205CeafPrepaintExact:true};
      return true;
    }
    if(!Number.isFinite(expected)||expected<0)return false;
    const current=businessStates.CEAF||{};
    const snapshotId=selectedSnapshotId()||String(cachedFastSummary()?.snapshotId||current.snapshotId||'');
    if(String(current.reportDate||'').slice(0,10)===date&&stateTotal(current)===expected&&current.dashboard)return false;
    const seeded={
      ...current,
      businessType:'CEAF',viewBusinessType:'CEAF',reportDate:date,snapshotId,
      dailyReportReady:expected>0||Boolean(current.dailyReportReady),
      sourceTotal:expected,total:expected,
      dailyParseSummary:{...(current.dailyParseSummary||{}),totalRecognized:expected,pnh:expected},
      dashboard:{...(current.dashboard||{}),pnh:expected,totalMonitored:expected},
      v55Summary:{...(current.v55Summary||{}),total:expected,__source:'V205_CEAF_PREPAINT_SOURCE_TOTAL'},
      __v204CeafSeeded:true,__v205CeafPrepaint:true
    };
    businessStates.CEAF=seeded;
    return true;
  }
  function seedCeafFromFastSummary(page){
    return String(page||'').toLowerCase()==='ceaf'?seedCeafBeforeNavigation():false;
  }
  async function hydrateCeafFast(){
    const date=currentSelectedDate();
    const snapshotId=selectedSnapshotId();
    const params=new URLSearchParams();
    if(snapshotId)params.set('snapshotId',snapshotId);
    else if(date)params.set('reportDate',date);
    const response=await fetch(`/api/v204/ceaf-fast-state?${params.toString()}`,{cache:'no-store',credentials:'same-origin'});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload?.ok===false)throw new Error(payload?.error||`HTTP ${response.status}`);
    if(payload?.state&&typeof businessStates!=='undefined'){
      const exact={...payload.state,__v204CeafExact:true,__v205CeafExact:true};
      businessStates.CEAF=exact;
      saveExactCeafCache(exact);
      if(String(typeof currentPage!=='undefined'?currentPage:'').toLowerCase()==='ceaf'&&typeof global.renderAll==='function')global.renderAll();
    }
    return payload;
  }
  function backgroundHydrate(page,force=false){
    const target=String(page||'');
    const key=snapshotKey(target);
    if(pending.has(key))return pending.get(key);
    if(!force&&Date.now()-Number(lastHydratedAt.get(key)||0)<MIN_BACKGROUND_HYDRATE_MS){
      return Promise.resolve({ok:true,skipped:true,source:'V205_HYDRATE_THROTTLE'});
    }
    const run=()=>Promise.resolve(target==='ceaf'?hydrateCeafFast():original(target))
      .then(value=>{lastHydratedAt.set(key,Date.now());return value;})
      .catch(error=>{console.warn('[CE-QC][V205_BACKGROUND_HYDRATE]',target,error);return null;})
      .finally(()=>pending.delete(key));
    const promise=new Promise(resolve=>{
      const start=()=>resolve(run());
      if(target==='ceaf')queueMicrotask(start);
      else if('requestIdleCallback'in global)global.requestIdleCallback(start,{timeout:1800});
      else setTimeout(start,400);
    }).then(value=>value);
    pending.set(key,promise);
    return promise;
  }

  global.hydratePageData=function v205SummaryFirstHydrate(page){
    const target=String(page||'');
    const seeded=seedCeafFromFastSummary(target);
    if(seeded&&String(typeof currentPage!=='undefined'?currentPage:'').toLowerCase()==='ceaf'&&typeof global.renderAll==='function')global.renderAll();
    if(target==='ceaf'&&!dashboardPeriodMode){
      if(global.__CE_QC_V108_ROUTE_LAZY__?.ensurePage)void global.__CE_QC_V108_ROUTE_LAZY__.ensurePage(target);
      void backgroundHydrate(target,true);
      return Promise.resolve({ok:true,deferred:true,source:'V205_CEAF_DEDICATED_FAST_ROUTE'});
    }
    if(canUseSummary(target)){
      if(global.__CE_QC_V108_ROUTE_LAZY__?.ensurePage)void global.__CE_QC_V108_ROUTE_LAZY__.ensurePage(target);
      void backgroundHydrate(target,false);
      return Promise.resolve({ok:true,deferred:true,source:'V205_BOOTSTRAP_SUMMARY'});
    }
    return original(page);
  };

  const originalNavigatePage=global.navigatePage;
  if(typeof originalNavigatePage==='function'&&!originalNavigatePage.__v205CeafPrepaint){
    const wrappedNavigatePage=function(page,...args){
      if(String(page||'').toLowerCase()==='ceaf')seedCeafBeforeNavigation();
      return originalNavigatePage.call(this,page,...args);
    };
    wrappedNavigatePage.__v205CeafPrepaint=true;
    global.navigatePage=wrappedNavigatePage;
  }
  document.addEventListener('click',event=>{
    const side=event.target?.closest?.('.side-link[data-page="ceaf"]');
    const card=event.target?.closest?.('.v18-business-card');
    const cardLabel=String(card?.querySelector?.('span')?.textContent||'');
    if(side||/CEAF/i.test(cardLabel))seedCeafBeforeNavigation();
  },true);

  document.addEventListener('ce-qc-run-complete',()=>{lastHydratedAt.clear();try{localStorage.removeItem(CEAF_EXACT_CACHE);}catch{}});
  global.__CE_QC_V109_INSTANT_BUSINESS_NAV__={version:VERSION,compatVersion:GOLIVE_COMPAT_VERSION,pending:()=>pending.size,canUseSummary,lastHydratedAt,backgroundHydrate,seedCeafFromFastSummary,seedCeafBeforeNavigation,hydrateCeafFast};
  console.info('[CE-QC][V205_INSTANT_BUSINESS_NAV]',VERSION);
})(window);
