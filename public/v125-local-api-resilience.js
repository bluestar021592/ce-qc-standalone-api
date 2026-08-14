(function installLocalApiResilienceV125(global){
  if(global.__CE_QC_V125_LOCAL_API_RESILIENCE__)return;
  const VERSION='2026-08-14-v125-local-api-resilience-v1';
  const previousFetch=global.fetch.bind(global);
  const RETRY_DELAYS=[250,800,1600];
  let lastSuccessfulApiAt=0;

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms||0))));
  function asUrl(input){try{return new URL(input instanceof Request?input.url:String(input),location.origin);}catch{return null;}}
  function methodOf(input,init){return String(init?.method||(input instanceof Request?input.method:'GET')||'GET').toUpperCase();}
  function safeRetryable(input,init){
    const url=asUrl(input),method=methodOf(input,init);
    return Boolean(url&&url.origin===location.origin&&url.pathname.startsWith('/api/')&&['GET','HEAD'].includes(method));
  }
  function aborted(init){return Boolean(init?.signal?.aborted);}
  function networkFailure(error){
    const name=String(error?.name||'');
    const text=String(error?.message||error||'');
    return name==='TypeError'||name==='NetworkError'||/failed to fetch|fetch failed|networkerror|load failed|connection reset|socket hang up/i.test(text);
  }

  global.fetch=async function v125ResilientFetch(input,init){
    if(!safeRetryable(input,init))return previousFetch(input,init);
    let lastError=null;
    for(let attempt=0;attempt<=RETRY_DELAYS.length;attempt+=1){
      if(attempt>0){
        if(aborted(init))throw lastError;
        await sleep(RETRY_DELAYS[attempt-1]);
      }
      try{
        const response=await previousFetch(input,init);
        if(response?.ok)lastSuccessfulApiAt=Date.now();
        return response;
      }catch(error){
        lastError=error;
        if(aborted(init)||!networkFailure(error)||attempt>=RETRY_DELAYS.length)throw error;
      }
    }
    throw lastError||new Error('Local API request failed');
  };

  async function robustHealthProbe(timeoutMs=6500){
    const attempts=2;
    for(let attempt=0;attempt<attempts;attempt+=1){
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),Math.max(2500,Number(timeoutMs||6500)));
      try{
        const response=await previousFetch('/api/health',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
        const text=await response.text();
        let payload={};
        try{payload=text?JSON.parse(text):{};}catch{}
        if(response.ok&&payload.ok!==false){lastSuccessfulApiAt=Date.now();return true;}
      }catch{}
      finally{clearTimeout(timer);}
      if(attempt+1<attempts)await sleep(450);
    }
    // A successful local API response within the last 15 seconds is stronger
    // evidence than one temporarily delayed health probe. Do not turn one busy
    // SQLite moment into a full-page "backend disconnected" state.
    return Date.now()-lastSuccessfulApiAt<15_000;
  }

  function installHealthOverride(){
    if(typeof global.rawHealthProbe==='function')global.rawHealthProbe=robustHealthProbe;
  }
  setTimeout(installHealthOverride,0);
  global.addEventListener('DOMContentLoaded',installHealthOverride,{once:true});
  global.addEventListener('load',installHealthOverride,{once:true});

  global.__CE_QC_V125_LOCAL_API_RESILIENCE__={
    version:VERSION,
    lastSuccessfulApiAt:()=>lastSuccessfulApiAt,
    probe:robustHealthProbe
  };
  console.info('[CE-QC][V125_LOCAL_API_RESILIENCE]',VERSION);
})(window);
