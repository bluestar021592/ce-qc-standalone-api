(function installNormalWebRuntimeV139(global){
  if(global.__CE_QC_V139_NORMAL_WEB__)return;
  const VERSION='2026-08-15-v139-normal-web-runtime-v2';
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
  // Retire anonymous legacy V27 trend listeners that may already exist in an old
  // browser session. They can still fire, but their obsolete heavy endpoint is
  // answered in-memory and never reaches the server. V138/V139 exclusively use
  // /api/v137/trends.
  const nativeFetch=global.fetch?.bind(global);
  if(nativeFetch){
    global.fetch=function v139Fetch(input,init){
      const url=typeof input==='string'?input:String(input?.url||'');
      if(/(?:^|\/)api\/v27\/trends(?:\?|$)/.test(url)){
        return Promise.resolve(new Response(JSON.stringify({ok:false,retired:true,dates:[],attemptUnknownPod:[],attemptDenominator:[]}),{status:200,headers:{'Content-Type':'application/json','X-CE-QC-Retired':'V139'}}));
      }
      return nativeFetch(input,init);
    };
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
    setTimeout(removeLegacyTrendDom,50);
  });
  global.__CE_QC_V139_NORMAL_WEB__={version:VERSION,restoreRenderer,removeLegacyTrendDom};
  console.info('[CE-QC][V139_NORMAL_WEB]',VERSION);
})(window);
