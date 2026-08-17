(function installInstantBusinessNavigationV166(global){
  if(global.__CE_QC_V109_INSTANT_BUSINESS_NAV__)return;
  const VERSION='2026-08-17-v166-summary-first-navigation-throttle-v1';
  const original=global.hydratePageData;
  if(typeof original!=='function')return;
  const pending=new Map();
  const lastHydratedAt=new Map();
  const typeByPage={ce:'CE',ceaf:'CEAF',tbkh:'TBKH',ali1688:'ALI1688',shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN'};
  const MIN_BACKGROUND_HYDRATE_MS=60_000;

  function currentSelectedDate(){
    try{return String(historyModeDate||unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate||'').slice(0,10);}catch{return '';}
  }
  function snapshotKey(page){
    const type=typeByPage[String(page||'')];
    let snapshot='';
    try{snapshot=String(businessStates?.[type]?.snapshotId||unifiedImportState?.snapshotId||'');}catch{}
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
  function backgroundHydrate(page,force=false){
    const key=snapshotKey(page);
    if(pending.has(key))return pending.get(key);
    if(!force&&Date.now()-Number(lastHydratedAt.get(key)||0)<MIN_BACKGROUND_HYDRATE_MS){
      return Promise.resolve({ok:true,skipped:true,source:'V166_HYDRATE_THROTTLE'});
    }
    const run=()=>Promise.resolve(original(page))
      .then(value=>{lastHydratedAt.set(key,Date.now());return value;})
      .catch(error=>console.warn('[CE-QC][V166_BACKGROUND_HYDRATE]',page,error))
      .finally(()=>pending.delete(key));
    const promise=new Promise(resolve=>{
      const start=()=>resolve(run());
      if('requestIdleCallback'in global)global.requestIdleCallback(start,{timeout:1800});else setTimeout(start,400);
    }).then(value=>value);
    pending.set(key,promise);
    return promise;
  }

  global.hydratePageData=function v166SummaryFirstHydrate(page){
    const target=String(page||'');
    if(canUseSummary(target)){
      if(global.__CE_QC_V108_ROUTE_LAZY__?.ensurePage)void global.__CE_QC_V108_ROUTE_LAZY__.ensurePage(target);
      void backgroundHydrate(target,false);
      return Promise.resolve({ok:true,deferred:true,source:'V166_BOOTSTRAP_SUMMARY'});
    }
    return original(page);
  };
  document.addEventListener('ce-qc-run-complete',()=>lastHydratedAt.clear());
  global.__CE_QC_V109_INSTANT_BUSINESS_NAV__={version:VERSION,pending:()=>pending.size,canUseSummary,lastHydratedAt,backgroundHydrate};
  console.info('[CE-QC][V166_INSTANT_BUSINESS_NAV]',VERSION);
})(window);
