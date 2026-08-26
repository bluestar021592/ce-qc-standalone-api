(function installV309UiIntegrity(global){
  if(global.__CE_QC_V309_UI_INTEGRITY__)return;
  const VERSION='2026-08-26-v309-single-nav-auto-resume-shopee-total-v1';
  const NAV_ITEMS=[
    ['home','首页总看板','home','/'],['ce','CE看板','package','/ce'],['ceaf','CEAF空运看板','package','/ceaf'],['tbkh','TBKH看板','package','/tbkh'],['ali1688','ALI1688看板','package','/ali1688'],['whpp','WHPP本土看板','package','/whpp'],
    ['shopeecn','SHOPEE CN看板','bag','/shopeecn'],['shopeevn','SHOPEE VN看板','bag','/shopeevn'],['import','数据导入','database','/import'],['tracking','轨迹查询','route','/tracking'],['exceptions','异常明细','alert','/exceptions'],['reports','报表导出','clipboard','/reports'],['data-management','数据管理','database','/data-management'],['settings','系统设置','settings','/settings'],['logs','操作日志','clipboard','/logs']
  ];
  let navRepairing=false,boardTimer=null,resumeTimer=null,lastResumeAt=0,lastResumeDate='';
  const date=v=>String(v||'').slice(0,10);
  const fmt=v=>Number.isFinite(Number(v))?Number(v).toLocaleString('zh-CN'):'—';
  const path=()=>String(location.pathname||'/').toLowerCase().replace(/\/+$/,'')||'/';
  const currentPage=()=>({
    '/':'home','/home':'home','/ce':'ce','/ceaf':'ceaf','/tbkh':'tbkh','/ali1688':'ali1688','/whpp':'whpp','/shopeecn':'shopeecn','/shopeevn':'shopeevn','/import':'import','/tracking':'tracking','/exceptions':'exceptions','/reports':'reports','/data-management':'data-management','/settings':'settings','/logs':'logs'
  })[path()]||'home';
  function navSignature(nav){return[...nav.children].filter(n=>n.matches?.('.side-link')).map(n=>`${String(n.dataset.page||'')}|${String(n.querySelector('.side-label')?.textContent||'').trim()}`).join('>');}
  function canonicalSidebar(){
    if(navRepairing)return;navRepairing=true;
    try{
      const sidebars=[...document.querySelectorAll('.sidebar')];if(!sidebars.length)return;
      const sidebar=sidebars[0];sidebars.slice(1).forEach(node=>node.remove());
      let nav=sidebar.querySelector('.side-nav');if(!nav){nav=document.createElement('nav');nav.className='side-nav';const collapse=sidebar.querySelector('.sidebar-collapse');collapse?sidebar.insertBefore(nav,collapse):sidebar.appendChild(nav);}
      [...sidebar.querySelectorAll('.side-nav')].filter(node=>node!==nav).forEach(node=>node.remove());
      const adminVisible=/ADMIN/i.test(String(document.getElementById('headerUserRole')?.textContent||''))||[...nav.querySelectorAll('[data-page="data-management"]')].some(node=>!node.hidden);
      const active=currentPage();
      const wanted=NAV_ITEMS.map(([page,label])=>`${page}|${label}`).join('>');
      if(navSignature(nav)!==wanted||nav.querySelectorAll('.side-link').length!==NAV_ITEMS.length){
        nav.innerHTML=NAV_ITEMS.map(([page,label,icon,target])=>`<button class="side-link ${page===active?'active':''} ${page==='data-management'?'admin-only':''}" data-page="${page}" data-path="${target}" onclick="navigatePage('${page}')" ${page==='data-management'&&!adminVisible?'hidden':''}><svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-${icon}"></use></svg><span class="side-label">${label}</span></button>`).join('');
      }else{
        nav.querySelectorAll('.side-link').forEach(node=>node.classList.toggle('active',String(node.dataset.page||'')===active));
        const admin=nav.querySelector('[data-page="data-management"]');if(admin)admin.hidden=!adminVisible;
      }
      sidebar.querySelectorAll(':scope > .side-link,:scope > .side-sub,:scope > .side-group,:scope > .side-group-title').forEach(node=>node.remove());
      sidebar.dataset.v309SingleNav='1';
    }finally{navRepairing=false;}
  }
  function selectedRange(){
    const to=date(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'');
    const from=date(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to);
    return{from,to};
  }
  function activeShopeeType(){const p=path();return p==='/shopeecn'?'SHOPEECN':p==='/shopeevn'?'SHOPEEVN':'';}
  function activeRoot(){return[...document.querySelectorAll('.app-page')].find(node=>!node.hidden&&getComputedStyle(node).display!=='none')||null;}
  async function patchShopeeBoard(){
    const type=activeShopeeType(),root=activeRoot(),rg=selectedRange();if(!type||!root||!rg.to||rg.from!==rg.to)return;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);
    try{
      const response=await fetch(`/api/v308/delivery-daily?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(rg.to)}&to=${encodeURIComponent(rg.to)}`,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
      const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{}if(!response.ok||data?.ok===false)return;
      const row=(data.daily||[]).find(item=>date(item?.reportDate)===rg.to);if(!row)return;
      root.querySelectorAll('.v18-business-card').forEach(card=>{
        const label=String(card.querySelector('span')?.textContent||'').trim().replace(/\s+/g,'').toUpperCase();
        if(label!==type)return;const b=card.querySelector('b'),em=card.querySelector('em');if(b)b.textContent=fmt(row.total);if(em)em.textContent='占本业务 100.00%';card.dataset.v309MembershipDate=rg.to;
      });
      const table=root.querySelector('#v308DeliveryDailyTable'),trend=root.querySelector('.v18-trend-section');
      if(!table)global.__CE_QC_V308_DASHBOARD_READ_BRIDGE__?.loadTable?.(true);
      else if(trend?.parentNode&&table.nextElementSibling!==trend)trend.parentNode.insertBefore(table,trend);
    }catch(error){console.warn('[CE-QC][V309_SHOPEE_BOARD]',error?.name==='AbortError'?'timeout':error?.message||error);}finally{clearTimeout(timer);}
  }
  function currentImportDate(){
    const input=date(document.getElementById('reportDate')?.value||'');if(input)return input;
    const text=String(document.getElementById('fileStatus')?.textContent||'');return date(text.match(/20\d{2}-\d{2}-\d{2}/)?.[0]||'');
  }
  function needsUnifiedResume(){
    const page=document.getElementById('importPage');if(!page)return false;const text=String(page.textContent||'').replace(/\s+/g,' ');
    if(/SHOPEE CN\/VN\s*(已完成|处理中|已暂停)/i.test(text))return false;
    return /SHOPEE CN\/VN\s*待处理/i.test(text)&&/尚未全部完成/i.test(text);
  }
  async function autoResumeUnified(){
    if(global.__CE_QC_V311_SHOPEE_RECOVERY_OWNER__)return false;
    if(!needsUnifiedResume()||typeof global.resumeUnified!=='function')return false;
    const reportDate=currentImportDate();const now=Date.now();if(now-lastResumeAt<60000&&reportDate===lastResumeDate)return false;
    lastResumeAt=now;lastResumeDate=reportDate;
    try{console.info('[CE-QC][V309_AUTO_RESUME] resuming incomplete unified processing',reportDate||'current');await global.resumeUnified();return true;}
    catch(error){console.warn('[CE-QC][V309_AUTO_RESUME]',error?.message||error);return false;}
  }
  function scheduleBoard(ms=200){clearTimeout(boardTimer);boardTimer=setTimeout(()=>{canonicalSidebar();patchShopeeBoard();},ms);}
  function scheduleResume(ms=1400){clearTimeout(resumeTimer);resumeTimer=setTimeout(()=>autoResumeUnified(),ms);}
  function bind(){
    canonicalSidebar();scheduleBoard(400);scheduleResume(1800);
    [900,2200,5000].forEach(ms=>setTimeout(()=>{canonicalSidebar();patchShopeeBoard();autoResumeUnified();},ms));
    setInterval(()=>{const sidebar=document.querySelector('.sidebar'),nav=sidebar?.querySelector('.side-nav');if(document.querySelectorAll('.sidebar').length!==1||sidebar?.querySelectorAll('.side-nav').length!==1||!nav||nav.querySelectorAll('.side-link').length!==NAV_ITEMS.length)canonicalSidebar();},2500);
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query,#dashboardRangeQuery,[data-testid="global-auto-process"]')){scheduleBoard(180);scheduleResume(1200);}},true);
    document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))scheduleBoard(180);},true);
    global.addEventListener('popstate',()=>{scheduleBoard(180);scheduleResume(900);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V309_UI_INTEGRITY__={version:VERSION,canonicalSidebar,patchShopeeBoard,autoResumeUnified};
  console.info('[CE-QC][V309_UI_INTEGRITY]',VERSION,'one canonical sidebar; legacy auto-resume yields to the canonical V311+ backend-truth owner; SHOPEE CN/VN total is patched from exact V308 daily membership and daily attempt/signing table is kept before trends.');
})(window);
