(function installV274TrendSpeedGuard(global){
  if(global.__CE_QC_V274_TREND_SPEED_GUARD__)return;
  const ID='2026-08-24-v274-single-row-fast-trend-guard-v1';
  let scheduled=false;
  const LOADING_RE=/正在读取(?:最近有效日报|趋势|派次趋势)|后台正在刷新最近有效日报/;
  function visiblePage(){return [...document.querySelectorAll('.app-page')].find(n=>!n.hidden&&getComputedStyle(n).display!=='none')||document;}
  function hasRenderedChart(node){return !!node?.querySelector?.('svg,canvas,.trend-svg,.v18-chart-svg,[data-chart-ready="1"]');}
  function cleanSection(section){
    if(!section)return;
    section.querySelectorAll('.v272-skeleton-grid').forEach(n=>n.remove());
    const grids=[...section.querySelectorAll('.v18-chart-grid,.v272-trend-grid,.v271-trend-grid')];
    const rendered=grids.filter(hasRenderedChart);
    const keep=rendered[0]||grids.find(g=>![...g.querySelectorAll('.v18-chart-card')].every(card=>LOADING_RE.test(String(card.textContent||''))))||grids[0];
    for(const grid of grids){
      if(grid===keep)continue;
      const loadingOnly=LOADING_RE.test(String(grid.textContent||''))||!hasRenderedChart(grid);
      if(loadingOnly)grid.remove();
    }
    section.querySelectorAll('.v18-chart-card').forEach(card=>{
      if(LOADING_RE.test(String(card.textContent||''))&&!hasRenderedChart(card)){
        const parent=card.parentElement;
        if(parent&&parent!==keep&&parent.querySelectorAll('.v18-chart-card').length===parent.children.length)parent.remove();
      }
    });
    const status=section.querySelector('.v272-status');
    if(keep&&hasRenderedChart(keep)&&status&&LOADING_RE.test(String(status.textContent||'')))status.textContent='已显示最近一次可用趋势，后台正在快速校准最新状态…';
    section.dataset.v274SingleRow='1';
  }
  function clean(){
    scheduled=false;
    const root=visiblePage();
    root.querySelectorAll?.('.v18-trend-section').forEach(cleanSection);
    // Specialized attempt panels may also inherit an obsolete loading-only row.
    root.querySelectorAll?.('#v272AttemptPanel,#v263DeliveryKpiPanel').forEach(panel=>{
      panel.querySelectorAll('.v272-skeleton-grid').forEach(n=>n.remove());
      panel.querySelectorAll('.v18-chart-card').forEach(card=>{if(LOADING_RE.test(String(card.textContent||''))&&!hasRenderedChart(card))card.closest('.v18-chart-grid,.v272-trend-grid,.v271-trend-grid')?.remove();});
    });
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>setTimeout(clean,0));}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
  document.addEventListener('click',e=>{if(e.target?.closest?.('.side-link[data-page],#topRangeQuery'))setTimeout(schedule,60);},false);
  const observer=new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1)))schedule();});
  observer.observe(document.documentElement,{subtree:true,childList:true});
  global.__CE_QC_V274_TREND_SPEED_GUARD__={id:ID,clean};
  console.info('[CE-QC][V274_TREND_SPEED_GUARD]',ID,'keeps one visible trend row; removes loading-only duplicates; never intercepts navigation.');
})(window);
