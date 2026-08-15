(function installNormalWebRuntimeV139(global){
  if(global.__CE_QC_V139_NORMAL_WEB__)return;
  const VERSION='2026-08-15-v141-canonical-trends-only-v3';
  const LEGACY_STYLE_ID='ce-qc-v141-canonical-trends-only';
  let cleanupScheduled=false;

  function installCanonicalTrendCss(){
    let style=document.getElementById(LEGACY_STYLE_ID);
    if(style)return style;
    style=document.createElement('style');
    style.id=LEGACY_STYLE_ID;
    style.textContent=`
      #homePage > .v18-trend-section,
      #ccslPage > .v18-trend-section,
      #shopeePage > .v18-trend-section,
      #v27ForcedAttemptTrend,
      #v27ForcedHomeAttemptTrends,
      .v27-force-trend,
      .v27-force-attempt,
      .v27-attempt-section,
      .v56-trend-blocker,
      #v56TrendHistoryTruth,
      #v56HomeTrendHistoryTruth,
      #v56AttemptEvidenceTruth,
      #v56HomeAttemptEvidenceTruth { display:none!important; }
      .v137-exclusive-trends,
      .v137-attempt-trends { display:block!important; }
    `;
    (document.head||document.documentElement).appendChild(style);
    return style;
  }

  function restoreRenderer(){
    const base=global.__CE_QC_DASHBOARD_V18_BASE__;
    if(base&&global.DashboardV18){
      global.DashboardV18.renderHome=base.renderHome;
      global.DashboardV18.renderBusiness=base.renderBusiness;
      global.DashboardV18.__v141NormalWeb=true;
    }
  }

  function removeLegacyTrendDom(){
    installCanonicalTrendCss();
    document.querySelectorAll('#v27ForcedAttemptTrend,#v27ForcedHomeAttemptTrends,.v27-force-trend,.v27-force-attempt,.v27-attempt-section,.v56-trend-blocker,#v56TrendHistoryTruth,#v56HomeTrendHistoryTruth,#v56AttemptEvidenceTruth,#v56HomeAttemptEvidenceTruth').forEach(node=>node.remove());
    for(const root of [document.getElementById('homePage'),document.getElementById('ccslPage'),document.getElementById('shopeePage')]){
      if(!root)continue;
      [...root.children].forEach(node=>{
        if(node?.classList?.contains('v18-trend-section')&&!node.classList.contains('v137-exclusive-trends')){
          node.hidden=true;
          node.style.display='none';
          node.dataset.replacedBy='V141';
        }
      });
    }
  }

  function scheduleCleanup(){
    if(cleanupScheduled)return;
    cleanupScheduled=true;
    const run=()=>{cleanupScheduled=false;restoreRenderer();removeLegacyTrendDom();};
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(run);else setTimeout(run,0);
  }

  function currentImportMatches(){
    try{
      const selected=String(historyModeDate||unifiedImportState?.reportDate||'').slice(0,10);
      return Boolean(unifiedImportState?.snapshotId&&selected&&selected===String(unifiedImportState.reportDate||'').slice(0,10));
    }catch{return false;}
  }

  // Compatibility bridge only. Old code may still call /api/v27/trends in a
  // long-lived browser tab; route it to the canonical V137 endpoint instead of
  // returning a synthetic {retired:true} payload that old widgets render as red
  // error text. No server-side V27 trend query is executed.
  const nativeFetch=global.fetch?.bind(global);
  if(nativeFetch){
    global.fetch=function v141Fetch(input,init){
      let url=null;
      try{
        const raw=typeof input==='string'||input instanceof URL?String(input):String(input?.url||'');
        if(raw)url=new URL(raw,location.origin);
      }catch{}
      if(url&&url.origin===location.origin&&url.pathname==='/api/v27/trends'){
        url.pathname='/api/v137/trends';
        const nextInit={...(init||{}),cache:'no-store',credentials:init?.credentials||'same-origin'};
        return nativeFetch(url.pathname+url.search+url.hash,nextInit);
      }
      return nativeFetch(input,init);
    };
  }

  // Never make normal current-day navigation wait for a large business-state read.
  // V139/V141 bootstrap supplies current imported shells; completed snapshots replace
  // them after the processing-complete refresh event.
  const hydrate=global.hydratePageData;
  if(typeof hydrate==='function'){
    global.hydratePageData=function v141NonBlockingHydrate(page){
      const p=String(page||'').toLowerCase();
      if(currentImportMatches()&&['ce','ceaf','tbkh','ali1688','shopeecn','shopeevn'].includes(p))return Promise.resolve({ok:true,source:'V141_CURRENT_IMPORT_SHELL'});
      return hydrate(page);
    };
  }

  installCanonicalTrendCss();restoreRenderer();removeLegacyTrendDom();
  setTimeout(scheduleCleanup,0);
  setTimeout(scheduleCleanup,120);
  setTimeout(scheduleCleanup,500);

  const target=document.querySelector('main.main-content')||document.body;
  if(target){
    const observer=new MutationObserver(records=>{
      const legacyAdded=records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(
        node.matches?.('.v18-trend-section,#v27ForcedAttemptTrend,#v27ForcedHomeAttemptTrends,.v27-force-trend,.v27-force-attempt,.v27-attempt-section,.v56-trend-blocker')||
        node.querySelector?.('.v18-trend-section,#v27ForcedAttemptTrend,#v27ForcedHomeAttemptTrends,.v27-force-trend,.v27-force-attempt,.v27-attempt-section,.v56-trend-blocker')
      )));
      if(legacyAdded)scheduleCleanup();
    });
    observer.observe(target,{childList:true,subtree:true});
  }

  document.addEventListener('ce-qc-run-complete',()=>setTimeout(scheduleCleanup,20));
  document.addEventListener('click',event=>{if(event.target?.closest?.('#topRangeQuery,#dashboardRangeQuery,.side-link,[data-page]'))setTimeout(scheduleCleanup,20);},true);
  global.addEventListener('popstate',()=>setTimeout(scheduleCleanup,20));

  global.__CE_QC_V139_NORMAL_WEB__={version:VERSION,restoreRenderer,removeLegacyTrendDom,canonicalOnly:true};
  console.info('[CE-QC][V141_CANONICAL_TRENDS_ONLY]',VERSION);
})(window);
