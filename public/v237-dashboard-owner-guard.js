(function installV237DashboardOwnerGuard(global){
  if(global.__CE_QC_V237_DASHBOARD_OWNER_GUARD__)return;
  global.__CE_QC_V237_DASHBOARD_OWNER_GUARD__=true;
  const VERSION='2026-08-22-v237-dashboard-owner-guard-v1';
  const BUSINESS_PATHS=new Set(['/ce','/ceaf','/tbkh','/ali1688','/shopeecn','/shopeevn','/whpp']);
  const nativeFetch=global.fetch.bind(global);
  const isOwnedPage=()=>BUSINESS_PATHS.has(String(location.pathname||'').toLowerCase().replace(/\/+$/,'')||'/');
  const emptyJson=payload=>Promise.resolve(new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}));
  global.fetch=function v237OwnedFetch(input,init){
    let url='';
    try{url=typeof input==='string'?input:String(input?.url||'');}catch{}
    if(isOwnedPage()&&(global.__CE_QC_V237_DASHBOARD_OWNER__||global.__CE_QC_V234_DASHBOARD_LIVE__)){
      // V232 legacy trend UI is retired on business dashboards. V237 reads the
      // same dates through /api/v234/trends and owns all four charts + one table.
      if(/\/api\/v27\/trends(?:\?|$)/.test(url))return emptyJson({ok:true,retired:true,owner:'V237',dates:[],daily:[]});
      // V58 used to launch this multi-second reconciliation query after almost
      // every DOM mutation. V237 current summary already owns first paint.
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
  console.info('[CE-QC][V237_DASHBOARD_OWNER_GUARD]',VERSION,'legacy trend panel + passive reconciliation reads retired on business dashboards');
})(window);
