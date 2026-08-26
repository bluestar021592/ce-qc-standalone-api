(function installV319TrendCacheFirst(global){
  if(global.__CE_QC_V319_TREND_CACHE_FIRST__)return;
  const VERSION='2026-08-26-v319-cache-only-exact-trend-client-v1';
  const originalFetch=global.fetch.bind(global);
  const TARGET='/api/v253/trends';
  const REPLACEMENT='/api/v319/trends';

  function rewrite(input){
    try{
      if(typeof input==='string'){
        const url=new URL(input,location.href);
        if(url.pathname!==TARGET)return input;
        url.pathname=REPLACEMENT;
        return url.origin===location.origin?`${url.pathname}${url.search}${url.hash}`:url.toString();
      }
      if(input instanceof Request){
        const url=new URL(input.url,location.href);
        if(url.pathname!==TARGET)return input;
        url.pathname=REPLACEMENT;
        return new Request(url.toString(),input);
      }
    }catch{}
    return input;
  }
  function isTarget(input){
    try{return new URL(typeof input==='string'?input:input?.url,location.href).pathname===TARGET;}catch{return false;}
  }

  global.fetch=async function v319TrendCacheFirstFetch(input,init){
    if(!isTarget(input))return originalFetch(input,init);
    const rewritten=rewrite(input);
    try{
      const response=await originalFetch(rewritten,init);
      if(response.status!==404)return response;
    }catch(error){
      if(error?.name==='AbortError')throw error;
      console.warn('[CE-QC][V319_TREND_CACHE_FIRST] cache-only route failed before response; falling back to legacy bounded V253 read.',error?.message||error);
    }
    return originalFetch(input,init);
  };

  global.__CE_QC_V319_TREND_CACHE_FIRST__={version:VERSION,target:TARGET,replacement:REPLACEMENT,rewrite};
  console.info('[CE-QC][V319_TREND_CACHE_FIRST]',VERSION,'existing V299/V307 /api/v253/trends requests are transparently routed to cache-only exact /api/v319/trends; 404 alone falls back to legacy V253.');
})(window);
