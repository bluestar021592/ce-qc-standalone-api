(function installInstantBusinessNavigationV166(global){
  if(global.__CE_QC_V109_INSTANT_BUSINESS_NAV__)return;
  const VERSION='2026-08-21-v204-ceaf-dedicated-instant-navigation-v1';
  const original=global.hydratePageData;
  if(typeof original!=='function')return;
  const pending=new Map();
  const lastHydratedAt=new Map();
  const typeByPage={ce:'CE',ceaf:'CEAF',tbkh:'TBKH',ali1688:'ALI1688',shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN'};
  const MIN_BACKGROUND_HYDRATE_MS=60_000;
  const FAST_SUMMARY_CACHE='ce_qc_v89_instant_dashboard';

  function currentSelectedDate(){
    try{return String(historyModeDate||unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate||'').slice(0,10);}catch{return '';}
  }
  function selectedSnapshotId(){
    const date=currentSelectedDate();
    try{
      const historical=(historyCatalog?.UNIFIED||[]).find(row=>String(row?.reportDate||'').slice(0,10)===date);
      if(historical?.snapshotId)return String(historical.snapshotId);
      if(String(unifiedImportState?.reportDate||'').slice(0,10)===date&&unifiedImportState?.snapshotId)return String(unifiedImportState.snapshotId);
      if(businessStates?.CEAF?.snapshotId)return String(businessStates.CEAF.snapshotId);
    }catch{}
    return '';
  }
  function snapshotKey(page){
    const type=typeByPage[String(page||'')];
    let snapshot='';
    try{snapshot=String(businessStates?.[type]?.snapshotId||selectedSnapshotId()||'');}catch{}
    return `${page}|${currentSelectedDate()}|${snapshot}`;
  }
  function canUseSummary(page){
    const type=typeByPage[String(page||'')];
    if(!type)return false;
    try{
      if(dashboardPeriodMode)return false;
      const state=businessStates?.[type];
      const date=currentSelectedDate();
      return Boolean(state?.dashboard&&date&&String(state.reportDate||'').slice(0,10)===date);
    }catch{return false;}
  }
  function cachedFastSummary(){
    try{
      const value=JSON.parse(localStorage.getItem(FAST_SUMMARY_CACHE)||'null');
      const date=currentSelectedDate();
      return value?.reportDate&&String(value.reportDate).slice(0,10)===date?value:null;
    }catch{return null;}
  }
  function seedCeafFromFastSummary(page){
    if(String(page||'').toLowerCase()!=='ceaf')return false;
    try{
      const summary=cachedFastSummary();
      const expected=Number(summary?.counts?.CEAF);
      const date=currentSelectedDate();
      if(!date||!Number.isFinite(expected)||expected<0||typeof businessStates==='undefined')return false;
      const current=businessStates.CEAF||{};
      const currentTotal=Number(current?.dailyParseSummary?.totalRecognized??current?.dashboard?.pnh??current?.dashboard?.totalMonitored??current?.total??0);
      if(currentTotal===expected&&String(current.reportDate||'').slice(0,10)===date)return false;
      const dashboard={...(current.dashboard||{}),pnh:expected,totalMonitored:expected};
      const seeded={
        ...current,
        businessType:'CEAF',viewBusinessType:'CEAF',reportDate:date,
        snapshotId:selectedSnapshotId()||String(summary?.snapshotId||current.snapshotId||''),
        dailyReportReady:expected>0||Boolean(current.dailyReportReady),
        sourceTotal:expected,total:expected,
        dailyParseSummary:{...(current.dailyParseSummary||{}),totalRecognized:expected,pnh:expected},
        dashboard,
        v55Summary:{...(current.v55Summary||{}),total:expected,__source:'V204_CEAF_FAST_SUMMARY_FIRST_PAINT'},
        __v204CeafSeeded:true
      };
      businessStates.CEAF=seeded;
      return true;
    }catch{return false;}
  }
  async function hydrateCeafFast(){
    const date=currentSelectedDate();
    const snapshotId=selectedSnapshotId();
    const params=new URLSearchParams();
    if(snapshotId)params.set('snapshotId',snapshotId);
    else if(date)params.set('reportDate',date);
    const response=await fetch(`/api/v204/ceaf-fast-state?${params.toString()}`,{cache:'no-store',credentials:'same-origin'});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload?.ok===false)throw new Error(payload?.error||`HTTP ${response.status}`);
    if(payload?.state&&typeof businessStates!=='undefined'){
      businessStates.CEAF={...payload.state,__v204CeafExact:true};
      if(String(typeof currentPage!=='undefined'?currentPage:'').toLowerCase()==='ceaf'&&typeof global.renderAll==='function')global.renderAll();
    }
    return payload;
  }
  function backgroundHydrate(page,force=false){
    const target=String(page||'');
    const key=snapshotKey(target);
    if(pending.has(key))return pending.get(key);
    if(!force&&Date.now()-Number(lastHydratedAt.get(key)||0)<MIN_BACKGROUND_HYDRATE_MS){
      return Promise.resolve({ok:true,skipped:true,source:'V204_HYDRATE_THROTTLE'});
    }
    const run=()=>Promise.resolve(target==='ceaf'?hydrateCeafFast():original(target))
      .then(value=>{lastHydratedAt.set(key,Date.now());return value;})
      .catch(error=>{console.warn('[CE-QC][V204_BACKGROUND_HYDRATE]',target,error);return null;})
      .finally(()=>pending.delete(key));
    const promise=new Promise(resolve=>{
      const start=()=>resolve(run());
      if(target==='ceaf')queueMicrotask(start);
      else if('requestIdleCallback'in global)global.requestIdleCallback(start,{timeout:1800});
      else setTimeout(start,400);
    }).then(value=>value);
    pending.set(key,promise);
    return promise;
  }

  global.hydratePageData=function v204SummaryFirstHydrate(page){
    const target=String(page||'');
    const seeded=seedCeafFromFastSummary(target);
    if(seeded&&String(typeof currentPage!=='undefined'?currentPage:'').toLowerCase()==='ceaf'&&typeof global.renderAll==='function')global.renderAll();
    if(target==='ceaf'&&!dashboardPeriodMode){
      if(global.__CE_QC_V108_ROUTE_LAZY__?.ensurePage)void global.__CE_QC_V108_ROUTE_LAZY__.ensurePage(target);
      void backgroundHydrate(target,true);
      return Promise.resolve({ok:true,deferred:true,source:'V204_CEAF_DEDICATED_FAST_ROUTE'});
    }
    if(canUseSummary(target)){
      if(global.__CE_QC_V108_ROUTE_LAZY__?.ensurePage)void global.__CE_QC_V108_ROUTE_LAZY__.ensurePage(target);
      void backgroundHydrate(target,false);
      return Promise.resolve({ok:true,deferred:true,source:'V204_BOOTSTRAP_SUMMARY'});
    }
    return original(page);
  };
  document.addEventListener('ce-qc-run-complete',()=>lastHydratedAt.clear());
  global.__CE_QC_V109_INSTANT_BUSINESS_NAV__={version:VERSION,pending:()=>pending.size,canUseSummary,lastHydratedAt,backgroundHydrate,seedCeafFromFastSummary,hydrateCeafFast};
  console.info('[CE-QC][V204_INSTANT_BUSINESS_NAV]',VERSION);
})(window);
