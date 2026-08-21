(function installV203DashboardStability(global){
  if(global.__CE_QC_V203_DASHBOARD_STABILITY__)return;
  const VERSION='2026-08-21-v203-dashboard-route-status-stability-v1';
  const PATH_PAGE={
    '/':'home','/home':'home','/ce':'ce','/ceaf':'ceaf','/tbkh':'tbkh','/ali1688':'ali1688',
    '/shopeecn':'shopeecn','/shopeevn':'shopeevn','/import':'import','/tracking':'tracking','/track':'tracking',
    '/exceptions':'exceptions','/reports':'reports','/data-management':'data-management','/settings':'settings','/logs':'logs'
  };
  let busy=false;
  let queued=false;

  function cleanPath(){return String(location.pathname||'/').replace(/\/+$/,'')||'/';}
  function intendedPage(){return PATH_PAGE[cleanPath()]||'';}
  function dateText(){
    const candidates=[document.getElementById('topRangeTo')?.value,document.getElementById('dashboardRangeTo')?.value];
    try{candidates.push(unifiedImportState?.reportDate);}catch{}
    for(const value of candidates){const text=String(value||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;}
    return '';
  }
  function isValidationCopy(text=''){
    return /已先显示本机最近验证数据|后台正在校验最新值|正在后台校验最新WHPP摘要|正在后台校验/.test(String(text||''));
  }
  function normalizeStatusCopy(){
    const path=cleanPath();
    const date=dateText();
    document.querySelectorAll('.processing-notice,.global-processing-notice').forEach(node=>{
      if(isValidationCopy(node.textContent||''))node.remove();
    });
    const page=path==='/whpp'?document.getElementById('whppFastPage'):
      ['/ce','/ceaf','/tbkh','/ali1688'].includes(path)?document.getElementById('ccslPage'):
      ['/shopeecn','/shopeevn'].includes(path)?document.getElementById('shopeePage'):null;
    const heading=page?.querySelector('.v18-page-heading p');
    if(heading&&isValidationCopy(heading.textContent||'')){
      let completed=false;
      try{
        const type=path==='/ceaf'?'CEAF':path==='/ce'?'CE':path==='/tbkh'?'TBKH':path==='/ali1688'?'ALI1688':path==='/shopeecn'?'SHOPEECN':path==='/shopeevn'?'SHOPEEVN':'';
        const state=type?businessStates?.[type]:null;
        const status=String(state?.snapshotStatus||'').toUpperCase();
        completed=['COMPLETED','COMPLETED_WITH_RETRY'].includes(status)&&(!date||String(state?.reportDate||'').slice(0,10)===date);
      }catch{}
      heading.textContent=`日报 ${date||'—'}${completed?' · 数据来自当前业务有效快照':''}`;
    }
  }

  function restoreRouteOwnership(){
    queued=false;
    if(busy)return;
    const path=cleanPath();
    if(path==='/whpp'){normalizeStatusCopy();return;}
    const intended=intendedPage();
    if(!intended)return;
    const whpp=document.getElementById('whppFastPage');
    let lexicalWhpp=false;
    try{lexicalWhpp=typeof currentPage!=='undefined'&&String(currentPage)==='whpp';}catch{}
    const visibleWhpp=Boolean(whpp&&(!whpp.hidden||whpp.classList.contains('active')));
    if(!visibleWhpp&&!lexicalWhpp){normalizeStatusCopy();return;}
    busy=true;
    try{
      if(whpp){whpp.hidden=true;whpp.classList.remove('active');}
      try{if(typeof currentPage!=='undefined')currentPage=intended;}catch{}
      document.querySelectorAll('.side-link[data-page]').forEach(node=>node.classList.toggle('active',String(node.dataset.page||'')===intended));
      if(typeof global.renderPageVisibility==='function')global.renderPageVisibility();
      if(typeof global.renderTopbar==='function')global.renderTopbar();
      if(typeof global.renderAll==='function')global.renderAll();
      console.warn('[CE-QC][V203_ROUTE_GUARD] ignored late WHPP render on',path,'restored',intended);
    }catch(error){console.warn('[CE-QC][V203_ROUTE_GUARD] restore failed',error);}
    finally{busy=false;normalizeStatusCopy();}
  }
  function schedule(){if(queued)return;queued=true;queueMicrotask(restoreRouteOwnership);}

  const observer=new MutationObserver(schedule);
  function install(){
    observer.observe(document.querySelector('.app-shell')||document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
    global.addEventListener('popstate',schedule);
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page],#topRangeQuery'))setTimeout(schedule,0);},true);
    document.addEventListener('ce-qc-run-complete',()=>setTimeout(schedule,0));
    setInterval(()=>{if(cleanPath()!=='/whpp')restoreRouteOwnership();else normalizeStatusCopy();},1000);
    schedule();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  global.__CE_QC_V203_DASHBOARD_STABILITY__={version:VERSION,restore:restoreRouteOwnership,normalizeStatusCopy};
  console.info('[CE-QC][V203_DASHBOARD_STABILITY]',VERSION);
})(window);
