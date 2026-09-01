(function installRouteIsolationWhppPriorityV170(global){
  if(global.__CE_QC_V170_ROUTE_ISOLATION_WHPP_PRIORITY__)return;
  const VERSION='2026-09-01-v404-route-isolation-only-v1';
  let repairTimer=null;

  const PATH_PAGE={
    '/':'home','/home':'home','/ce':'ce','/ceaf':'ceaf','/tbkh':'tbkh','/ali1688':'ali1688',
    '/shopeecn':'shopeecn','/shopeevn':'shopeevn','/import':'import','/tracking':'tracking',
    '/exceptions':'exceptions','/reports':'reports','/data-management':'data-management','/settings':'settings','/logs':'logs'
  };

  function pageFromLocation(){
    const path=String(location.pathname||'/').replace(/\/+$/,'')||'/';
    return PATH_PAGE[path]||'';
  }

  function whppHijacked(){
    if(location.pathname==='/whpp')return false;
    const intended=pageFromLocation();
    if(!intended)return false;
    const title=String(document.getElementById('pageTitle')?.textContent||'').trim();
    const whppSide=document.querySelector('.side-link[data-page="whpp"]');
    const whppFast=document.getElementById('whppFastPage');
    const shopeePage=document.getElementById('shopeePage');
    const shopeeWhpp=/WHPP本土看板/.test(String(shopeePage?.querySelector('h2')?.textContent||''));
    return title==='WHPP本土看板'
      || Boolean(whppSide?.classList.contains('active'))
      || Boolean(whppFast && !whppFast.hidden)
      || ((intended==='shopeecn'||intended==='shopeevn')&&shopeeWhpp);
  }

  function repairRoute(){
    if(!whppHijacked())return false;
    const intended=pageFromLocation();
    if(!intended||typeof global.navigatePage!=='function')return false;
    console.warn('[CE-QC][V170_ROUTE_ISOLATION] discarded stale WHPP render; restoring',intended);
    try{global.navigatePage(intended);return true;}
    catch(error){console.warn('[CE-QC][V170_ROUTE_ISOLATION] restore failed',error);return false;}
  }

  function armRouteGuard(ms=7000){
    if(repairTimer)clearInterval(repairTimer);
    const deadline=Date.now()+Math.max(1000,Number(ms||0));
    repairTimer=setInterval(()=>{
      if(Date.now()>=deadline){clearInterval(repairTimer);repairTimer=null;return;}
      repairRoute();
    },100);
    setTimeout(repairRoute,0);
  }

  document.addEventListener('click',event=>{
    const link=event.target?.closest?.('.side-link[data-page]');
    if(!link)return;
    if(String(link.dataset.page||'')!=='whpp')armRouteGuard();
  },true);
  global.addEventListener('popstate',()=>{if(location.pathname!=='/whpp')armRouteGuard();});

  function install(){
    // V404: V170 is route isolation only. It must never replace V67.run, expose
    // another seven-business executor, or call CCSL/SHOPEE/WHPP run endpoints.
    // V67 remains the sole start/resume owner; V169 remains the canonical
    // same-report completion entry guard.
    if(location.pathname!=='/whpp')armRouteGuard(1500);
    global.__CE_QC_V170_ROUTE_ISOLATION_WHPP_PRIORITY__={
      version:VERSION,
      routeIsolationOnly:true,
      authoritativeRunner:'V67',
      completionGuard:'V169',
      repairRoute,
      armRouteGuard
    };
    console.info('[CE-QC][V170_ROUTE_ISOLATION_ONLY]',VERSION,'V67 exclusively owns seven-business execution.');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,80),{once:true});
  else setTimeout(install,80);
})(window);
