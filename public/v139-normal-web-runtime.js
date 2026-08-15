(function installNormalWebRuntimeV139(global){
  if(global.__CE_QC_V139_NORMAL_WEB__)return;
  const VERSION='2026-08-15-v139-normal-web-runtime-v1';
  function restoreRenderer(){
    const base=global.__CE_QC_DASHBOARD_V18_BASE__;
    if(base&&global.DashboardV18){
      global.DashboardV18.renderHome=base.renderHome;
      global.DashboardV18.renderBusiness=base.renderBusiness;
      global.DashboardV18.__v139NormalWeb=true;
    }
  }
  function removeLegacyTrendDom(){
    document.querySelectorAll('.v27-force-trend,#v27ForcedAttemptTrend,#v27ForcedHomeAttemptTrends,.v27-force-attempt').forEach(node=>{node.hidden=true;node.style.display='none';node.dataset.replacedBy='V139';});
  }
  function currentImportMatches(){
    try{
      const selected=String(historyModeDate||unifiedImportState?.reportDate||'').slice(0,10);
      return Boolean(unifiedImportState?.snapshotId&&selected&&selected===String(unifiedImportState.reportDate||'').slice(0,10));
    }catch{return false;}
  }
  // Never make normal current-day navigation wait for a large business-state read.
  // V139 bootstrap supplies current imported shells; completed snapshots replace them
  // after the processing-complete refresh event.
  const hydrate=global.hydratePageData;
  if(typeof hydrate==='function'){
    global.hydratePageData=function v139NonBlockingHydrate(page){
      const p=String(page||'').toLowerCase();
      if(currentImportMatches()&&['ce','ceaf','tbkh','ali1688','shopeecn','shopeevn'].includes(p))return Promise.resolve({ok:true,source:'V139_CURRENT_IMPORT_SHELL'});
      return hydrate(page);
    };
  }
  restoreRenderer();removeLegacyTrendDom();
  setTimeout(()=>{restoreRenderer();removeLegacyTrendDom();},0);
  setTimeout(()=>{restoreRenderer();removeLegacyTrendDom();},250);
  document.addEventListener('ce-qc-run-complete',()=>{
    // Completed data is refreshed by the normal global refresh; do not create a
    // second processing loop here. Only ensure legacy trend DOM stays retired.
    setTimeout(removeLegacyTrendDom,50);
  });
  global.__CE_QC_V139_NORMAL_WEB__={version:VERSION,restoreRenderer,removeLegacyTrendDom};
  console.info('[CE-QC][V139_NORMAL_WEB]',VERSION);
})(window);
