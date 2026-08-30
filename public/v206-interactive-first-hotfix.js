(function installV206InteractiveFirstHotfix(global){
  if(global.__CE_QC_V206_INTERACTIVE_FIRST_HOTFIX__)return;
  const VERSION='2026-08-30-v375-canonical-v67-run-controls-v1';
  const STATUS_STABILITY_REVISION='2026-08-30-v377-unified-status-display-lock-v1';
  const FORCE_KEY='ce_qc_force_ce_relogin_v207';
  const INSTANT_PAGES=new Map([['home','/'],['ceaf','/ceaf']]);
  const STAGE_LABELS={CCSL:'CCSL',SHOPEE:'SHOPEE CN/VN',WHPP:'WHPP本土'};
  const STAGE_ORDER=['CCSL','SHOPEE','WHPP'];
  let applying=false;
  let statusApplying=false;

  function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  function normalizeDate(value){const text=String(value||'').trim().replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
  function selectedDate(){
    try{
      const importDate=normalizeDate(document.getElementById('reportDate')?.value||'');
      if(importDate)return importDate;
      const dom=normalizeDate(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'');
      if(dom)return dom;
      return normalizeDate(historyModeDate||unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate||'');
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

  function unifiedDisplayState(){
    const date=selectedDate();
    if(!date)return null;
    const stage=global.__CE_QC_UNIFIED_RUN_STAGE__||{};
    const stageDate=normalizeDate(stage.reportDate||'');
    const stageKey=String(stage.type||'').toUpperCase();
    if(stage.owner==='V67'&&stage.active===true&&(!stageDate||stageDate===date)&&STAGE_ORDER.includes(stageKey)){
      return {mode:'running',date,key:stageKey,label:STAGE_LABELS[stageKey]||stageKey};
    }
    const marker=global.__CE_QC_LAST_VERIFIED_UNIFIED_COMPLETION__||{};
    const markerDate=normalizeDate(marker.reportDate||'');
    if(marker.owner==='V67'&&markerDate===date&&stage.owner==='V67'&&stage.active===false&&String(stage.type||'').toUpperCase()==='DONE'&&(!stageDate||stageDate===date)){
      return {mode:'done',date,source:'V67'};
    }
    const truth=global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__?.lastTruth;
    if(normalizeDate(truth?.reportDate||'')===date&&truth?.complete===true&&Array.isArray(truth?.stages)&&truth.stages.every(item=>item?.state==='done')){
      return {mode:'done',date,source:'V168'};
    }
    return null;
  }

  function stageSummaryMarkup(activeKey=''){
    const activeIndex=STAGE_ORDER.indexOf(activeKey);
    const pills=STAGE_ORDER.map((key,index)=>{
      const label=STAGE_LABELS[key];
      if(activeIndex<0)return `<span class="status-pill muted">${label} 待处理</span>`;
      if(index<activeIndex)return `<span class="status-pill success">${label} 已完成</span>`;
      if(index===activeIndex)return `<span class="status-pill warning">${label} 处理中</span>`;
      return `<span class="status-pill muted">${label} 待处理</span>`;
    }).join('');
    return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><strong style="color:#0b3158">七业务处理状态</strong>${pills}<span class="status-pill muted">尚未全部完成</span></div>`;
  }

  function completedSummaryMarkup(){
    return '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><strong style="color:#0b3158">七业务处理状态</strong>'+
      '<span class="status-pill success">CCSL 已完成</span><span class="status-pill success">SHOPEE CN/VN 已完成</span><span class="status-pill success">WHPP本土 已完成</span><span class="status-pill success">七业务已完成</span></div>';
  }

  function writeHtml(node,html){if(node&&node.innerHTML!==html)node.innerHTML=html;}
  function writeText(node,text){if(node&&node.textContent!==text)node.textContent=text;}

  function clearStatusLock(){
    const button=document.querySelector('[data-testid="global-auto-process"]');
    const resume=document.querySelector('button[onclick="resumeUnified()"]');
    if(button?.dataset.v377StatusLock==='1'){
      delete button.dataset.v377StatusLock;
      if(button.dataset.v168Locked!=='1'){button.disabled=false;writeText(button,'开始全自动处理');}
    }
    if(resume?.dataset.v377StatusLock==='1'){
      delete resume.dataset.v377StatusLock;
      if(resume.dataset.v168Locked!=='1')resume.disabled=false;
    }
  }

  function stabilizeUnifiedStatus(){
    if(statusApplying)return;
    const page=document.getElementById('importPage');
    if(!page||page.hidden)return;
    statusApplying=true;
    try{
      const state=unifiedDisplayState();
      if(!state){clearStatusLock();return;}
      const summary=document.getElementById('sevenBusinessStageSummary');
      const status=document.getElementById('ccslRunStatus');
      const button=document.querySelector('[data-testid="global-auto-process"]');
      const resume=document.querySelector('button[onclick="resumeUnified()"]');
      if(state.mode==='running'){
        if(summary){summary.dataset.v377StatusLock='1';writeHtml(summary,stageSummaryMarkup(state.key));}
        if(button){button.dataset.v377StatusLock='1';button.disabled=true;writeText(button,`${state.label}处理中…`);}
        if(resume){resume.dataset.v377StatusLock='1';resume.disabled=true;}
        if(status&&state.key!=='CCSL'){
          status.dataset.v377StatusLock='1';
          writeHtml(status,`<span class="status-pill warning">${state.label} 处理中</span><p>当前阶段：${state.label}</p><p>正在按CCSL → SHOPEE → WHPP唯一流程执行，完成后自动进入下一阶段。</p>`);
        }
        return;
      }
      if(state.mode==='done'){
        if(summary){summary.dataset.v377StatusLock='1';writeHtml(summary,completedSummaryMarkup());}
        if(button){button.dataset.v377StatusLock='1';button.disabled=true;writeText(button,'七业务已完成');button.title=`${state.date} CCSL、SHOPEE CN/VN、WHPP均已完成`;}
        if(resume){resume.dataset.v377StatusLock='1';resume.disabled=true;resume.title='七业务均已完成，无需继续处理';}
        if(status){status.dataset.v377StatusLock='1';writeHtml(status,'<span class="status-pill success">七业务已完成</span><p>当前阶段：已完成</p><p>CCSL → SHOPEE → WHPP 均已验证正式结果，无需重复处理。</p>');}
      }
    }finally{statusApplying=false;}
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
    queueMicrotask(stabilizeUnifiedStatus);
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

  [120,500,1200].forEach(delay=>setTimeout(stabilizeUnifiedStatus,delay));
  setInterval(stabilizeUnifiedStatus,250);

  global.showLoginForms=beginRelogin;
  global.loginCe=submitLogin;
  global.__CE_QC_V206_INTERACTIVE_FIRST_HOTFIX__={version:VERSION,statusStabilityRevision:STATUS_STABILITY_REVISION,beginRelogin,forceLoginForms,submitLogin,instantNavigate,refreshHomeFast,runCanonicalUnified,stabilizeUnifiedStatus};
  console.info('[CE-QC][V375_CANONICAL_RUN_CONTROL]',VERSION,STATUS_STABILITY_REVISION,'full-auto and resume buttons are capture-bound to V67; unified status display is locked to the active V67 stage and final verified completion so legacy polling cannot flicker backward.');
})(window);