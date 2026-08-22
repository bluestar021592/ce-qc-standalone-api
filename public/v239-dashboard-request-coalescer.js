(function installV239DashboardRequestCoalescer(global){
  if(global.__CE_QC_V239_DASHBOARD_REQUEST_COALESCER__)return;
  global.__CE_QC_V239_DASHBOARD_REQUEST_COALESCER__=true;
  const VERSION='2026-08-23-v239-current-summary-coalescer-v1';
  const nativeFetch=global.fetch.bind(global);
  const CACHE_MS=15_000;
  const cache=new Map();
  const inflight=new Map();

  function requestUrl(input){try{return new URL(typeof input==='string'?input:String(input?.url||''),location.origin);}catch{return null;}}
  function methodOf(input,init){return String(init?.method||input?.method||'GET').toUpperCase();}
  function keyOf(url){return `${url.pathname}?${url.searchParams.toString()}`;}
  function cloneFrom(record){return new Response(record.body,{status:record.status,statusText:record.statusText,headers:new Headers(record.headers)});}

  global.fetch=async function v239CoalescedFetch(input,init){
    const url=requestUrl(input);
    if(!url||url.origin!==location.origin||methodOf(input,init)!=='GET'||url.pathname!=='/api/v234/current-summary')return nativeFetch(input,init);
    const key=keyOf(url),hit=cache.get(key);
    if(hit&&Date.now()-hit.at<CACHE_MS)return cloneFrom(hit);
    if(inflight.has(key))return cloneFrom(await inflight.get(key));
    const task=(async()=>{
      const response=await nativeFetch(input,init);
      const body=await response.clone().text();
      const record={at:Date.now(),body,status:response.status,statusText:response.statusText,headers:[...response.headers.entries()]};
      if(response.ok)cache.set(key,record);
      return record;
    })().finally(()=>inflight.delete(key));
    inflight.set(key,task);
    return cloneFrom(await task);
  };

  document.addEventListener('ce-qc-run-complete',()=>cache.clear());
  console.info('[CE-QC][V239_CURRENT_SUMMARY_COALESCER]',VERSION,'duplicate current-summary reads share one response for 15s');
})(window);
