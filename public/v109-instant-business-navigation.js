(function installInstantBusinessNavigationV109(global){
  if(global.__CE_QC_V109_INSTANT_BUSINESS_NAV__)return;
  const VERSION='2026-08-14-v109-summary-first-business-navigation-v1';
  const original=global.hydratePageData;
  if(typeof original!=='function')return;
  const pending=new Map();
  const typeByPage={ce:'CE',ceaf:'CEAF',tbkh:'TBKH',ali1688:'ALI1688',shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN'};

  function currentSelectedDate(){
    try{return String(historyModeDate||unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate||'').slice(0,10);}catch{return '';}
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
  function backgroundHydrate(page){
    if(pending.has(page))return pending.get(page);
    const run=()=>Promise.resolve(original(page)).catch(error=>console.warn('[CE-QC][V109_BACKGROUND_HYDRATE]',page,error)).finally(()=>pending.delete(page));
    const promise=new Promise(resolve=>{
      const start=()=>resolve(run());
      if('requestIdleCallback'in global)global.requestIdleCallback(start,{timeout:1200});else setTimeout(start,250);
    }).then(value=>value);
    pending.set(page,promise);
    return promise;
  }

  global.hydratePageData=function v109SummaryFirstHydrate(page){
    const target=String(page||'');
    if(canUseSummary(target)){
      if(global.__CE_QC_V108_ROUTE_LAZY__?.ensurePage)void global.__CE_QC_V108_ROUTE_LAZY__.ensurePage(target);
      void backgroundHydrate(target);
      return Promise.resolve({ok:true,deferred:true,source:'V109_BOOTSTRAP_SUMMARY'});
    }
    return original(page);
  };
  global.__CE_QC_V109_INSTANT_BUSINESS_NAV__={version:VERSION,pending:()=>pending.size,canUseSummary};
  console.info('[CE-QC][V109_INSTANT_BUSINESS_NAV]',VERSION);
})(window);
