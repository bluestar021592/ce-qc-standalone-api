(function installRouteLazyFeaturesV108(global){
  if(global.__CE_QC_V108_ROUTE_LAZY__?.version==='2026-09-15-v545-explicit-purge-owner-v1')return;
  const VERSION='2026-09-15-v545-explicit-purge-owner-v1';
  const loaded=new Map();
  const groups={
    shopee:[
      '/whpp-v44.js?v=20260812-2','/whpp-v45-cleanup.js?v=20260811-2','/whpp-v47-auto-run.js?v=20260812-4',
      '/v52-whpp-source-truth-route.js?v=20260811-1','/v54-whpp-unified-integration.js?v=20260812-9',
      '/v64-whpp-total-kpi-integration.js?v=20260812-2','/v68-whpp-classification-stability.js?v=20260812-4',
      '/v69-whpp-card-dedup.js?v=20260812-3','/v72-whpp-light-state-bridge.js?v=20260812-1',
      '/v90-instant-whpp-navigation.js?v=20260813-1','/v93-shopee-resume-ui.js?v=20260813-2',
      '/v94-business-source-truth-ui-v2.js?v=20260813-2'
    ],
    import:['/v66-import-success-whpp.js?v=20260812-1','/v96-v67-live-progress-bridge.js?v=20260813-1'],
    reports:['/v190-export-direct-route-client.js?v=20260818-v191-1','/v84-async-export-ui.js?v=20260818-v193-1','/v194-export-token-ui.js?v=20260818-v195-1'],
    settings:['/v62-network-settings-runtime.js?v=20260812-1'],
    // V104 is intentionally retired from the active data-management path.
    // V505 is the single purge owner; V106 remains only as a compatibility UI guard
    // for already-open/stale pages and does not install a competing purge workflow.
    data:['/v505-data-purge-recovery.js?v=20260920-v555-1','/v106-purge-legacy-controls-hide.js?v=20260915-v545-1'],
    carry:['/v99-carry-live-ui.js?v=20260814-1']
  };

  function normalized(src){try{return new URL(src,location.href).href;}catch{return src;}}
  function loadScript(src){
    if(loaded.has(src))return loaded.get(src);
    const exact=normalized(src);
    const path=src.split('?')[0];
    const existing=[...document.scripts].find(node=>String(node.src||'').includes(path));
    if(existing&&String(existing.src||'')===exact){const p=Promise.resolve(existing);loaded.set(src,p);return p;}
    if(existing){
      existing.dataset.ceQcRetiredVersion='1';
      try{existing.remove();}catch{}
    }
    const promise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=src;script.async=false;script.dataset.ceQcLazy='v545';
      script.onload=()=>resolve(script);script.onerror=()=>reject(new Error(`加载页面功能失败：${src}`));document.head.appendChild(script);
    }).catch(error=>{loaded.delete(src);console.warn('[CE-QC][V108_LAZY]',error);throw error;});
    loaded.set(src,promise);return promise;
  }
  async function loadGroup(name){for(const src of groups[name]||[])await loadScript(src);}
  function pageNow(){const path=location.pathname.toLowerCase();return path==='/'?'home':path.replace(/^\//,'')||'home';}
  async function ensurePage(page=pageNow()){
    const p=String(page||'').toLowerCase();const jobs=[];
    if(['shopeecn','shopeevn','shopee','whpp'].includes(p))jobs.push(loadGroup('shopee'));
    if(p==='import')jobs.push(loadGroup('shopee'),loadGroup('import'));
    if(p==='reports')jobs.push(loadGroup('reports'));
    if(p==='settings')jobs.push(loadGroup('settings'));
    if(p==='data-management')jobs.push(loadGroup('data'));
    if(p==='exceptions')jobs.push(loadGroup('carry'));
    if(!jobs.length)return;
    await Promise.all(jobs);
    if(typeof global.renderAll==='function')setTimeout(()=>global.renderAll(),0);
  }
  function purgeOwner(){return global.__CE_QC_V505_DATA_PURGE_RECOVERY__?.openDataPurge;}
  function reassertPurgeOwner(){
    const owner=purgeOwner();
    if(typeof owner!=='function')return false;
    global.openDataPurge=owner;
    try{openDataPurge=owner;}catch{}
    return true;
  }
  document.addEventListener('click',event=>{
    const purgeTrigger=event.target?.closest?.('[data-testid="one-click-purge-home"],.danger-outline[onclick*="openDataPurge"]');
    if(purgeTrigger){
      const patch=String(global.__CE_QC_V505_DATA_PURGE_RECOVERY__?.patchId||'');
      if(patch.includes('v555-visible-execute-progress')&&reassertPurgeOwner())return;
      // Capture-phase gate: no legacy owner may receive the destructive click.
      // Load the cache-busted V545 owner first. V545 itself opens an inert wizard;
      // backup starts only after an explicit second click on “备份并继续”.
      event.preventDefault();
      event.stopImmediatePropagation();
      void loadGroup('data').then(()=>{
        const installed=String(global.__CE_QC_V505_DATA_PURGE_RECOVERY__?.patchId||'');
        if(!installed.includes('v555-visible-execute-progress')||!reassertPurgeOwner())throw new Error('V545 清空任务控制器尚未就绪。');
        purgeOwner()();
      }).catch(error=>{
        console.warn('[CE-QC][V545_PURGE_OWNER_GATE]',error);
        global.alert?.('清空任务控制器加载失败，未启动任何清空或备份任务。请刷新页面后重试。');
      });
      return;
    }
    if(event.target?.closest?.('.side-link,[data-page]'))setTimeout(()=>void ensurePage(pageNow()),0);
  },true);
  global.addEventListener('popstate',()=>setTimeout(()=>void ensurePage(pageNow()),0));
  setTimeout(()=>void ensurePage(pageNow()),0);
  global.__CE_QC_V108_ROUTE_LAZY__={version:VERSION,ensurePage,loadGroup,loadedCount:()=>loaded.size,reassertPurgeOwner};
  console.info('[CE-QC][V108_ROUTE_LAZY]',VERSION);
})(window);
