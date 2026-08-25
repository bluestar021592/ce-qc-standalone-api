(function installV302OneShotOwner(global){
  if(global.__CE_QC_V302_ONE_SHOT_OWNER__)return;
  const VERSION='2026-08-25-v302-one-shot-exact-daily-owner-v1';
  const originalLoadCustom=typeof global.loadCustomDashboardRange==='function'?global.loadCustomDashboardRange.bind(global):null;
  const originalNavigate=typeof global.navigatePage==='function'?global.navigatePage.bind(global):null;
  let exactGeneration=0;

  const text=v=>String(v||'').trim();
  function statusNode(){return document.getElementById('topRangeStatus')||document.getElementById('dashboardRangeStatus');}
  function canonicalize(){try{global.normalizeTopNavigation?.();}catch(error){console.warn('[CE-QC][V302] sidebar canonicalization skipped:',error?.message||error);}}
  function sameDay(from,to){return /^\d{4}-\d{2}-\d{2}$/.test(from)&&from===to;}

  global.loadCustomDashboardRange=async function v302LoadCustomDashboardRange(fromDate='',toDate='',shouldRender=true){
    const from=text(fromDate||document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value);
    const to=text(toDate||document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value);
    if(!sameDay(from,to)){
      if(!originalLoadCustom)throw new Error('范围看板读取器不可用');
      return originalLoadCustom(from,to,shouldRender);
    }

    const generation=++exactGeneration;
    const status=statusNode();
    if(status)status.textContent='正在读取单日日报…';
    try{
      if(typeof global.loadDashboardDate!=='function')throw new Error('单日日报读取器不可用');
      // Single-day queries are exact daily snapshot reads. Never route them through
      // /api/period-dashboard: that endpoint is intentionally reserved for true
      // multi-day ranges and must never overwrite daily business state late.
      await global.loadDashboardDate(from);
      if(generation!==exactGeneration)return;
      canonicalize();
      if(shouldRender&&typeof global.renderAll==='function')global.renderAll();
      global.dispatchEvent(new CustomEvent('ce:exact-date-loaded',{detail:{reportDate:from,owner:VERSION}}));
      if(status)status.textContent=`${from} · 单日精确日报已加载`;
      return {ok:true,reportDate:from,exactDaily:true,owner:VERSION};
    }catch(error){
      if(generation===exactGeneration&&status)status.textContent=`读取失败：${error?.message||error}`;
      throw error;
    }
  };

  if(originalNavigate){
    global.navigatePage=function v302NavigatePage(page,anchor=''){
      const result=originalNavigate(page,anchor);
      canonicalize();
      return result;
    };
  }

  document.addEventListener('click',event=>{
    if(event.target?.closest?.('.side-link[data-page]'))queueMicrotask(canonicalize);
  },true);
  global.addEventListener('popstate',()=>queueMicrotask(canonicalize));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',canonicalize,{once:true});else canonicalize();

  global.__CE_QC_V302_ONE_SHOT_OWNER__={version:VERSION,exactDaily:true,canonicalize};
  console.info('[CE-QC][V302_ONE_SHOT_OWNER]',VERSION,'single-day date range uses exact snapshot only; period-dashboard is multi-day only; navigation keeps one canonical sidebar without a DOM observer.');
})(window);
