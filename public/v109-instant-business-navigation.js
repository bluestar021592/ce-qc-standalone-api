(function installInstantBusinessNavigationV109(global){
  if(global.__CE_QC_V109_INSTANT_BUSINESS_NAV__)return;
  const VERSION='2026-08-15-v138-summary-only-business-navigation-v2';
  const original=global.hydratePageData;
  if(typeof original!=='function')return;
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

  global.hydratePageData=function v138SummaryFirstHydrate(page){
    const target=String(page||'');
    if(canUseSummary(target)){
      if(global.__CE_QC_V108_ROUTE_LAZY__?.ensurePage)void global.__CE_QC_V108_ROUTE_LAZY__.ensurePage(target);
      return Promise.resolve({ok:true,deferred:false,source:'V138_BOOTSTRAP_SUMMARY_ONLY'});
    }
    return original(page);
  };
  global.__CE_QC_V109_INSTANT_BUSINESS_NAV__={version:VERSION,pending:()=>0,canUseSummary,hydrateFull:page=>original(page)};
  console.info('[CE-QC][V138_INSTANT_BUSINESS_NAV]',VERSION);
})(window);
