(function installV237DashboardOwnerGuard(global){
  if(global.__CE_QC_V237_DASHBOARD_OWNER_GUARD__)return;
  global.__CE_QC_V237_DASHBOARD_OWNER_GUARD__=true;
  // Set the owner flag immediately. This file is injected in <head> before the
  // legacy dashboard clients, so old observers can see that V237 owns first paint.
  global.__CE_QC_V237_DASHBOARD_OWNER__=true;
  const VERSION='2026-08-22-v237-dashboard-owner-guard-v3';
  const OWNED_PATHS=new Set(['/','/home','/ce','/ceaf','/tbkh','/ali1688','/shopeecn','/shopeevn','/whpp']);
  const nativeFetch=global.fetch.bind(global);
  const currentPath=()=>String(location.pathname||'/').toLowerCase().replace(/\/+$/,'')||'/';
  const isOwnedPage=()=>OWNED_PATHS.has(currentPath());
  const emptyJson=payload=>Promise.resolve(new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}));
  global.fetch=function v237OwnedFetch(input,init){
    let url='';
    try{url=typeof input==='string'?input:String(input?.url||'');}catch{}
    if(isOwnedPage()){
      // The V232 trend reader is retired. V237 reads the same dates through
      // /api/v234/trends and owns all visible dashboard charts/tables.
      if(/\/api\/v27\/trends(?:\?|$)/.test(url))return emptyJson({ok:true,retired:true,owner:'V237',dates:[],daily:[]});
      // V55 reconciliation used to run a multi-second synchronous SQLite query
      // after repeated DOM mutations. V237 current summary owns first paint.
      if(/\/api\/v55\/reconciliation(?:\?|$)/.test(url))return emptyJson({ok:true,retired:true,owner:'V237',summary:{}});
    }
    return nativeFetch(input,init);
  };
  function removeLegacy(){document.querySelectorAll('#v230MetricTruthPanel').forEach(node=>node.remove());}
  const observer=new MutationObserver(records=>{
    if(!isOwnedPage())return;
    if(records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(node.id==='v230MetricTruthPanel'||node.querySelector?.('#v230MetricTruthPanel')))))removeLegacy();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',removeLegacy,{once:true});else removeLegacy();
  global.addEventListener('popstate',()=>setTimeout(removeLegacy,0));
  console.info('[CE-QC][V237_DASHBOARD_OWNER_GUARD]',VERSION,'V237 owns home/business first paint; legacy trend + passive reconciliation retired');
})(window);
