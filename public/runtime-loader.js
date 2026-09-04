(function installCoreRuntimeLoader(global){
  if(global.__CE_QC_CORE_RUNTIME_LOADER__)return;
  const VERSION='system-runtime-loader-v1';
  const loaded=new Set();
  const loading=new Map();
  const ordered={
    core:[
      '/routing-v48.js?v=20260823-v239-1',
      '/v109-instant-business-navigation.js?v=20260823-v239-1',
      '/v108-route-lazy-features.js?v=20260818-v195-1',
      '/v146-unified-import-date-status.js?v=20260901-v410-1',
      '/v164-unified-pause-router.js?v=20260816-1',
      '/v168-seven-business-status.js?v=20260902-v414-status-1',
      '/v169-seven-business-legacy-status-sync.js?v=20260904-v424-1',
      '/v412-seven-business-convergence.js?v=20260904-v420-1',
      '/v206-interactive-first-hotfix.js?v=20260830-v377-1'
    ],
    dashboard:[
      '/v49-dashboard-correctness.js?v=20260811-2',
      '/v50-dashboard-source-truth.js?v=20260812-2',
      '/v51-runtime-fix.js?v=20260812-3',
      '/v106-v55-observer-pause.js?v=20260814-1',
      '/v55-dashboard-reconciliation.js?v=20260811-6',
      '/v106-v55-observer-restore.js?v=20260814-1',
      '/v55-home-drilldown.js?v=20260811-2',
      '/v56-trend-truth.js?v=20260811-2',
      '/v58-drilldown-runtime.js?v=20260811-4',
      '/v61-drilldown-route-bridge.js?v=20260811-1',
      '/v81-startup-source-truth.js?v=20260813-3',
      '/v85-business-rule-ui.js?v=20260813-2',
      '/v89-fast-dashboard.js?v=20260823-v239-1',
      '/v94-business-source-truth-ui-v2.js?v=20260813-2',
      '/v105-fast-render.js?v=20260814-2',
      '/v110-drilldown-prewarm.js?v=20260814-2',
      '/v140-current-business-truth.js?v=20260817-v166-1',
      '/v233-current-outcome-truth.js?v=20260822-v233-1',
      '/v159-current-import-stability.js?v=20260902-v419-open-single-source-1',
      '/v160-current-home-truth.js?v=20260816-1',
      '/v139-carry-manual-window.js?v=20260816-3',
      '/v142-history-integrity-audit.js?v=20260902-v419-priority-1'
    ],
    processing:[
      '/v138-ccsl-scan-progress.js?v=20260827-v338-1',
      '/v135-whpp-retry-aware-run.js?v=20260901-v403-1',
      '/v141-whpp-retry-isolation-ui.js?v=20260816-7'
    ],
    whpp:[
      '/v54-whpp-unified-integration.js?v=20260812-9',
      '/v64-whpp-total-kpi-integration.js?v=20260901-v408-1',
      '/v68-whpp-classification-stability.js?v=20260901-v399-1',
      '/v69-whpp-card-dedup.js?v=20260812-3',
      '/v132-whpp-seven-business-fast.js?v=20260902-display-only-2',
      '/v137-whpp-unified-snapshot-view.js?v=20260815-2',
      '/v133-closure-rate.js?v=20260823-v239-1',
      '/v152-history-key-bridge.js?v=20260816-1',
      '/v152-whpp-trend.js?v=20260817-v172-3',
      '/v170-route-isolation-whpp-priority.js?v=20260901-v404-1'
    ],
    export:[
      '/v190-export-direct-route-client.js?v=20260818-v191-1',
      '/v84-async-export-ui.js?v=20260818-v193-1',
      '/v194-export-token-ui.js?v=20260818-v195-1',
      '/v174-period-export-contract.js?v=20260817-v178-1',
      '/v183-history-refresh.js?v=20260822-v226-1'
    ]
  };

  function key(src){return String(src||'').split('?')[0];}
  function scriptAlreadyPresent(src){
    const target=key(src);
    return [...document.scripts].some(node=>key(node.getAttribute('src')||'')===target);
  }
  function loadOne(src){
    const id=key(src);
    if(loaded.has(id)||scriptAlreadyPresent(src)){loaded.add(id);return Promise.resolve();}
    if(loading.has(id))return loading.get(id);
    const task=new Promise((resolve,reject)=>{
      const node=document.createElement('script');
      node.src=src;node.async=false;node.dataset.ceQcCoreLoader=VERSION;
      node.onload=()=>{loaded.add(id);loading.delete(id);resolve();};
      node.onerror=()=>{loading.delete(id);reject(new Error(`Failed to load ${src}`));};
      document.body.appendChild(node);
    });
    loading.set(id,task);return task;
  }
  async function loadGroup(name){
    for(const src of ordered[name]||[]){
      try{await loadOne(src);}catch(error){console.error('[CE-QC][CORE_RUNTIME_LOADER]',name,error?.message||error);}
    }
  }
  function route(){
    const p=String(location.pathname||'/').toLowerCase();
    if(p==='/')return'/home';
    return p;
  }
  function desiredGroups(){
    const p=route();const groups=['core'];
    if(['/home','/ce','/ceaf','/tbkh','/ali1688','/shopeecn','/shopeevn','/ccsl','/shopee','/exceptions','/tracking'].some(prefix=>p===prefix||p.startsWith(`${prefix}/`)))groups.push('dashboard');
    if(['/import','/data-management'].some(prefix=>p===prefix||p.startsWith(`${prefix}/`)))groups.push('processing');
    if(p==='/whpp'||p.startsWith('/whpp/'))groups.push('whpp','dashboard','processing');
    if(['/reports','/logs'].some(prefix=>p===prefix||p.startsWith(`${prefix}/`)))groups.push('export','dashboard');
    return [...new Set(groups)];
  }
  let routeTask=Promise.resolve();
  function activate(){
    const groups=desiredGroups();
    routeTask=routeTask.then(async()=>{for(const group of groups)await loadGroup(group);});
    return routeTask;
  }
  function scheduleActivate(){
    const run=()=>void activate();
    if(typeof global.requestIdleCallback==='function')global.requestIdleCallback(run,{timeout:300});
    else setTimeout(run,0);
  }
  for(const method of ['pushState','replaceState']){
    const original=history[method];
    if(typeof original==='function')history[method]=function(...args){const result=original.apply(this,args);queueMicrotask(scheduleActivate);return result;};
  }
  global.addEventListener('popstate',scheduleActivate);
  global.addEventListener('hashchange',scheduleActivate);
  global.addEventListener('ce-qc:route-changed',scheduleActivate);
  document.addEventListener('DOMContentLoaded',scheduleActivate,{once:true});
  if(document.readyState!=='loading')scheduleActivate();

  global.__CE_QC_CORE_RUNTIME_LOADER__={version:VERSION,loaded,loadGroup,activate,groups:ordered};
  console.info('[CE-QC][CORE_RUNTIME_LOADER]',VERSION,'route-aware single-load browser runtime enabled');
})(window);