(function installCurrentImportStabilityV159(global){
  if(global.__CE_QC_V159_CURRENT_IMPORT_STABILITY__)return;
  const VERSION='2026-08-16-v159-current-import-stability-v1';
  const PAGE_TYPE=Object.freeze({ce:'CE',ceaf:'CEAF',tbkh:'TBKH',ali1688:'ALI1688',shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN'});
  const PATH_PAGE=Object.freeze({'/':'home','/home':'home','/ce':'ce','/ceaf':'ceaf','/tbkh':'tbkh','/ali1688':'ali1688','/shopeecn':'shopeecn','/shopeevn':'shopeevn','/import':'import','/tracking':'tracking','/track':'tracking','/exceptions':'exceptions','/reports':'reports','/settings':'settings','/logs':'logs','/data-management':'data-management'});
  const TYPES=Object.values(PAGE_TYPE);
  const exactLoads=new Map();
  let routeGuardBusy=false;
  let routeGuardQueued=false;

  const num=value=>{const parsed=Number(value||0);return Number.isFinite(parsed)?parsed:0;};
  const fmt=value=>num(value).toLocaleString('zh-CN');
  const dateOnly=value=>{const text=String(value||'').trim().slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};

  function currentImport(){
    try{return typeof unifiedImportState!=='undefined'&&unifiedImportState?unifiedImportState:null;}catch{return null;}
  }
  function currentStates(){
    try{return typeof businessStates!=='undefined'&&businessStates?businessStates:null;}catch{return null;}
  }
  function expectedCount(imported,type){return Math.max(0,num(imported?.classificationCounts?.[type]));}
  function stateTotal(state={}){
    const values=[
      state?.dashboard?.pnh,state?.dashboard?.totalMonitored,state?.dashboard?.metrics?.total,
      state?.dailyParseSummary?.totalRecognized,state?.sourceTotal,state?.v55Summary?.total,
      Array.isArray(state?.pnhBills)?state.pnhBills.length:0
    ].map(num);
    return Math.max(0,...values);
  }
  function metrics(total=0){
    return {total,pod:0,podRate:0,returned:0,returnRate:0,cancelled:0,cancelRate:0,unresolved:total,pendingNonContinuous:0,pending1:0,pending2:0,pending3:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,delivery:0,workOrder:0,dispatchAttempt1:0,dispatchAttempt2:0,dispatchAttempt3:0,dispatchAttemptDenominator:total,dispatchAttempt1Rate:0,dispatchAttempt2Rate:0,dispatchAttempt3Rate:0,firstAttemptCount:0,firstAttemptEligible:total,firstAttemptRate:0};
  }
  function provisionalState(imported,type){
    const total=expectedCount(imported,type);
    const date=dateOnly(imported?.reportDate);
    const base={
      businessType:type,viewBusinessType:type,reportDate:date,sourceName:imported?.sourceName||'',batchId:imported?.batchId||'',snapshotId:imported?.snapshotId||'',snapshotStatus:'IMPORTED',dailyReportReady:Boolean(date),
      pnhBills:[],dailyParseRows:[],dailyParseSummary:{totalRecognized:total,pnh:total,nonPnh:0,excluded:0,duplicate:0,groupCounts:{CN:type==='SHOPEECN'?total:0,VN:type==='SHOPEEVN'?total:0}},
      finalRows:[],scanResults:[],trackResults:[],trackEvents:[],carryBills:[],nextCarryBills:[],podLocks:[],historySummary:[],processing:{running:false,paused:false,phase:''},
      sourceTotal:total,v55Summary:{total,__source:'V159_FRESH_IMPORT_CLASSIFICATION'},__v159Provisional:true,__v159ExpectedTotal:total
    };
    if(/^SHOPEE/.test(type)){
      const all=metrics(total),cn=metrics(type==='SHOPEECN'?total:0),vn=metrics(type==='SHOPEEVN'?total:0);
      base.dashboard={metrics:all,recipientGroups:{ALL:{metrics:all},CN:{metrics:cn},VN:{metrics:vn}},v55Summary:base.v55Summary};
    }else{
      base.dashboard={pnh:total,totalMonitored:total,todayPod:0,podRate:0,abnormalCount:0,categories:{pendingTotal:0,ocTotal:0},v55Summary:base.v55Summary};
    }
    return base;
  }
  function shouldSeed(existing,imported,type){
    const expected=expectedCount(imported,type);
    const reportDate=dateOnly(imported?.reportDate);
    if(!existing)return true;
    if(dateOnly(existing.reportDate)!==reportDate)return true;
    if(existing.__v159Provisional)return stateTotal(existing)!==expected;
    if(expected>0&&stateTotal(existing)===0)return true;
    return false;
  }
  function seedCurrentImport(){
    const imported=currentImport(),states=currentStates();
    if(!imported||!states||!dateOnly(imported.reportDate))return false;
    let changed=false;
    for(const type of TYPES){
      const existing=states[type];
      if(!shouldSeed(existing,imported,type))continue;
      states[type]=provisionalState(imported,type);
      changed=true;
    }
    if(imported?.dailyIsolation?.enabled&&imported?.carryover){
      imported.carryover.currentOpen=num(imported.carryover.todayOpen);
      imported.carryover.rechecked=0;
    }
    return changed;
  }

  function normalizeImportStatus(){
    const imported=currentImport();
    if(!imported?.reportDate||!imported?.carryover)return;
    const node=document.getElementById('fileStatus');
    if(!node||!node.textContent.includes('综合日报已导入'))return;
    let note=document.getElementById('v159DailyIsolationNote');
    if(!note){note=document.createElement('div');note.id='v159DailyIsolationNote';note.style.cssText='margin-top:7px;color:#39705a;font-size:12px;line-height:1.5';node.appendChild(note);}
    const today=num(imported.carryover.todayOpen),historical=num(imported.carryover.historicalOpen);
    note.innerHTML=`<b>${String(imported.reportDate)} 当日自动处理队列：${fmt(today)}票</b> · 历史跨日 ${fmt(historical)}票独立复查，不会混入当日全自动。`;
  }

  async function exactBusinessState(type){
    const imported=currentImport(),states=currentStates();
    if(!imported||!states||!TYPES.includes(type))return null;
    const date=dateOnly(imported.reportDate),snapshotId=String(imported.snapshotId||'').trim(),expected=expectedCount(imported,type);
    if(!date||!snapshotId)return null;
    const current=states[type];
    if(current&&!current.__v159Provisional&&dateOnly(current.reportDate)===date&&stateTotal(current)===expected)return current;
    const key=`${type}:${snapshotId}`;
    if(exactLoads.has(key))return exactLoads.get(key);
    const task=(async()=>{
      try{
        const response=await fetch(`/api/business-state/${encodeURIComponent(type)}?snapshotId=${encodeURIComponent(snapshotId)}&compact=1`,{cache:'no-store',credentials:'same-origin'});
        const payload=await response.json().catch(()=>({}));
        if(!response.ok||payload?.ok===false)throw new Error(payload?.error||`HTTP ${response.status}`);
        const state=payload?.state||{};
        const actual=stateTotal(state);
        if(actual!==expected&&expected>0)throw new Error(`${type} 当前快照成员应为 ${expected}，接口返回 ${actual}`);
        states[type]={...state,__v159Provisional:false,__v159ExpectedTotal:expected};
        return states[type];
      }catch(error){
        console.warn('[CE-QC][V159_EXACT_BUSINESS]',type,error?.message||error);
        return states[type]||null;
      }finally{exactLoads.delete(key);}
    })();
    exactLoads.set(key,task);
    return task;
  }

  function pageFromPath(){return PATH_PAGE[location.pathname]||'home';}
  function restoreRouteOwnership(){
    routeGuardQueued=false;
    if(routeGuardBusy||location.pathname==='/whpp')return;
    const whpp=document.getElementById('whppFastPage');
    let lexicalWhpp=false;
    try{lexicalWhpp=typeof currentPage!=='undefined'&&currentPage==='whpp';}catch{}
    const visibleWhpp=Boolean(whpp&&(!whpp.hidden||whpp.classList.contains('active')));
    if(!visibleWhpp&&!lexicalWhpp)return;
    routeGuardBusy=true;
    try{
      const expected=pageFromPath();
      try{if(typeof currentPage!=='undefined')currentPage=expected;}catch{}
      if(whpp){whpp.hidden=true;whpp.classList.remove('active');}
      document.querySelectorAll('.side-link').forEach(node=>node.classList.toggle('active',node.dataset.page===expected));
      if(typeof global.renderPageVisibility==='function')global.renderPageVisibility();
      else if(typeof global.renderAll==='function')global.renderAll();
      console.warn('[CE-QC][V159_ROUTE_GUARD] blocked stale WHPP activation while URL is',location.pathname);
    }finally{routeGuardBusy=false;}
  }
  function queueRouteGuard(){if(routeGuardQueued)return;routeGuardQueued=true;queueMicrotask(restoreRouteOwnership);}

  function installWrappers(){
    const oldRenderAll=global.renderAll;
    if(typeof oldRenderAll==='function'&&!oldRenderAll.__v159Wrapped){
      const wrapped=function(){seedCurrentImport();const result=oldRenderAll.apply(this,arguments);normalizeImportStatus();queueRouteGuard();return result;};
      wrapped.__v159Wrapped=true;global.renderAll=wrapped;
    }

    const oldNavigate=global.navigatePage;
    if(typeof oldNavigate==='function'&&!oldNavigate.__v159Wrapped){
      const wrapped=function(page){seedCurrentImport();const result=oldNavigate.apply(this,arguments);const type=PAGE_TYPE[String(page||'')];if(type)void exactBusinessState(type).then(()=>{try{if(typeof currentPage!=='undefined'&&PAGE_TYPE[currentPage]===type)global.renderAll?.();}catch{}});return result;};
      wrapped.__v159Wrapped=true;global.navigatePage=wrapped;
    }

    const oldHydrate=global.hydratePageData;
    if(typeof oldHydrate==='function'&&!oldHydrate.__v159Wrapped){
      const wrapped=async function(page){seedCurrentImport();const result=await oldHydrate.apply(this,arguments);const type=PAGE_TYPE[String(page||'')];if(type)await exactBusinessState(type);return result;};
      wrapped.__v159Wrapped=true;global.hydratePageData=wrapped;
    }

    const oldImport=global.importUnifiedExcel;
    if(typeof oldImport==='function'&&!oldImport.__v159Wrapped){
      const wrapped=async function(){let before='';try{before=String(unifiedImportState?.snapshotId||'');}catch{}const result=await oldImport.apply(this,arguments);let after='';try{after=String(unifiedImportState?.snapshotId||'');}catch{}if(after&&(after!==before||currentImport()?.reportDate)){seedCurrentImport();normalizeImportStatus();global.renderAll?.();}return result;};
      wrapped.__v159Wrapped=true;global.importUnifiedExcel=wrapped;
    }
  }

  function install(){
    installWrappers();
    seedCurrentImport();
    normalizeImportStatus();
    const observer=new MutationObserver(()=>queueRouteGuard());
    observer.observe(document.querySelector('.app-shell')||document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
    global.addEventListener('popstate',queueRouteGuard);
    document.addEventListener('ce-qc-run-complete',()=>{seedCurrentImport();queueRouteGuard();});
    setTimeout(()=>{if(seedCurrentImport())global.renderAll?.();normalizeImportStatus();queueRouteGuard();},80);
    global.__CE_QC_V159_CURRENT_IMPORT_STABILITY__={version:VERSION,seed:seedCurrentImport,exact:exactBusinessState,routeGuard:restoreRouteOwnership};
    console.info('[CE-QC][V159_CURRENT_IMPORT_STABILITY]',VERSION);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
