(function installFastRenderV105(global){
  if(global.__CE_QC_V105_FAST_RENDER__)return;
  const VERSION='2026-08-14-v105-visible-page-render-v1';
  let scheduledHistory=false;

  const call=name=>{
    const fn=global[name];
    if(typeof fn==='function')return fn();
    return undefined;
  };

  function deferHistory(){
    if(scheduledHistory)return;
    scheduledHistory=true;
    const run=()=>{
      scheduledHistory=false;
      try{call('renderHistoryOptions');}catch(error){console.warn('[V105][HISTORY_RENDER]',error);}
    };
    if('requestIdleCallback'in global)global.requestIdleCallback(run,{timeout:500});
    else setTimeout(run,0);
  }

  global.renderAll=function v105VisiblePageRender(){
    const started=performance.now();
    try{
      call('renderPageVisibility');
      call('renderTopbar');
      call('renderSystemStatus');
      call('renderProcessingNotice');
      call('renderAnalysisCoverageNotice');

      const page=String(global.currentPage||'home');
      if(page==='home')call('renderHome');
      else if(['ce','ceaf','tbkh','ali1688'].includes(page))call('renderCcslPage');
      else if(['shopeecn','shopeevn'].includes(page))call('renderShopeePage');
      else if(page==='reports')call('renderReportsPage');
      else if(page==='exceptions')call('renderExceptionsPage');
      else if(page==='import'){
        call('renderCcslOperations');
        call('renderShopeeOperations');
        call('renderUnifiedImportResult');
        call('renderRulesPage');
      }else if(page==='settings'){
        call('renderAuthPanels');
        call('renderNetworkSettings');
        call('renderRulesPage');
        if(typeof global.runPageLoad==='function'&&typeof global.loadUserManagement==='function')void global.runPageLoad('settings-users',global.loadUserManagement,30000);
      }else if(page==='logs'){
        if(typeof global.runPageLoad==='function'&&typeof global.loadAuditLogs==='function')void global.runPageLoad('audit-logs',global.loadAuditLogs,15000);
      }else if(page==='data-management'){
        if(typeof global.runPageLoad==='function'&&typeof global.loadDataManagement==='function')void global.runPageLoad('data-management',global.loadDataManagement,15000);
      }

      // Date/history options change much less often than live counters. Render them
      // after the visible page so the user sees the dashboard first.
      deferHistory();
      const trackDate=document.getElementById('trackReportDate');
      if(page==='tracking'&&trackDate&&!trackDate.value&&typeof global.latestDate==='function'){
        trackDate.value=global.latestDate(global.appState?.reportDate,global.shopeeState?.reportDate)||new Date().toISOString().slice(0,10);
      }
    }catch(error){
      console.error('[CE-QC][V105_FAST_RENDER]',error);
    }finally{
      const ms=performance.now()-started;
      if(ms>100)console.warn(`[CE-QC][V105_RENDER_SLOW] ${Math.round(ms)}ms page=${global.currentPage||'home'}`);
    }
  };

  global.__CE_QC_V105_FAST_RENDER__={version:VERSION};
  console.info('[CE-QC][V105_FAST_RENDER]',VERSION);
})(window);
