(function installV253DashboardFastOwner(global){
  if(global.__CE_QC_V253_DASHBOARD_FAST_OWNER__)return;
  const VERSION='2026-08-24-v287-safe-v273-trend-fetch-bridge-v1';
  const nativeFetch=global.fetch.bind(global);

  function rewriteUrl(raw){
    if(!raw)return raw;let u;try{u=new URL(raw,location.origin);}catch{return raw;}
    if(u.pathname==='/api/v89/instant-dashboard'){u.pathname='/api/v253/instant-dashboard';return u.pathname+u.search;}
    // V287: visible trend reads bypass the historical /api/v253/trends endpoint.
    // /api/v273/trends is already the authenticated compatibility route backed by
    // V284/V286 proven seven-business daily-membership truth.
    if(u.pathname==='/api/v234/trends'){u.pathname='/api/v273/trends';return u.pathname+u.search;}
    if(u.pathname==='/api/v246/shopee-trends'&&u.searchParams.get('regions')==='1'&&u.searchParams.get('exact')==='1'){
      const businessType=u.searchParams.get('businessType')||'';const date=u.searchParams.get('to')||u.searchParams.get('from')||'';
      return `/api/v253/shopee-region?businessType=${encodeURIComponent(businessType)}&date=${encodeURIComponent(date)}`;
    }
    return raw;
  }

  global.fetch=function v253DashboardFetch(input,init){
    try{
      const raw=typeof input==='string'?input:String(input?.url||'');
      const next=rewriteUrl(raw);
      if(next!==raw){
        if(typeof input==='string')return nativeFetch(next,init);
        const absolute=new URL(next,location.origin).toString();
        return nativeFetch(new Request(absolute,input),init);
      }
    }catch{}
    return nativeFetch(input,init);
  };

  // Compatibility-only session cache helper retained for old source gates. V263
  // canonical DashboardV18 no longer uses V253 to paint visible trend DOM.
  function cacheGet(key,maxAge=10*60_000){try{const item=JSON.parse(sessionStorage.getItem(key)||'null');return item&&Date.now()-Number(item.at||0)<=maxAge?item.data:null;}catch{return null;}}
  void cacheGet;

  function removeHomeLegacyAttempts(){
    const root=document.getElementById('homePage');if(!root||root.hidden)return;
    const candidates=[...root.querySelectorAll('section,article,.v18-panel')];
    for(const node of candidates){
      const heading=[...node.querySelectorAll('h1,h2,h3,h4')].map(h=>String(h.textContent||'')).join(' ');
      if(/SHOPEE\s*1\s*\/\s*2\s*\/\s*3派签收占POD趋势|SHOPEE\s*1\/2\/3派签收占POD趋势/i.test(heading))node.remove();
    }
  }

  // Retired visible owner compatibility names. These intentionally do nothing;
  // DashboardV18.renderBusiness is the single V263 renderer.
  function renderGeneric(){return false;}
  function renderShopee(){return false;}
  function refresh(){removeHomeLegacyAttempts();}
  function bind(){removeHomeLegacyAttempts();document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page]'))setTimeout(removeHomeLegacyAttempts,40);},true);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();

  global.__CE_QC_V253_DASHBOARD_FAST_OWNER__={version:VERSION,refresh,renderGeneric,renderShopee,nativeFetch,fetchBridgeOnly:true,visibleTrendRoute:'/api/v273/trends'};
  console.info('[CE-QC][V287_DASHBOARD_FETCH]',VERSION,'fetch-only bridge; visible /api/v234/trends requests are safely redirected to V273 -> V284/V286 proven truth without touching Express route registration.');
})(window);
