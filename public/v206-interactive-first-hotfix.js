(function installV206InteractiveFirstHotfix(global){
  if(global.__CE_QC_V206_INTERACTIVE_FIRST_HOTFIX__)return;
  const VERSION='2026-08-30-v375-canonical-v67-run-controls-v1';
  const FORCE_KEY='ce_qc_force_ce_relogin_v207';
  const INSTANT_PAGES=new Map([['home','/'],['ceaf','/ceaf']]);
  let applying=false;

  function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  function selectedDate(){
    try{
      const dom=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);
      if(/^\d{4}-\d{2}-\d{2}$/.test(dom))return dom;
      return String(historyModeDate||unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate||'').slice(0,10);
    }catch{return '';}
  }
  function loginMarkup(){
    return '<label class="field-label">tenantId<input class="auth-tenant" value="000000" autocomplete="off"></label>'+
      '<label class="field-label">username<input class="auth-user" autocomplete="username"></label>'+
      '<label class="field-label">password<input class="auth-password" type="password" autocomplete="current-password"></label>'+
      '<button class="btn primary full" type="button" data-v207-ce-login>登录CE系统</button><div class="auth-message" data-v207-auth-message></div>';
  }
  function forceLoginForms(){
    if(applying)return;
    applying=true;
    try{
      document.querySelectorAll('#ceAuthPanel,#shopeeAuthPanel').forEach(panel=>{
        if(!panel.querySelector('.auth-user')||!panel.querySelector('.auth-password'))panel.innerHTML=loginMarkup();
        const button=[...panel.querySelectorAll('button')].find(node=>String(node.textContent||'').trim()==='登录CE系统');
        if(button)button.setAttribute('data-v207-ce-login','1');
        let message=panel.querySelector('.auth-message');
        if(!message){message=document.createElement('div');message.className='auth-message';message.setAttribute('data-v207-auth-message','1');panel.appendChild(message);}
      });
    }finally{applying=false;}
  }
  function beginRelogin(){
    try{sessionStorage.setItem(FORCE_KEY,'1');}catch{}
    try{if(typeof ceAuth!=='undefined')ceAuth={};}catch{}
    forceLoginForms();
    document.querySelector('#ceAuthPanel .auth-user,#shopeeAuthPanel .auth-user')?.focus?.();
  }
  async function submitLogin(button){
    const panel=button?.closest?.('.auth-panel')||button?.parentElement;
    if(!panel)return;
    const username=panel.querySelector('.auth-user')?.value?.trim()||'';
    const password=panel.querySelector('.auth-password')?.value||'';
    const tenantId=panel.querySelector('.auth-tenant')?.value?.trim()||'000000';
    let message=panel.querySelector('.auth-message');
    if(!message){message=document.createElement('div');message.className='auth-message';panel.appendChild(message);}
    if(!username||!password){message.textContent='请输入CE账号和密码';return;}
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    button.disabled=true;button.textContent='登录中…';
    message.textContent='正在连接CE系统，请稍候…';
    try{
      const response=await fetch('/api/ce-login',{
        method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,
        headers:{'content-type':'application/json'},
        body:JSON.stringify({tenantId,username,password,grant_type:'password',scope:'all',type:'account'})
      });
      const raw=await response.text();
      let payload={};try{payload=raw?JSON.parse(raw):{};}catch{}
      if(!response.ok||payload?.ok===false)throw new Error(payload?.error||payload?.message||`HTTP ${response.status}`);
      try{sessionStorage.removeItem(FORCE_KEY);}catch{}
      try{if(typeof ceAuth!=='undefined')ceAuth=payload.authStatus||{loggedIn:true,account:username};}catch{}
      message.textContent=`CE系统登录成功：${esc(payload?.authStatus?.account||username)}`;
      if(typeof global.renderAuthPanels==='function')setTimeout(()=>global.renderAuthPanels(),80);
      else {button.disabled=false;button.textContent='登录CE系统';}
    }catch(error){
      const text=error?.name==='AbortError'?'CE登录请求20秒内未返回，请检查CE网络或账号后重试':(error?.message||String(error));
      message.textContent=`CE登录失败：${text}`;
      const pwd=panel.querySelector('.auth-password');if(pwd)pwd.value='';
      button.disabled=false;button.textContent='登录CE系统';
    }finally{clearTimeout(timer);}
  }

  function seedCeafFromCurrentTruth(){
    try{
      global.__CE_QC_V109_INSTANT_BUSINESS_NAV__?.seedCeafBeforeNavigation?.();
      const expected=Number(unifiedImportState?.classificationCounts?.CEAF);
      if(!Number.isFinite(expected)||expected<0||typeof businessStates==='undefined')return;
      const date=selectedDate();
      const current=businessStates.CEAF||{};
      const total=Number(current?.dailyParseSummary?.totalRecognized??current?.dashboard?.pnh??current?.total??-1);
      if(total===expected&&String(current.reportDate||'').slice(0,10)===date)return;
      businessStates.CEAF={...current,businessType:'CEAF',viewBusinessType:'CEAF',reportDate:date,dailyReportReady:expected>0,sourceTotal:expected,total:expected,dailyParseSummary:{...(current.dailyParseSummary||{}),totalRecognized:expected,pnh:expected},dashboard:{...(current.dashboard||{}),pnh:expected,totalMonitored:expected},__v207InstantSeed:true};
    }catch{}
  }
  function refreshHomeFast(){
    const fast=global.__CE_QC_V89_FAST_DASHBOARD__;
    if(!fast?.fetchSummary)return false;
    void fast.fetchSummary(selectedDate()).then(()=>{
      try{if(String(typeof currentPage!=='undefined'?currentPage:'')==='home'&&typeof global.renderAll==='function')global.renderAll();}catch{}
    });
    return true;
  }
  function instantNavigate(page,push=true){
    const target=String(page||'').toLowerCase();
    const path=INSTANT_PAGES.get(target);
    if(!path)return false;
    try{
      if(target==='ceaf')seedCeafFromCurrentTruth();
      if(typeof currentPage!=='undefined')currentPage=target;
      if(push&&location.pathname!==path)history.pushState({page:target},'',path);
      if(typeof global.renderAll==='function')global.renderAll();
      if(target==='home')refreshHomeFast();
      else if(target==='ceaf'){
        const nav=global.__CE_QC_V109_INSTANT_BUSINESS_NAV__;
        setTimeout(()=>{try{void nav?.hydrateCeafFast?.();}catch{}},0);
      }
      return true;
    }catch(error){console.warn('[CE-QC][V207_INSTANT_NAV]',target,error);return false;}
  }

  function runCanonicalUnified(mode='start'){
    const owner=global.__CE_QC_V67_RESILIENT_RUN_GUARD__;
    if(owner?.run){
      void owner.run(mode==='resume'?'resume':'start');
      return true;
    }
    const status=document.getElementById('ccslRunStatus');
    if(status)status.innerHTML='<span class="status-pill danger">统一处理入口尚未加载完成，请刷新页面后再开始；日报数据不会丢失。</span>';
    console.error('[CE-QC][V375_CANONICAL_RUN_CONTROL] V67 owner unavailable; legacy duplicate runner blocked.');
    return false;
  }

  document.addEventListener('click',event=>{
    const autoButton=event.target?.closest?.('[data-testid="global-auto-process"]');
    const resumeButton=event.target?.closest?.('button[onclick="resumeUnified()"]');
    if(autoButton||resumeButton){
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
      runCanonicalUnified(resumeButton?'resume':'start');
      return;
    }
    const side=event.target?.closest?.('.side-link');
    const page=String(side?.dataset?.page||'').toLowerCase();
    if(side&&INSTANT_PAGES.has(page)){
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
      instantNavigate(page,true);
      return;
    }
    const button=event.target?.closest?.('button');
    if(!button)return;
    const label=String(button.textContent||'').trim();
    if(label==='重新登录'&&button.closest('.auth-panel')){
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();beginRelogin();return;
    }
    if((label==='登录CE系统'||button.matches('[data-v207-ce-login],[data-v206-ce-login]'))&&button.closest('.auth-panel')){
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void submitLogin(button);
    }
  },true);

  const observer=new MutationObserver(()=>{
    let forced=false;try{forced=sessionStorage.getItem(FORCE_KEY)==='1';}catch{}
    if(forced)queueMicrotask(forceLoginForms);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});
  let forced=false;try{forced=sessionStorage.getItem(FORCE_KEY)==='1';}catch{}
  if(forced)queueMicrotask(forceLoginForms);

  // The normal bootstrap can still be busy while WHPP is already interactive.
  // Retry the tiny indexed home summary independently so homepage business totals
  // do not wait for the heavyweight application refresh path.
  [80,600,1800,4000].forEach(delay=>setTimeout(()=>{
    const path=location.pathname.toLowerCase();
    if(path==='/'||path==='/home')refreshHomeFast();
  },delay));

  global.showLoginForms=beginRelogin;
  global.loginCe=submitLogin;
  global.__CE_QC_V206_INTERACTIVE_FIRST_HOTFIX__={version:VERSION,beginRelogin,forceLoginForms,submitLogin,instantNavigate,refreshHomeFast,runCanonicalUnified};
  console.info('[CE-QC][V375_CANONICAL_RUN_CONTROL]',VERSION,'full-auto and resume buttons are capture-bound to V67; legacy app.js duplicate runner cannot execute.');
})(window);