(function installV233CurrentOutcomeTruth(global){
  if(global.__CE_QC_V233_CURRENT_OUTCOME_TRUTH__)return;
  global.__CE_QC_V233_CURRENT_OUTCOME_TRUTH__=true;
  const VERSION='2026-08-22-v233-current-outcome-truth-v1';
  const PAGE_TYPE=Object.freeze({ce:'CE',ceaf:'CEAF',tbkh:'TBKH',ali1688:'ALI1688',shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN'});
  const inflight=new Map();
  const loaded=new Map();

  function own(obj,key){return Boolean(obj&&Object.prototype.hasOwnProperty.call(obj,key));}
  function typeFor(page=''){
    const normalized=String(page||global.currentPage||location.pathname.replace(/^\//,'')).toLowerCase();
    return PAGE_TYPE[normalized]||'';
  }
  function shopeeGroup(type){return type==='SHOPEECN'?'CN':type==='SHOPEEVN'?'VN':'ALL';}
  function outcomeMetrics(state={},type=''){
    const dashboard=state?.dashboard||{};
    if(type.startsWith('SHOPEE')){
      const group=shopeeGroup(type);
      return dashboard?.recipientGroups?.[group]?.metrics
        || dashboard?.recipientGroups?.ALL?.metrics
        || dashboard?.metrics
        || state?.metrics
        || {};
    }
    return dashboard;
  }
  function hasOutcomeTruth(state={},type=''){
    if(!state||typeof state!=='object')return false;
    const metrics=outcomeMetrics(state,type);
    if(type.startsWith('SHOPEE')){
      return ['pod','returned','unresolved','podRate','returnRate','pending1','deliveryStay'].some(key=>own(metrics,key));
    }
    return ['todayPod','podRate','abnormalCount','accounting','categories'].some(key=>own(metrics,key));
  }
  function importedSnapshot(){
    try{return global.unifiedImportState?.snapshotId?global.unifiedImportState:null;}catch{return null;}
  }
  async function readJson(url){
    const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});
    const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{}
    if(!response.ok||payload.ok===false)throw new Error(payload.error||payload.message||`HTTP ${response.status}`);
    return payload;
  }
  function showLoading(type){
    const page=type.startsWith('SHOPEE')?document.getElementById('shopeePage'):document.getElementById('ccslPage');
    if(!page||page.hidden)return;
    let node=page.querySelector('.v233-outcome-loading');
    if(!node){
      node=document.createElement('div');node.className='v233-outcome-loading';
      node.style.cssText='margin:6px 0 10px;padding:8px 12px;border:1px solid #d8e6f5;border-radius:8px;background:#f7fbff;color:#607792;font-size:12px;';
      const heading=page.querySelector('.v18-page-heading');
      (heading?.parentNode||page).insertBefore(node,heading?.nextSibling||page.firstChild);
    }
    node.textContent='正在读取当前POD / 退回 / 未闭环真实状态…';
    node.hidden=false;
  }
  function hideLoading(type){
    const page=type.startsWith('SHOPEE')?document.getElementById('shopeePage'):document.getElementById('ccslPage');
    page?.querySelector('.v233-outcome-loading')?.remove();
  }

  async function ensure(page='',force=false){
    const type=typeFor(page);if(!type||typeof global.businessStates==='undefined')return;
    const current=global.businessStates?.[type]||{};
    const snapshot=String(current.snapshotId||importedSnapshot()?.snapshotId||'');
    const reportDate=String(current.reportDate||global.historyModeDate||importedSnapshot()?.reportDate||'');
    const key=`${type}|${snapshot}|${reportDate}`;
    if(!force&&hasOutcomeTruth(current,type)){
      loaded.set(key,Date.now());hideLoading(type);return current;
    }
    if(!force&&Date.now()-Number(loaded.get(key)||0)<30_000)return current;
    if(inflight.has(key))return inflight.get(key);
    showLoading(type);
    const task=(async()=>{
      try{
        const query=new URLSearchParams({compact:'1'});
        if(snapshot)query.set('snapshotId',snapshot);
        const payload=await readJson(`/api/business-state/${encodeURIComponent(type)}?${query}`);
        const live=payload?.state||{};
        if(!hasOutcomeTruth(live,type))throw new Error(`${type}当前状态只返回了票数，没有POD/退回结果`);
        global.businessStates[type]=live;
        loaded.set(key,Date.now());
        hideLoading(type);
        if(type.startsWith('SHOPEE')){
          try{global.shopeeState=live;}catch{}
        }
        if(typeof global.renderAll==='function')global.renderAll();
        return live;
      }catch(error){
        console.warn('[CE-QC][V233_CURRENT_OUTCOME_TRUTH]',type,error?.message||error);
        const pageRoot=type.startsWith('SHOPEE')?document.getElementById('shopeePage'):document.getElementById('ccslPage');
        const node=pageRoot?.querySelector('.v233-outcome-loading');
        if(node){node.textContent=`当前POD/退回状态读取失败：${String(error?.message||error)}`;node.style.color='#a63a2b';}
        return current;
      }finally{inflight.delete(key);}
    })();
    inflight.set(key,task);return task;
  }

  if(typeof global.hydratePageData==='function'){
    const original=global.hydratePageData;
    global.hydratePageData=async function v233HydratePageData(page){
      const result=await original(page);
      const type=typeFor(page);
      if(type&&!hasOutcomeTruth(global.businessStates?.[type]||{},type))await ensure(page,false);
      return result;
    };
  }
  document.addEventListener('ce-qc-run-complete',()=>setTimeout(()=>void ensure('',true),120));
  document.addEventListener('click',event=>{
    const side=event.target?.closest?.('.side-link[data-page]');
    if(side&&PAGE_TYPE[String(side.dataset.page||'').toLowerCase()])setTimeout(()=>void ensure(side.dataset.page,false),80);
  },true);
  const start=()=>setTimeout(()=>void ensure('',false),100);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  global.__CE_QC_V233_CURRENT_OUTCOME_TRUTH__={version:VERSION,ensure,hasOutcomeTruth,pending:()=>inflight.size};
  console.info('[CE-QC][V233_CURRENT_OUTCOME_TRUTH]',VERSION);
})(window);
