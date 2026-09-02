(function installV237DashboardOwnerGuard(global){
  if(global.__CE_QC_V237_DASHBOARD_OWNER_GUARD__)return;
  global.__CE_QC_V237_DASHBOARD_OWNER_GUARD__=true;
  // Set the owner flag immediately. This file is injected in <head> before the
  // legacy dashboard clients, so old observers can see that V237 owns first paint.
  global.__CE_QC_V237_DASHBOARD_OWNER__=true;
  const VERSION='2026-09-03-v419-global-range-dashboard-owner-v1';
  const GLOBAL_RANGE_VERSION='2026-09-03-v419-one-global-date-range-all-boards-export-v1';
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
  let canonicalRange={from:'',to:'',mode:'custom',source:'',updatedAt:0,version:GLOBAL_RANGE_VERSION};
  let appRangeTimer=null;
  let syncQueued=false;

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
  function setCanonicalRange(from,to,source='GLOBAL_RANGE'){
    const f=date(from),t=date(to);
    if(!validRange(f,t))return false;
    canonicalRange={from:f,to:t,mode:'custom',source:String(source||'GLOBAL_RANGE'),updatedAt:Date.now(),version:GLOBAL_RANGE_VERSION};
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
        if(typeof global.loadCustomDashboardRange==='function'){
          void Promise.resolve(global.loadCustomDashboardRange(canonicalRange.from,canonicalRange.to,false)).catch(error=>console.warn('[CE-QC][V419_GLOBAL_RANGE] app range sync failed',error));
        }else if(typeof global.applyTopDateRange==='function'){
          void Promise.resolve(global.applyTopDateRange()).catch(error=>console.warn('[CE-QC][V419_GLOBAL_RANGE] top range sync failed',error));
        }
      }catch(error){console.warn('[CE-QC][V419_GLOBAL_RANGE] app range sync failed',error);}
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

  const emptyJson=payload=>Promise.resolve(new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}));
  global.fetch=function v237OwnedFetch(input,init){
    let url='';
    try{url=typeof input==='string'?input:String(input?.url||'');}catch{}
    if(isOwnedPage()){
      // The V232 trend reader is retired. V237 reads the same dates through
      // /api/v234/trends and owns all visible dashboard charts/tables.
      if(/\/api\/v27\/trends(?:\?|$)/.test(url))return emptyJson({ok:true,retired:true,owner:'V237',dates:[],daily:[]});
      // V55 reconciliation used to run a multi-second synchronous SQLite query
      // after repeated DOM mutations. V237 current summary owns first paint.
      if(/\/api\/v55\/reconciliation(?:\?|$)/.test(url))return emptyJson({ok:true,retired:true,owner:'V237',summary:{}});
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
    get:()=>({...canonicalRange}),
    set:(from,to,source='API')=>setCanonicalRange(from,to,source),
    sync:()=>{adoptBestVisibleRange('API_SYNC');return syncControls();},
    syncApp:scheduleAppRangeSync,
    groups:RANGE_GROUPS
  };
  console.info('[CE-QC][V237_DASHBOARD_OWNER_GUARD]',VERSION,'one global date range now owns HOME + all business boards + report export; legacy trend + passive reconciliation retired');
})(window);
