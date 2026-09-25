(function installV581StableShell(global){
  'use strict';
  if(global.__CE_QC_V581_STABLE_SHELL__)return;
  const VERSION='2026-09-25-v582-stable-shell-no-observer-storm-v1';
  const doc=global.document;
  const NAV=[
    ['home','首页总看板','home','/'],
    ['ce','CE看板','package','/ce'],
    ['ceaf','CEAF空运看板','package','/ceaf'],
    ['tbkh','TBKH看板','package','/tbkh'],
    ['ali1688','ALI1688看板','package','/ali1688'],
    ['whpp','WHPP本土看板','package','/whpp'],
    ['shopeecn','SHOPEE CN看板','bag','/shopeecn'],
    ['shopeevn','SHOPEE VN看板','bag','/shopeevn'],
    ['import','数据导入','database','/import'],
    ['tracking','轨迹查询','route','/tracking'],
    ['exceptions','异常明细','alert','/exceptions'],
    ['reports','报表导出','clipboard','/reports'],
    ['data-management','数据管理','database','/data-management'],
    ['settings','系统设置','settings','/settings'],
    ['logs','操作日志','clipboard','/logs']
  ];
  const TITLES=Object.fromEntries(NAV.map(([p,l])=>[p,l]));
  const PATH_TO_PAGE=Object.fromEntries(NAV.map(([p,, ,path])=>[path,p]));
  let enforcing=false;
  let observer=null;
  let structuralRepairTimer=0;
  let diagCount=0;

  function currentPage(){
    const p=String(global.location?.pathname||'/').toLowerCase().replace(/\/+$/,'')||'/';
    return PATH_TO_PAGE[p]||'home';
  }
  function targetId(page){
    if(page==='home')return'homePage';
    if(['ce','ceaf','tbkh','ali1688'].includes(page))return'ccslPage';
    if(['shopeecn','shopeevn'].includes(page))return'shopeePage';
    if(page==='whpp')return doc.getElementById('whppFastPage')?'whppFastPage':'shopeePage';
    if(page==='tracking')return'trackPage';
    return page+'Page';
  }
  function safeDiag(event,extra=''){
    if(diagCount>=16)return;
    diagCount+=1;
    try{
      fetch('/api/client-diag?'+new URLSearchParams({
        event:String(event||'').slice(0,48),
        page:currentPage(),
        extra:String(extra||'').slice(0,160),
        v:'581'
      }),{credentials:'same-origin',cache:'no-store',keepalive:true}).catch(()=>{});
    }catch{}
  }
  function isAdmin(){
    return /ADMIN/i.test(String(doc.getElementById('headerUserRole')?.textContent||'')) ||
      [...doc.querySelectorAll('[data-page="data-management"]')].some(n=>!n.hidden);
  }
  function navHref(path){
    const q=new URLSearchParams(global.location?.search||'');
    q.set('auth','v581');
    q.delete('t');
    return path+(q.toString()?'?'+q.toString():'');
  }
  function normalizeNav(){
    const nav=doc.querySelector('.side-nav');
    if(!nav)return false;
    const active=currentPage(),admin=isAdmin();
    const signature=[...nav.children].map(n=>String(n.dataset?.page||'')).join(',');
    const wanted=NAV.map(x=>x[0]).join(',');
    const allNative=[...nav.children].every(n=>n.matches?.('a.side-link[href]'));
    if(signature!==wanted||!allNative){
      nav.replaceChildren(...NAV.map(([page,label,icon,path])=>{
        const a=doc.createElement('a');
        a.className='side-link'+(page===active?' active':'')+(page==='data-management'?' admin-only':'');
        a.dataset.page=page;
        a.dataset.path=path;
        a.href=navHref(path);
        if(page==='data-management'&&!admin)a.hidden=true;
        a.innerHTML='<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-'+icon+'"></use></svg><span class="side-label">'+label+'</span>';
        return a;
      }));
    }else{
      nav.querySelectorAll('.side-link').forEach(a=>{
        const page=String(a.dataset.page||'home');
        a.classList.toggle('active',page===active);
        a.href=navHref(String(a.dataset.path||'/'));
        a.removeAttribute('onclick');
        if(page==='data-management')a.hidden=!admin;
      });
    }
    nav.dataset.v581StableNav='1';
    return true;
  }
  function installStyle(){
    let style=doc.getElementById('ce-qc-v581-stable-shell-style');
    if(style)return style;
    style=doc.createElement('style');
    style.id='ce-qc-v581-stable-shell-style';
    style.textContent=[
      'html,body,.app-stage,.app-shell{visibility:visible!important;opacity:1!important}',
      '.app-stage,.app-shell{display:block!important;min-height:100vh!important}',
      '.sidebar{pointer-events:auto!important;z-index:2000!important}',
      '.side-nav,.side-link{pointer-events:auto!important}',
      '.side-nav a.side-link{display:flex!important;text-decoration:none!important;box-sizing:border-box!important;cursor:pointer!important}',
      '.app-body{display:flex!important;flex-direction:column!important;visibility:visible!important;opacity:1!important;min-height:100vh!important;margin-left:228px!important;padding-top:64px!important;pointer-events:auto!important}',
      '.topbar{display:flex!important;visibility:visible!important;opacity:1!important;position:fixed!important;left:228px!important;right:0!important;top:0!important;height:64px!important;z-index:1000!important;pointer-events:auto!important}',
      '.main-content{display:block!important;visibility:visible!important;opacity:1!important;position:relative!important;z-index:1!important;min-height:calc(100vh - 64px)!important;pointer-events:auto!important}',
      '.app-page[data-v581-active="1"]{display:block!important;visibility:visible!important;opacity:1!important}',
      '.app-page[data-v581-active="0"]{display:none!important}',
      '#ce-qc-v575-coordinate-style{display:none!important}'
    ].join('');
    (doc.head||doc.documentElement).appendChild(style);
    return style;
  }
  function clearLegacyShellSideEffects(){
    try{doc.getElementById('ce-qc-v575-coordinate-style')?.remove();}catch{}
    try{
      const shell=doc.querySelector('.app-shell');
      if(shell?.style){
        shell.style.removeProperty('z-index');
        shell.style.removeProperty('position');
      }
      const sidebar=doc.querySelector('.sidebar');
      if(sidebar?.style)sidebar.style.removeProperty('z-index');
      const topbar=doc.querySelector('.topbar');
      if(topbar?.style)topbar.style.removeProperty('z-index');
    }catch{}
  }
  function showRoute(){
    const page=currentPage(),id=targetId(page);
    const pages=[...doc.querySelectorAll('.app-page')];
    let target=doc.getElementById(id);
    if(!target&&page==='whpp')target=doc.getElementById('shopeePage');
    if(!target)target=doc.getElementById('homePage');
    pages.forEach(node=>{
      const active=node===target;
      node.hidden=!active;
      node.dataset.v581Active=active?'1':'0';
      if(active){
        node.removeAttribute('aria-hidden');
        node.style.setProperty('display','block','important');
        node.style.setProperty('visibility','visible','important');
        node.style.setProperty('opacity','1','important');
      }else{
        node.setAttribute('aria-hidden','true');
        node.style.setProperty('display','none','important');
      }
    });
    const title=doc.getElementById('pageTitle');
    if(title)title.textContent=TITLES[page]||'首页总看板';
    const cc=doc.querySelector('#ccslPage .page-heading h2');
    if(cc&&['ce','ceaf','tbkh','ali1688'].includes(page))cc.textContent=TITLES[page];
    const sh=doc.querySelector('#shopeePage .page-heading h2');
    if(sh&&['shopeecn','shopeevn'].includes(page))sh.textContent=TITLES[page];
    return target;
  }
  function ensureLayout(){
    installStyle();
    clearLegacyShellSideEffects();
    for(const selector of ['.app-stage','.app-shell','.app-body','.topbar','.main-content','.sidebar']){
      const node=doc.querySelector(selector);
      if(!node)continue;
      node.hidden=false;
      node.removeAttribute('inert');
      node.removeAttribute('aria-hidden');
      if(node.style){
        node.style.setProperty('visibility','visible','important');
        node.style.setProperty('opacity','1','important');
        node.style.setProperty('pointer-events','auto','important');
      }
    }
    const topbar=doc.querySelector('.topbar');
    if(topbar?.style)topbar.style.setProperty('display','flex','important');
    const main=doc.querySelector('.main-content');
    if(main?.style)main.style.setProperty('display','block','important');
    const appBody=doc.querySelector('.app-body');
    if(appBody?.style)appBody.style.setProperty('display','flex','important');
  }
  function renderFallbackHomeIfStillEmpty(){
    if(currentPage()!=='home')return;
    const home=doc.getElementById('homePage');
    if(!home)return;
    const rect=home.getBoundingClientRect?.();
    const text=String(home.textContent||'').trim();
    if(rect&&rect.height>80&&text.length>20)return;
    try{
      if(typeof global.renderAll==='function')global.renderAll();
      else if(typeof global.renderHome==='function')global.renderHome();
    }catch(error){safeDiag('V581_RENDER_CALL_ERROR',error?.message||error);}
    showRoute();
  }
  function removeEmptyLargeBlockers(){
    try{
      const vw=Math.max(1,global.innerWidth||1),vh=Math.max(1,global.innerHeight||1);
      const controls=[...doc.querySelectorAll('.side-link[href],.topbar button,.main-content button')];
      for(const control of controls.slice(0,8)){
        const r=control.getBoundingClientRect?.();if(!r||r.width<1||r.height<1)continue;
        const x=r.left+r.width/2,y=r.top+r.height/2;
        const stack=doc.elementsFromPoint?.(x,y)||[];
        for(const node of stack){
          if(node===control||control.contains(node)||node.contains(control))break;
          if(node.closest?.('.modal:not([hidden]),.tracking-drawer:not([hidden]),#accountDropdown:not([hidden]),#v303CleanStartOverlay'))continue;
          const nr=node.getBoundingClientRect?.(),cs=global.getComputedStyle?.(node);
          if(!nr||!cs)continue;
          const area=(nr.width*nr.height)/(vw*vh);
          const pos=String(cs.position||'');
          if(area>=0.30&&['fixed','absolute','sticky'].includes(pos)){
            node.style?.setProperty('pointer-events','none','important');
            node.dataset.ceQcV581RetiredBlocker='1';
          }
        }
      }
    }catch{}
  }
  function enforce(reason='manual'){
    if(enforcing)return;
    enforcing=true;
    try{
      ensureLayout();
      normalizeNav();
      const target=showRoute();
      removeEmptyLargeBlockers();
      doc.documentElement.dataset.ceQcStableShell=VERSION;
      const tr=target?.getBoundingClientRect?.();
      const tb=doc.querySelector('.topbar')?.getBoundingClientRect?.();
      safeDiag('V581_ENFORCE',reason+'|target='+Boolean(target)+'|tr='+(tr?Math.round(tr.width)+'x'+Math.round(tr.height):'none')+'|tb='+(tb?Math.round(tb.width)+'x'+Math.round(tb.height):'none'));
    }finally{enforcing=false;}
  }
  function bind(){
    enforce('bind');
    [50,250,800,1800,3500,7000].forEach(ms=>setTimeout(()=>{enforce('timer-'+ms);renderFallbackHomeIfStillEmpty();},ms));
    doc.addEventListener('click',event=>{
      const link=event.target?.closest?.('.side-nav a.side-link[href]');
      if(!link)return;
      // Native hard navigation is intentional. Do not preventDefault and do not call
      // legacy SPA owners; a fresh document is more reliable than layered click routing.
      safeDiag('V581_NATIVE_NAV',String(link.dataset.page||''));
    },true);
    global.addEventListener('pageshow',()=>enforce('pageshow'),true);
    global.addEventListener('popstate',()=>enforce('popstate'),true);
    if(typeof MutationObserver==='function'){
      observer=new MutationObserver(records=>{
        if(enforcing)return;
        const structural=records.some(r=>[...r.addedNodes].some(n=>n?.nodeType===1)||[...r.removedNodes].some(n=>n?.nodeType===1));
        if(!structural||structuralRepairTimer)return;
        // Do not observe the whole dashboard subtree. Business-card/table/chart rendering
        // produces many childList mutations and a microtask-level shell repair loop can
        // starve Chromium's main thread, which looks exactly like a blank/dead UI.
        structuralRepairTimer=setTimeout(()=>{
          structuralRepairTimer=0;
          enforce('shell-structure-mutation');
        },80);
      });
      const roots=[
        doc.querySelector('.app-shell'),
        doc.querySelector('.sidebar'),
        doc.querySelector('.side-nav')
      ].filter(Boolean);
      for(const root of roots)observer.observe(root,{childList:true});
    }
  }

  global.__CE_QC_V581_STABLE_SHELL__={version:VERSION,enforce,normalizeNav,showRoute};
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  console.info('[CE-QC][V581_STABLE_SHELL]',VERSION,'single stable shell owner: native sidebar links + deterministic route visibility + blank-shell recovery.');
})(window);
