(function installRouteIsolationWhppPriorityV170(global){
  if(global.__CE_QC_V170_ROUTE_ISOLATION_WHPP_PRIORITY__)return;
  const VERSION='2026-08-31-v393-v67-single-runner-compat-v1';

  function whppVisibleOffRoute(){
    if(location.pathname==='/whpp')return false;
    const page=document.getElementById('whppFastPage');
    return Boolean(page&&!page.hidden);
  }

  function repairRoute(){
    if(!whppVisibleOffRoute())return false;
    const page=document.getElementById('whppFastPage');
    if(page){page.hidden=true;page.classList.remove('active');}
    return true;
  }

  // V67 is the only start/resume owner. The historical V170 priority runner used
  // to reorder the stages as CCSL -> WHPP -> SHOPEE and periodically re-navigate
  // the SPA. Both behaviors are retired; V170 remains only as a compatibility
  // marker and a fail-closed cleanup for an already-visible stale WHPP page.
  global.addEventListener('popstate',repairRoute);
  document.addEventListener('click',event=>{
    const link=event.target?.closest?.('.side-link[data-page]');
    if(link&&String(link.dataset.page||'')!=='whpp')queueMicrotask(repairRoute);
  },false);

  global.__CE_QC_V170_ROUTE_ISOLATION_WHPP_PRIORITY__={
    version:VERSION,
    repairRoute,
    authoritativeRunner:'V67',
    retiredPriorityRunner:true,
    retiredPollingRouteGuard:true
  };
  console.info('[CE-QC][V393_V67_SINGLE_RUNNER_COMPAT]',VERSION,'V170 no longer patches V67.run, reorders stages, polls navigation, or owns WHPP rendering.');
})(window);
