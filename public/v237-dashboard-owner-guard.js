(function installV237DashboardOwnerGuard(global){
  if(global.__CE_QC_V237_DASHBOARD_OWNER_GUARD__)return;
  global.__CE_QC_V237_DASHBOARD_OWNER_GUARD__=true;
  global.__CE_QC_V237_DASHBOARD_OWNER__=true;
  const VERSION='2026-09-03-v419-global-range-data-owner-v2';
  const GLOBAL_RANGE_VERSION='2026-09-03-v419-one-global-date-range-all-boards-export-v2';
  const WHPP_RANGE_SOURCE='2026-09-03-v419-whpp-canonical-period-range-v1';
  const OWNED_PATHS=new Set(['/','/home','/ce','/ceaf','/tbkh','/ali1688','/shopeecn','/shopeevn','/whpp','/reports']);
  const RANGE_GROUPS={
    top:['topRangeFrom','topRangeTo'],
    dashboard:['dashboardRangeFrom','dashboardRangeTo'],
    export:['periodExportFrom','periodExportTo']
  };
  const RANGE_IDS=new Set(Object.values(RANGE_GROUPS).flat());
  const RANGE_ACTION_IDS=new Set(['topRangeQuery','dashboardRangeApply','periodExportBtn']);
  const nativeFetch=global.fetch.bind(global);
  const currentPath=()=>String(location.pathname||'/').toLowerCase().replace(/\/+$/,'')||'/';
  const isOwnedPage=()=>OWNED_PATHS.has(currentPath());
  const date=value=>{const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};
  const validRange=(from,to)=>Boolean(date(from)&&date(to)&&date(from)<=date(to));
  const num=value=>Number.isFinite(Number(value))?Number(value):0;
  let canonicalRange={from:'',to:'',mode:'custom',source:'',updatedAt:0,version:GLOBAL_RANGE_VERSION};
  let appRangeTimer=null;
  let syncQueued=false;
  let syntheticRangeEvent=false;

  function hasMultiDayRange(){return validRange(canonicalRange.from,canonicalRange.to)&&canonicalRange.from!==canonicalRange.to;}
  function groupValues(name){
    const ids=RANGE_GROUPS[name]||[];
    return {from:date(document.getElementById(ids[0])?.value),to:date(document.getElementById(ids[1])?.value)};
  }
  function setInputValue(id,value){
    const node=document.getElementById(id);
    if(node&&document.activeElement!==node&&String(node.value||'')!==value)node.value=value;
  }
  function ensureSevenBusinessExportOptions(){
    const select=document.getElementById('periodExportBusiness');
    if(!select)return;
    const all=select.querySelector('option[value="ALL"]');
    if(all&&String(all.textContent||'').includes('五业务'))all.textContent='管理汇总 + 七业务';
    const ensure=(value,label,afterValue='')=>{
      if(select.querySelector(`option[value="${value}"]`))return;
      const option=document.createElement('option');option.value=value;option.textContent=label;
      const after=afterValue?select.querySelector(`option[value="${afterValue}"]`):null;
      if(after?.nextSibling)select.insertBefore(option,after.nextSibling);else select.appendChild(option);
    };
    ensure('CEAF','CEAF','CE');
    ensure('WHPP','WHPP','SHOPEEVN');
  }
  function syncControls(){
    if(!validRange(canonicalRange.from,canonicalRange.to))return false;
    for(const ids of Object.values(RANGE_GROUPS)){
      setInputValue(ids[0],canonicalRange.from);
      setInputValue(ids[1],canonicalRange.to);
    }
    const status=document.getElementById('topRangeStatus');
    if(status&&!/读取中|正在读取/.test(String(status.textContent||'')))status.textContent=`${canonicalRange.from} ~ ${canonicalRange.to}`;
    ensureSevenBusinessExportOptions();
    return true;
  }
  function notifyRangeConsumers(){
    const node=document.getElementById('topRangeTo')||document.getElementById('dashboardRangeTo');
    if(!node||typeof global.Event!=='function')return;
    syntheticRangeEvent=true;
    try{node.dispatchEvent(new global.Event('change',{bubbles:true}));}catch{}
    finally{syntheticRangeEvent=false;}
  }
  function setCanonicalRange(from,to,source='GLOBAL_RANGE'){
    const f=date(from),t=date(to);
    if(!validRange(f,t))return false;
    const changed=f!==canonicalRange.from||t!==canonicalRange.to;
    canonicalRange={from:f,to:t,mode:'custom',source:String(source||'GLOBAL_RANGE'),updatedAt:Date.now(),version:GLOBAL_RANGE_VERSION};
    if(changed){
      try{global.__CE_QC_V237_CURRENT_SUMMARY__=null;}catch{}
      try{global.__CE_QC_V132_WHPP_FAST_RANGE_CACHE__=null;}catch{}
    }
    syncControls();
    return true;
  }
  function adoptBestVisibleRange(source='VISIBLE_RANGE'){
    if(validRange(canonicalRange.from,canonicalRange.to)){syncControls();return true;}
    for(const name of ['top','dashboard','export']){
      const value=groupValues(name);
      if(validRange(value.from,value.to))return setCanonicalRange(value.from,value.to,`${source}:${name}`);
    }
    ensureSevenBusinessExportOptions();
    return false;
  }
  function adoptGroup(name,source='USER_RANGE'){
    const value=groupValues(name);
    if(!validRange(value.from,value.to))return false;
    return setCanonicalRange(value.from,value.to,`${source}:${name}`);
  }
  function scheduleAppRangeSync(){
    clearTimeout(appRangeTimer);
    appRangeTimer=setTimeout(()=>{
      if(!validRange(canonicalRange.from,canonicalRange.to))return;
      try{
        let task=null;
        if(typeof global.loadCustomDashboardRange==='function')task=global.loadCustomDashboardRange(canonicalRange.from,canonicalRange.to,false);
        else if(typeof global.applyTopDateRange==='function')task=global.applyTopDateRange();
        void Promise.resolve(task).catch(error=>console.warn('[CE-QC][V419_GLOBAL_RANGE] app range sync failed',error)).finally(notifyRangeConsumers);
      }catch(error){console.warn('[CE-QC][V419_GLOBAL_RANGE] app range sync failed',error);notifyRangeConsumers();}
    },60);
  }
  function queueSync(){
    if(syncQueued)return;syncQueued=true;
    queueMicrotask(()=>{syncQueued=false;adoptBestVisibleRange('DOM_SYNC');syncControls();});
  }
  function rangeGroupForId(id=''){
    for(const [name,ids] of Object.entries(RANGE_GROUPS))if(ids.includes(id))return name;
    return '';
  }
  function relevantAddedNode(node){
    if(!node||node.nodeType!==1)return false;
    if(RANGE_IDS.has(node.id)||node.id==='periodExportBusiness')return true;
    return Boolean(node.querySelector?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo,#periodExportFrom,#periodExportTo,#periodExportBusiness'));
  }
  function addRangeToUrl(raw,{businessType=''}={}){
    try{
      const base=global.location?.origin||'http://127.0.0.1';
      const parsed=new URL(String(raw||''),base);
      parsed.searchParams.set('from',canonicalRange.from);
      parsed.searchParams.set('to',canonicalRange.to);
      if(businessType)parsed.searchParams.set('businessType',businessType);
      return parsed.origin===base?`${parsed.pathname}${parsed.search}`:parsed.toString();
    }catch{return String(raw||'');}
  }
  function responseJson(payload,status=200,headers={}){
    return Promise.resolve(new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}}));
  }
  async function rangeWhppSummary(init){
    const response=await nativeFetch(`/api/period-dashboard?from=${encodeURIComponent(canonicalRange.from)}&to=${encodeURIComponent(canonicalRange.to)}`,{cache:'no-store',credentials:'same-origin',...(init||{})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload?.ok===false)return responseJson(payload,response.status||500);
    const state=payload?.states?.WHPP||{},metrics={...(state?.dashboard?.metrics||{})},regions=state?.dashboard?.regions||{};
    const total=num(metrics.total||state.sourceTotal||state?.dashboard?.pnh||state?.dashboard?.totalMonitored);
    metrics.total=total;
    metrics.pod=num(metrics.pod||state?.dashboard?.todayPod);
    metrics.returned=num(metrics.returned);
    metrics.cancelled=num(metrics.cancelled);
    metrics.unresolved=Number.isFinite(Number(metrics.unresolved))?Number(metrics.unresolved):Math.max(0,total-metrics.pod-metrics.returned-metrics.cancelled);
    const completed=state.analysisComplete===true||state.snapshotStatus==='COMPLETED';
    return responseJson({
      ok:true,patchId:WHPP_RANGE_SOURCE,statusRevision:WHPP_RANGE_SOURCE,reportDate:canonicalRange.to,
      periodStart:canonicalRange.from,periodEnd:canonicalRange.to,total,completed,snapshotStatus:completed?'COMPLETED':'PARTIAL',
      metrics,regions,summarySource:'V419_CANONICAL_PERIOD_DASHBOARD_WHPP',completionSource:completed?'RANGE_ANALYSIS_COMPLETE':'RANGE_ANALYSIS_PARTIAL',
      state:{reportDate:canonicalRange.to,periodStart:canonicalRange.from,periodEnd:canonicalRange.to,dailyReportReady:total>0,snapshotStatus:completed?'COMPLETED':'PARTIAL',completed,total}
    },200,{'X-CE-QC-WHPP-Range':WHPP_RANGE_SOURCE});
  }
  async function rangeWhppTrends(init){
    const response=await nativeFetch(`/api/v234/trends?businessType=WHPP&from=${encodeURIComponent(canonicalRange.from)}&to=${encodeURIComponent(canonicalRange.to)}`,{cache:'no-store',credentials:'same-origin',...(init||{})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload?.ok===false)return responseJson(payload,response.status||500);
    return responseJson({
      ok:true,patchId:WHPP_RANGE_SOURCE,reportDate:canonicalRange.to,periodStart:canonicalRange.from,periodEnd:canonicalRange.to,
      dates:payload.dates||[],ticket:payload.ticket||[],podRate:payload.podRate||[],ocRate:payload.ocRate||[],returnRate:payload.returnRate||[],
      missingDates:payload.missingDates||[],source:'V419_V234_WHPP_GLOBAL_RANGE'
    },200,{'X-CE-QC-WHPP-Range':WHPP_RANGE_SOURCE});
  }

  const emptyJson=payload=>responseJson(payload);
  global.fetch=function v237OwnedFetch(input,init){
    let url='';
    try{url=typeof input==='string'?input:String(input?.url||'');}catch{}
    if(isOwnedPage()){
      if(/\/api\/v27\/trends(?:\?|$)/.test(url))return emptyJson({ok:true,retired:true,owner:'V237',dates:[],daily:[]});
      if(/\/api\/v55\/reconciliation(?:\?|$)/.test(url))return emptyJson({ok:true,retired:true,owner:'V237',summary:{}});
      if(hasMultiDayRange()&&/\/api\/v234\/current-summary(?:\?|$)/.test(url))return nativeFetch(addRangeToUrl(url),init);
      if(hasMultiDayRange()&&/\/api\/v132\/whpp-fast-summary(?:\?|$)/.test(url))return rangeWhppSummary(init);
      if(hasMultiDayRange()&&/\/api\/v171\/whpp-trends(?:\?|$)/.test(url))return rangeWhppTrends(init);
      if(hasMultiDayRange()&&/\/api\/v172\/whpp-metric-detail(?:\?|$)/.test(url))return nativeFetch(addRangeToUrl(url),init);
    }
    return nativeFetch(input,init);
  };
  function removeLegacy(){document.querySelectorAll('#v230MetricTruthPanel').forEach(node=>node.remove());}
  const observer=new MutationObserver(records=>{
    if(isOwnedPage()&&records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(node.id==='v230MetricTruthPanel'||node.querySelector?.('#v230MetricTruthPanel')))))removeLegacy();
    if(records.some(record=>[...record.addedNodes].some(relevantAddedNode)))queueSync();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});

  document.addEventListener('change',event=>{
    if(syntheticRangeEvent)return;
    const id=String(event.target?.id||'');
    const group=rangeGroupForId(id);
    if(!group)return;
    if(adoptGroup(group,'CHANGE')&&group==='export')scheduleAppRangeSync();
  },true);
  document.addEventListener('click',event=>{
    const target=event.target?.closest?.('button,[data-page],a');
    const id=String(target?.id||'');
    if(RANGE_ACTION_IDS.has(id)){
      setTimeout(()=>{
        const group=id==='periodExportBtn'?'export':id==='dashboardRangeApply'?'dashboard':'top';
        if(adoptGroup(group,'ACTION')&&group==='export')scheduleAppRangeSync();
      },0);
      return;
    }
    if(target?.matches?.('[data-page],.side-link,a[href]'))setTimeout(()=>{syncControls();ensureSevenBusinessExportOptions();},0);
  },true);

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{removeLegacy();adoptBestVisibleRange('BOOT');syncControls();},{once:true});
  else{removeLegacy();adoptBestVisibleRange('BOOT');syncControls();}
  global.addEventListener('popstate',()=>setTimeout(()=>{removeLegacy();syncControls();},0));
  global.addEventListener('pageshow',()=>setTimeout(()=>syncControls(),0));
  global.__CE_QC_GLOBAL_PERIOD_RANGE__={
    version:GLOBAL_RANGE_VERSION,
    dataOwnerVersion:VERSION,
    whppRangeSource:WHPP_RANGE_SOURCE,
    get:()=>({...canonicalRange}),
    set:(from,to,source='API')=>setCanonicalRange(from,to,source),
    sync:()=>{adoptBestVisibleRange('API_SYNC');return syncControls();},
    syncApp:scheduleAppRangeSync,
    groups:RANGE_GROUPS
  };
  console.info('[CE-QC][V237_DASHBOARD_OWNER_GUARD]',VERSION,'one canonical range owns HOME + CE/CEAF/TBKH/ALI1688 + SHOPEE CN/VN + WHPP summary/trends/details + report export; single-day fast paths retained');
})(window);
