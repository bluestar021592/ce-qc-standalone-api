(function installV300RuntimeRescue(global){
  if(global.__CE_QC_V300_RUNTIME_RESCUE__)return;
  const VERSION='2026-08-25-v300-single-sidebar-exact-shopee-owner-v1';
  const LEGACY_SHOPEE_IDS=['v234DailyTrendTruth','v245ShopeeAttemptTruth','v250ShopeeAttemptTruth','v251ShopeeAttemptTruth','v263DeliveryKpiPanel','v271AttemptPanel'];
  let navTimer=null,trendTimer=null,firstTimer=null,lastFirstKey='',fetchWrapped=false,observer=null;
  const date=v=>String(v||'').slice(0,10);
  const page=()=>String(location.pathname||'/').toLowerCase().replace(/\/+$/,'')||'/';
  const specialPage=()=>['/tbkh','/shopeecn','/shopeevn'].includes(page());
  const shopeePage=()=>['/shopeecn','/shopeevn'].includes(page());
  function range(){
    const to=date(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'');
    const from=date(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to);
    return{from,to};
  }
  function activeRoot(){return[...document.querySelectorAll('.app-page')].find(node=>!node.hidden&&getComputedStyle(node).display!=='none')||null;}
  function installStyle(){
    if(document.getElementById('v300RuntimeRescueStyle'))return;
    const style=document.createElement('style');style.id='v300RuntimeRescueStyle';style.textContent=`
      #v234DailyTrendTruth,#v245ShopeeAttemptTruth,#v250ShopeeAttemptTruth,#v251ShopeeAttemptTruth,#v263DeliveryKpiPanel,#v271AttemptPanel{display:none!important}
      .sidebar>.side-link,.sidebar>.side-sub,.sidebar>.side-group,.sidebar>.side-group-title{display:none!important}
    `;document.head.appendChild(style);
  }
  function cleanupSidebar(){
    const sidebar=document.querySelector('.sidebar');if(!sidebar)return;
    try{global.__CE_QC_V295_FIRST_ATTEMPT_UI__?.canonicalizeNav?.();}catch{}
    const navs=[...sidebar.querySelectorAll('.side-nav')];
    let nav=navs[0]||null;
    if(!nav){nav=document.createElement('nav');nav.className='side-nav';const collapse=sidebar.querySelector('.sidebar-collapse');sidebar.insertBefore(nav,collapse||null);}
    navs.slice(1).forEach(node=>node.remove());
    sidebar.querySelectorAll('.side-link,.side-sub,.side-group,.side-group-title').forEach(node=>{if(!nav.contains(node))node.remove();});
    [...sidebar.children].forEach(node=>{
      if(node===nav||node.matches?.('.sidebar-brand,.sidebar-collapse,#sideSystemStatus'))return;
      if(node.matches?.('nav')||node.querySelector?.('.side-link,.side-sub,.side-group,.side-group-title'))node.remove();
    });
    try{global.__CE_QC_V295_FIRST_ATTEMPT_UI__?.canonicalizeNav?.();}catch{}
    sidebar.dataset.v300SingleNav='1';
  }
  function scheduleNav(delay=20){clearTimeout(navTimer);navTimer=setTimeout(cleanupSidebar,delay);}
  function unwrapV251(){
    for(const name of ['renderShopeePage','renderAll']){
      let fn=global[name],changed=false;
      while(fn&&fn.__v251FinalOwner&&typeof fn.__v251Original==='function'){fn=fn.__v251Original;changed=true;}
      if(changed)global[name]=fn;
    }
  }
  function removeLegacyShopee(){
    const root=document.getElementById('shopeePage');if(!root)return;
    for(const id of LEGACY_SHOPEE_IDS)root.querySelector(`#${id}`)?.remove();
    root.querySelectorAll('section,article').forEach(node=>{
      if(node.id==='v272AttemptPanel')return;
      const heading=String(node.querySelector(':scope > h2,:scope > h3,.v251-head h2,.v245-attempt-head h2')?.textContent||'').replace(/\s+/g,'');
      if(/^(SHOPEE(?:CN|VN))?1\/2\/3派(?:成功率|签收占POD)趋势/.test(heading))node.remove();
    });
  }
  function blankUnprovenFirstAttempt(){
    const root=activeRoot();if(!root)return;
    root.querySelectorAll('.v18-metric-card').forEach(card=>{
      if(String(card.querySelector('span')?.textContent||'').trim()!=='首次妥投率'||card.dataset.v295FirstAttempt==='1')return;
      const value=card.querySelector('b'),note=card.querySelector('small');if(value)value.textContent='—';if(note)note.textContent='首派真实证据读取中，不沿用POD率';
      card.dataset.v300FirstAttemptPending='1';
    });
  }
  function wrongSpecialTrend(){
    if(!specialPage())return false;
    const root=activeRoot(),section=root?.querySelector('.v18-trend-section');if(!section)return false;
    if(section.dataset.v248ShopeeTrend||section.dataset.v251ShopeeTrend)return true;
    if(section.querySelector('[data-v248],[data-v251]'))return true;
    const rg=range();if(rg.from&&rg.from===rg.to){
      const badges=[...section.querySelectorAll('.v18-chart-head>span')].map(node=>String(node.textContent||''));
      if(badges.some(text=>/\b(?:[2-9]|\d{2,})\s*个有效日报/.test(text)))return true;
    }
    return false;
  }
  function enforceExactTrend(force=false){
    unwrapV251();removeLegacyShopee();blankUnprovenFirstAttempt();
    const root=activeRoot(),section=root?.querySelector('.v18-trend-section');
    if(section){delete section.dataset.v248ShopeeTrend;delete section.dataset.v251ShopeeTrend;}
    const owner=global.__CE_QC_V272_LAYOUT_TREND_FINALIZER__;
    if(owner?.rehydrateVisible&&(force||wrongSpecialTrend()))owner.rehydrateVisible();
  }
  function scheduleTrend(delay=50,force=false){clearTimeout(trendTimer);trendTimer=setTimeout(()=>enforceExactTrend(force),delay);}
  function exactLegacyShopeeFetch(){
    if(fetchWrapped||typeof global.fetch!=='function')return;fetchWrapped=true;
    const previous=global.fetch.bind(global);
    global.fetch=function v300ExactLegacyShopeeFetch(input,init){
      try{
        const raw=typeof input==='string'?input:String(input?.url||'');
        if(raw.includes('/api/v246/shopee-trends')&&!/[?&]exact=/.test(raw)){
          const u=new URL(raw,location.href),from=date(u.searchParams.get('from')),to=date(u.searchParams.get('to'));
          if(from&&from===to){u.searchParams.set('exact','1');const next=u.pathname+u.search;if(typeof input==='string')input=next;else input=new Request(next,input);}
        }
      }catch{}
      return previous(input,init);
    };
  }
  function firstKey(){const rg=range();return`${page()}|${rg.from}|${rg.to}`;}
  function triggerFirstAttempt(){
    blankUnprovenFirstAttempt();const api=global.__CE_QC_V295_FIRST_ATTEMPT_UI__;if(!api?.refresh)return;
    const key=firstKey();if(!key||key===lastFirstKey)return;
    const ready=activeRoot()?.querySelector('.v18-trend-section .v272-status.ok');if(!ready)return;
    lastFirstKey=key;clearTimeout(firstTimer);firstTimer=setTimeout(()=>api.refresh(true),350);
  }
  function scheduleFirst(delay=120){clearTimeout(firstTimer);firstTimer=setTimeout(triggerFirstAttempt,delay);}
  function bind(){
    installStyle();exactLegacyShopeeFetch();unwrapV251();cleanupSidebar();removeLegacyShopee();blankUnprovenFirstAttempt();scheduleTrend(120,true);scheduleFirst(250);
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query,#dashboardRangeQuery')){scheduleNav(30);lastFirstKey='';scheduleTrend(120,true);scheduleFirst(250);}},true);
    document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo')){lastFirstKey='';scheduleTrend(120,true);scheduleFirst(250);}},true);
    global.addEventListener('popstate',()=>{lastFirstKey='';scheduleNav(30);scheduleTrend(120,true);scheduleFirst(250);});
    observer=new MutationObserver(records=>{
      let nav=false,legacy=false,trendReady=false,first=false;
      for(const record of records){
        const target=record.target?.nodeType===1?record.target:record.target?.parentElement;
        if(target?.closest?.('.sidebar'))nav=true;
        if(target?.closest?.('.v18-metric-card,.v18-core-grid'))first=true;
        if(target?.closest?.('.v272-status')&&target?.closest?.('.v272-status')?.classList?.contains('ok'))trendReady=true;
        if(target?.closest?.('[data-v248],[data-v251],#v234DailyTrendTruth,#v245ShopeeAttemptTruth,#v250ShopeeAttemptTruth,#v251ShopeeAttemptTruth,#v263DeliveryKpiPanel,#v271AttemptPanel'))legacy=true;
        for(const node of record.addedNodes||[]){if(node?.nodeType!==1)continue;if(node.matches?.('.side-link,.side-sub,.side-group,.side-nav')||node.querySelector?.('.side-link,.side-sub,.side-group,.side-nav'))nav=true;if(node.matches?.('[data-v248],[data-v251],#v234DailyTrendTruth,#v245ShopeeAttemptTruth,#v250ShopeeAttemptTruth,#v251ShopeeAttemptTruth,#v263DeliveryKpiPanel,#v271AttemptPanel')||node.querySelector?.('[data-v248],[data-v251],#v234DailyTrendTruth,#v245ShopeeAttemptTruth,#v250ShopeeAttemptTruth,#v251ShopeeAttemptTruth,#v263DeliveryKpiPanel,#v271AttemptPanel'))legacy=true;if(node.matches?.('.v18-metric-card')||node.querySelector?.('.v18-metric-card'))first=true;}
      }
      if(nav)scheduleNav(20);if(legacy&&shopeePage())scheduleTrend(40,true);else if(specialPage()&&wrongSpecialTrend())scheduleTrend(40,true);if(first)blankUnprovenFirstAttempt();if(trendReady)scheduleFirst(80);
    });
    observer.observe(document.body||document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','hidden','data-v248','data-v251','data-v248-shopee-trend','data-v251-shopee-trend']});
    [300,1000,2500,6000].forEach(ms=>setTimeout(()=>{cleanupSidebar();removeLegacyShopee();blankUnprovenFirstAttempt();if(specialPage()&&wrongSpecialTrend())scheduleTrend(20,true);triggerFirstAttempt();},ms));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V300_RUNTIME_RESCUE__={version:VERSION,cleanupSidebar,enforceExactTrend,removeLegacyShopee,triggerFirstAttempt};
  console.info('[CE-QC][V300_RUNTIME_RESCUE]',VERSION,'single canonical sidebar; retired Shopee 7-day owners are hidden/removed; legacy single-day V246 reads are forced exact; V299 exact trend owner automatically wins; first-attempt card is blanked until real evidence arrives.');
})(window);
