(function installCoreRuntimeLoader(global){
  if(global.__CE_QC_CORE_RUNTIME_LOADER__)return;
  const VERSION='system-runtime-loader-v2';
  const loaded=new Set();
  const loading=new Map();
  const timings=[];
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
    dashboardCore:[
      '/v49-dashboard-correctness.js?v=20260811-2',
      '/v50-dashboard-source-truth.js?v=20260812-2',
      '/v51-runtime-fix.js?v=20260812-3',
      '/v106-v55-observer-pause.js?v=20260814-1',
      '/v55-dashboard-reconciliation.js?v=20260811-6',
      '/v106-v55-observer-restore.js?v=20260814-1',
      '/v81-startup-source-truth.js?v=20260813-3',
      '/v89-fast-dashboard.js?v=20260823-v239-1',
      '/v105-fast-render.js?v=20260814-2',
      '/v140-current-business-truth.js?v=20260817-v166-1',
      '/v233-current-outcome-truth.js?v=20260822-v233-1',
      '/v159-current-import-stability.js?v=20260902-v419-open-single-source-1',
      '/v160-current-home-truth.js?v=20260816-1'
    ],
    dashboardIdle:[
      '/v55-home-drilldown.js?v=20260811-2',
      '/v56-trend-truth.js?v=20260811-2',
      '/v58-drilldown-runtime.js?v=20260811-4',
      '/v61-drilldown-route-bridge.js?v=20260811-1',
      '/v85-business-rule-ui.js?v=20260813-2',
      '/v94-business-source-truth-ui-v2.js?v=20260813-2',
      '/v110-drilldown-prewarm.js?v=20260814-2',
      '/v139-carry-manual-window.js?v=20260816-3',
      '/v142-history-integrity-audit.js?v=20260902-v419-priority-1'
    ],
    processing:[
      '/v138-ccsl-scan-progress.js?v=20260827-v338-1',
      '/v135-whpp-retry-aware-run.js?v=20260901-v403-1',
      '/v141-whpp-retry-isolation-ui.js?v=20260816-7'
    ],
    whppCore:[
      '/v54-whpp-unified-integration.js?v=20260812-9',
      '/v64-whpp-total-kpi-integration.js?v=20260901-v408-1',
      '/v68-whpp-classification-stability.js?v=20260901-v399-1',
      '/v69-whpp-card-dedup.js?v=20260812-3',
      '/v132-whpp-seven-business-fast.js?v=20260902-display-only-2',
      '/v137-whpp-unified-snapshot-view.js?v=20260815-2',
      '/v170-route-isolation-whpp-priority.js?v=20260901-v404-1'
    ],
    whppIdle:[
      '/v133-closure-rate.js?v=20260823-v239-1',
      '/v152-history-key-bridge.js?v=20260816-1',
      '/v152-whpp-trend.js?v=20260817-v172-3'
    ],
    exportCore:[
      '/v190-export-direct-route-client.js?v=20260818-v191-1',
      '/v84-async-export-ui.js?v=20260818-v193-1',
      '/v194-export-token-ui.js?v=20260818-v195-1',
      '/v174-period-export-contract.js?v=20260817-v178-1'
    ],
    exportIdle:[
      '/v183-history-refresh.js?v=20260822-v226-1'
    ]
  };

  const legacyGroups={
    core:ordered.core,
    dashboard:[...ordered.dashboardCore,...ordered.dashboardIdle],
    processing:ordered.processing,
    whpp:[...ordered.whppCore,...ordered.whppIdle],
    export:[...ordered.exportCore,...ordered.exportIdle]
  };
  function now(){return typeof performance!=='undefined'&&typeof performance.now==='function'?performance.now():Date.now();}
  function key(src){return String(src||'').split('?')[0];}
  function scriptAlreadyPresent(src){
    const target=key(src);
    return [...document.scripts].some(node=>key(node.getAttribute('src')||'')===target);
  }
  function loadOne(src){
    const id=key(src);
    if(loaded.has(id)||scriptAlreadyPresent(src)){loaded.add(id);return Promise.resolve('cached');}
    if(loading.has(id))return loading.get(id);
    const started=now();
    const task=new Promise((resolve,reject)=>{
      const node=document.createElement('script');
      node.src=src;node.async=false;node.dataset.ceQcCoreLoader=VERSION;
      node.onload=()=>{
        loaded.add(id);loading.delete(id);
        timings.push({kind:'script',id,elapsedMs:Math.max(0,Math.round(now()-started)),ok:true,at:Date.now()});
        resolve('loaded');
      };
      node.onerror=()=>{
        loading.delete(id);
        timings.push({kind:'script',id,elapsedMs:Math.max(0,Math.round(now()-started)),ok:false,at:Date.now()});
        reject(new Error(`Failed to load ${src}`));
      };
      document.body.appendChild(node);
    });
    loading.set(id,task);return task;
  }
  async function loadGroup(name,phase='critical'){
    const started=now();let failures=0;
    for(const src of ordered[name]||legacyGroups[name]||[]){
      try{await loadOne(src);}catch(error){failures+=1;console.error('[CE-QC][CORE_RUNTIME_LOADER]',phase,name,error?.message||error);}
    }
    const entry={kind:'group',phase,name,elapsedMs:Math.max(0,Math.round(now()-started)),failures,at:Date.now()};
    timings.push(entry);
    console.info('[CE-QC][CORE_RUNTIME_LOADER_TIMING]',JSON.stringify(entry));
    return entry;
  }
  function route(){
    const p=String(location.pathname||'/').toLowerCase();
    if(p==='/')return'/home';
    return p;
  }
  function inRoute(p,prefixes){return prefixes.some(prefix=>p===prefix||p.startsWith(`${prefix}/`));}
  function desiredPlan(){
    const p=route();
    const critical=['core'],idle=[];
    if(inRoute(p,['/home','/ce','/ceaf','/tbkh','/ali1688','/shopeecn','/shopeevn','/ccsl','/shopee','/exceptions','/tracking'])){
      critical.push('dashboardCore');idle.push('dashboardIdle');
    }
    if(inRoute(p,['/import','/data-management']))critical.push('processing');
    if(inRoute(p,['/whpp'])){
      critical.push('whppCore','dashboardCore','processing');
      idle.push('whppIdle','dashboardIdle');
    }
    if(inRoute(p,['/reports','/logs'])){
      critical.push('exportCore','dashboardCore');
      idle.push('exportIdle','dashboardIdle');
    }
    return {route:p,critical:[...new Set(critical)],idle:[...new Set(idle)]};
  }
  function desiredGroups(){
    const plan=desiredPlan();
    return [...new Set([...plan.critical,...plan.idle])];
  }
  let routeTask=Promise.resolve();
  let activationEpoch=0;
  function scheduleIdle(plan,epoch){
    if(!plan.idle.length)return;
    const run=()=>{
      if(epoch!==activationEpoch)return;
      routeTask=routeTask.then(async()=>{
        if(epoch!==activationEpoch)return;
        for(const group of plan.idle)await loadGroup(group,'idle');
      });
    };
    if(typeof global.requestIdleCallback==='function')global.requestIdleCallback(run,{timeout:1200});
    else setTimeout(run,180);
  }
  function activate(){
    const epoch=++activationEpoch;
    const plan=desiredPlan();
    routeTask=routeTask.then(async()=>{
      const started=now();
      for(const group of plan.critical)await loadGroup(group,'critical');
      const entry={kind:'activation',phase:'critical',route:plan.route,groups:plan.critical,elapsedMs:Math.max(0,Math.round(now()-started)),at:Date.now()};
      timings.push(entry);
      console.info('[CE-QC][CORE_RUNTIME_LOADER_TIMING]',JSON.stringify(entry));
      scheduleIdle(plan,epoch);
    });
    return routeTask;
  }
  function scheduleActivate(){queueMicrotask(()=>void activate());}
  for(const method of ['pushState','replaceState']){
    const original=history[method];
    if(typeof original==='function')history[method]=function(...args){const result=original.apply(this,args);scheduleActivate();return result;};
  }
  global.addEventListener('popstate',scheduleActivate);
  global.addEventListener('hashchange',scheduleActivate);
  global.addEventListener('ce-qc:route-changed',scheduleActivate);
  document.addEventListener('DOMContentLoaded',scheduleActivate,{once:true});
  if(document.readyState!=='loading')scheduleActivate();

  global.__CE_QC_CORE_RUNTIME_LOADER__={
    version:VERSION,loaded,loadGroup,activate,desiredPlan,desiredGroups,
    groups:legacyGroups,phasedGroups:ordered,timings,
    inspect(){return {version:VERSION,route:route(),plan:desiredPlan(),loaded:[...loaded],loading:[...loading.keys()],timings:timings.slice(-80)};}
  };
  console.info('[CE-QC][CORE_RUNTIME_LOADER]',VERSION,'critical-first + idle-enhancement route runtime enabled');
})(window);