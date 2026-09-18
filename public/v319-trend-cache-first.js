(function installV319TrendCacheFirst(global){
  if(global.__CE_QC_V319_TREND_CACHE_FIRST__)return;
  const VERSION='2026-09-18-stability-v319-fail-closed-client-v2';
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
      return await originalFetch(rewritten,init);
    }catch(error){
      console.warn('[CE-QC][V319_TREND_CACHE_FIRST] read-only V319 route failed; fail closed without calling legacy V253.',error?.message||error);
      throw error;
    }
  };

  global.__CE_QC_V319_TREND_CACHE_FIRST__={version:VERSION,target:TARGET,replacement:REPLACEMENT,rewrite};
  console.info('[CE-QC][V319_TREND_CACHE_FIRST]',VERSION,'legacy /api/v253/trends browser reads are forced onto read-only /api/v319/trends; failures are fail-closed and never fall back to request-time V253 computation.');
})(window);
