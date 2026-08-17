(function installRouteLazyFeaturesV108(global){
  if(global.__CE_QC_V108_ROUTE_LAZY__?.version==='2026-08-17-v187-route-lazy-export-ui-force-reload-v1')return;
  const VERSION='2026-08-17-v187-route-lazy-export-ui-force-reload-v1';
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
    reports:['/v84-async-export-ui.js?v=20260817-v187-1'],
    settings:['/v62-network-settings-runtime.js?v=20260812-1'],
    data:['/v104-fast-purge-ui.js?v=20260814-8','/v106-purge-legacy-controls-hide.js?v=20260814-1'],
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
      const script=document.createElement('script');script.src=src;script.async=false;script.dataset.ceQcLazy='v187';
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
  document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link,[data-page]'))setTimeout(()=>void ensurePage(pageNow()),0);},true);
  global.addEventListener('popstate',()=>setTimeout(()=>void ensurePage(pageNow()),0));
  setTimeout(()=>void ensurePage(pageNow()),0);
  global.__CE_QC_V108_ROUTE_LAZY__={version:VERSION,ensurePage,loadGroup,loadedCount:()=>loaded.size};
  console.info('[CE-QC][V108_ROUTE_LAZY]',VERSION);
})(window);
