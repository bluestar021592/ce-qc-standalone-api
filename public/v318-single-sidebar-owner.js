(function installV318SingleSidebarOwner(global){
  if(global.__CE_QC_V318_SINGLE_SIDEBAR_OWNER__)return;
  const VERSION='2026-08-26-v318-single-sidebar-hard-owner-v1';
  const NAV_ITEMS=[
    ['home','首页总看板','home','/'],['ce','CE看板','package','/ce'],['ceaf','CEAF空运看板','package','/ceaf'],['tbkh','TBKH看板','package','/tbkh'],['ali1688','ALI1688看板','package','/ali1688'],['whpp','WHPP本土看板','package','/whpp'],
    ['shopeecn','SHOPEE CN看板','bag','/shopeecn'],['shopeevn','SHOPEE VN看板','bag','/shopeevn'],['import','数据导入','database','/import'],['tracking','轨迹查询','route','/tracking'],['exceptions','异常明细','alert','/exceptions'],['reports','报表导出','clipboard','/reports'],['data-management','数据管理','database','/data-management'],['settings','系统设置','settings','/settings'],['logs','操作日志','clipboard','/logs']
  ];
  let repairing=false,timer=null;
  const path=()=>String(location.pathname||'/').toLowerCase().replace(/\/+$/,'')||'/';
  const activePage=()=>({
    '/':'home','/home':'home','/ce':'ce','/ceaf':'ceaf','/tbkh':'tbkh','/ali1688':'ali1688','/whpp':'whpp','/shopeecn':'shopeecn','/shopeevn':'shopeevn','/import':'import','/tracking':'tracking','/exceptions':'exceptions','/reports':'reports','/data-management':'data-management','/settings':'settings','/logs':'logs'
  })[path()]||'home';
  function adminVisible(){return /ADMIN/i.test(String(document.getElementById('headerUserRole')?.textContent||''));}
  function buildButton([page,label,icon,target],active,showAdmin){
    const button=document.createElement('a');
    button.className=`side-link ${page===active?'active':''} ${page==='data-management'?'admin-only':''}`.trim();
    button.dataset.page=page;button.dataset.path=target;button.href=`${target}?auth=v581`;
    if(page==='data-management'&&!showAdmin)button.hidden=true;
    button.innerHTML=`<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-${icon}"></use></svg><span class="side-label">${label}</span>`;
    return button;
  }
  function navIsCanonical(nav){
    if(!nav)return false;
    const links=[...nav.children].filter(node=>node.matches?.('.side-link'));
    if(links.length!==NAV_ITEMS.length||nav.children.length!==NAV_ITEMS.length)return false;
    return links.every((node,index)=>String(node.dataset.page||'')===NAV_ITEMS[index][0]&&String(node.querySelector('.side-label')?.textContent||'').trim()===NAV_ITEMS[index][1]);
  }
  function canonicalSidebar(){
    if(repairing)return false;repairing=true;
    try{
      const sidebars=[...document.querySelectorAll('.sidebar')];
      if(!sidebars.length)return false;
      const sidebar=sidebars[0];
      sidebars.slice(1).forEach(node=>node.remove());
      const brand=sidebar.querySelector(':scope > .sidebar-brand')||sidebar.querySelector('.sidebar-brand');
      const collapse=sidebar.querySelector(':scope > .sidebar-collapse')||sidebar.querySelector('.sidebar-collapse');
      const status=sidebar.querySelector(':scope > #sideSystemStatus')||sidebar.querySelector('#sideSystemStatus');
      let nav=sidebar.querySelector(':scope > .side-nav');
      if(!nav){nav=document.createElement('nav');nav.className='side-nav';}
      // Hard owner: every other direct sidebar child is legacy/duplicate UI and must go.
      [...sidebar.children].forEach(node=>{
        if(node!==brand&&node!==nav&&node!==collapse&&node!==status)node.remove();
      });
      // Remove nested or later-inserted duplicate navigation roots/wrappers as well.
      [...sidebar.querySelectorAll('.side-nav')].filter(node=>node!==nav).forEach(node=>node.remove());
      const active=activePage(),showAdmin=adminVisible();
      if(!navIsCanonical(nav)){
        nav.replaceChildren(...NAV_ITEMS.map(item=>buildButton(item,active,showAdmin)));
      }else{
        nav.querySelectorAll('.side-link').forEach(node=>node.classList.toggle('active',String(node.dataset.page||'')===active));
        const admin=nav.querySelector('[data-page="data-management"]');if(admin)admin.hidden=!showAdmin;
      }
      if(brand&&brand.parentNode!==sidebar)sidebar.prepend(brand);
      if(nav.parentNode!==sidebar){collapse?sidebar.insertBefore(nav,collapse):sidebar.appendChild(nav);}
      if(collapse&&collapse.parentNode!==sidebar)sidebar.appendChild(collapse);
      if(status&&status.parentNode!==sidebar)sidebar.appendChild(status);
      sidebar.dataset.v318SingleSidebar='1';
      return true;
    }finally{repairing=false;}
  }
  function harmonizeCompletionBanner(){
    const page=document.getElementById('importPage');if(!page)return;
    const text=String(page.textContent||'').replace(/\s+/g,' ');
    const allDone=/CCSL\s*已完成/i.test(text)&&/SHOPEE CN\/VN\s*已完成/i.test(text)&&/WHPP本土\s*已完成/i.test(text)&&/七业务已完成/i.test(text);
    if(!allDone)return;
    const top=document.getElementById('globalProcessingNotice');
    if(top){
      top.hidden=false;top.className='global-processing-notice success';
      top.innerHTML='<span><strong>七业务处理完成</strong> · CCSL、SHOPEE CN/VN、WHPP本土均已完成</span>';
      top.dataset.v318Truth='all-complete';
    }
  }
  function enforce(){canonicalSidebar();harmonizeCompletionBanner();}
  function bind(){
    [0,60,250,800,1800,3500].forEach(ms=>setTimeout(enforce,ms));
    timer=setInterval(enforce,1200);
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link,[data-testid="global-auto-process"],#topRangeQuery,.top-range-query'))setTimeout(enforce,80);},true);
    global.addEventListener('popstate',()=>setTimeout(enforce,50));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(enforce,50);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V318_SINGLE_SIDEBAR_OWNER__={version:VERSION,canonicalSidebar,harmonizeCompletionBanner,enforce};
  console.info('[CE-QC][V318_SINGLE_SIDEBAR_OWNER]',VERSION,'hard canonical sidebar owner removes every legacy direct-child/wrapper duplicate; all-complete import banner is unified across CCSL/SHOPEE/WHPP.');
})(window);
