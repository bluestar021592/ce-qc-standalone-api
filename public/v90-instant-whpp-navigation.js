(function installInstantWhppNavigationV90(global){
  if(global.__CE_QC_V90_INSTANT_WHPP_NAV__)return;
  const VERSION='2026-08-31-v393-whpp-dedicated-host-delegation-v1';
  let navigating=false;

  function ensureNav(){
    const nav=document.querySelector('.side-nav');
    if(!nav)return;
    let button=nav.querySelector('[data-page="whpp"]');
    if(!button){
      button=document.createElement('button');
      button.className='side-link';
      button.dataset.page='whpp';
      button.dataset.path='/whpp';
      button.innerHTML='<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-package"></use></svg><span class="side-label">WHPP本土看板</span>';
      const anchor=nav.querySelector('[data-page="ali1688"]');
      if(anchor?.nextSibling)nav.insertBefore(button,anchor.nextSibling);else nav.appendChild(button);
    }
  }

  function ensureDedicatedPage(){
    let page=document.getElementById('whppFastPage');
    if(page)return page;
    page=document.createElement('section');
    page.id='whppFastPage';
    page.className='app-page v18-dashboard-page v18-business-page';
    page.hidden=true;
    document.querySelector('main.main-content')?.appendChild(page);
    return page;
  }

  function activateDedicatedPlaceholder(push=true){
    ensureNav();
    if(push&&location.pathname!=='/whpp')history.pushState({page:'whpp'},'', '/whpp');
    if(location.pathname!=='/whpp')return null;
    const page=ensureDedicatedPage();
    document.querySelectorAll('.app-page').forEach(node=>{
      node.hidden=node!==page;
      node.classList.toggle('active',node===page);
    });
    document.querySelectorAll('.side-link').forEach(node=>node.classList.toggle('active',node.dataset.page==='whpp'));
    const title=document.getElementById('pageTitle');
    if(title)title.textContent='WHPP本土看板';
    try{currentPage='whpp';}catch{}
    if(!page.firstElementChild)page.innerHTML='<div class="empty-state">正在读取WHPP轻量摘要…</div>';
    return page;
  }

  function delegate(push=true){
    if(navigating)return;
    navigating=true;
    try{
      const canonical=global.__CE_QC_V132_WHPP_FAST__?.navigate;
      if(typeof canonical==='function'){
        void Promise.resolve(canonical(push)).catch(error=>console.warn('[CE-QC][V90_WHPP] canonical navigation skipped',error));
        return;
      }
      activateDedicatedPlaceholder(push);
    }finally{
      queueMicrotask(()=>{navigating=false;});
    }
  }

  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('.side-link[data-page="whpp"]');
    if(!button)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    delegate(true);
  },true);

  global.addEventListener('popstate',()=>{
    if(location.pathname==='/whpp')delegate(false);
  });

  ensureNav();
  if(location.pathname==='/whpp')delegate(false);
  global.__CE_QC_V90_INSTANT_WHPP_NAV__={
    version:VERSION,
    navigate:delegate,
    render:()=>{if(location.pathname==='/whpp')activateDedicatedPlaceholder(false);},
    dedicatedHost:true,
    legacyShopeeHostRetired:true
  };
  console.info('[CE-QC][V393_WHPP_NAV_ISOLATION]',VERSION,'legacy WHPP navigation no longer mutates shopeePage/tbkhPage; V132 is the sole WHPP body renderer.');
})(window);
