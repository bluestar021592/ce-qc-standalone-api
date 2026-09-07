(function installSevenBusinessLegacyStatusSyncV169(global){
  if(global.__CE_QC_V169_LEGACY_STATUS_SYNC__)return;
  const VERSION='2026-09-07-v441-isolated-status-and-failclosed-start-v1';
  const V411_FAIL_CLOSED_ENTRY_COMPAT='2026-09-01-v411-unconfirmed-status-entry-lock-v1';
  const V420_ENTRY_CONFIRM_REVISION='2026-09-03-v420-bounded-entry-status-confirm-v1';
  const V421_CLICKABLE_UNCONFIRMED_REVISION='2026-09-03-v421-clickable-unconfirmed-start-v1';
  const V423_EXPLICIT_SHOPEE_RESTART_REVISION='2026-09-04-v423-explicit-shopee-restart-resume-v1';
  const V424_RESUME_FLOOR_HANDOFF_REVISION='2026-09-04-v424-v169-v67-proof-handoff-v1';
  const V433_V168_SINGLE_START_OWNER='2026-09-05-v433-v168-single-start-control-owner-v1';
  const V441_ISOLATED_STATUS_REVISION='2026-09-07-v441-isolated-readonly-status-sidecar-v1';
  const V441_FAILCLOSED_START_REVISION='2026-09-07-v441-dom-enforced-failclosed-start-v1';
  const ENTRY_CONFIRM_WAIT_MS=8500;
  const STATUS_SIDECAR_PORT=5180;
  let observerTimer=null;
  const originalEntries={};
  const norm=value=>String(value||'').replace(/\s+/g,' ').trim();
  const normalizeDate=value=>{
    const text=String(value||'').trim().replace(/\//g,'-').slice(0,10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
  };
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  function privateHost(host=''){
    const value=String(host||'').trim().toLowerCase();
    return value==='127.0.0.1'||value==='localhost'||/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(value);
  }

  function installIsolatedStatusFetchBridge(){
    const original=global.fetch;
    if(typeof original!=='function'||original.__v441StatusBridge)return;
    const wrapped=async function(input,init){
      let url;
      try{url=new URL(typeof input==='string'?input:input?.url||'',global.location.href);}catch{return original.apply(this,arguments);}
      const type=String(url.searchParams.get('businessType')||'').toUpperCase();
      if(url.origin===global.location.origin&&url.pathname==='/api/v33/run-progress'&&type==='ALL'&&privateHost(global.location.hostname)){
        const sidecar=new URL(`http://${global.location.hostname}:${STATUS_SIDECAR_PORT}/api/local-status/run-progress`);
        sidecar.search=url.search;
        let lastError=null;
        for(let attempt=0;attempt<2;attempt+=1){
          try{return await original.call(this,sidecar.toString(),{...(init||{}),cache:'no-store',credentials:'omit'});}
          catch(error){lastError=error;if(attempt===0)await sleep(120);}
        }
        throw lastError||new Error('独立状态服务暂时不可达');
      }
      return original.apply(this,arguments);
    };
    wrapped.__v441StatusBridge=true;
    wrapped.__v441Original=original;
    global.fetch=wrapped;
  }

  function canonicalTruth(){
    return global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__?.lastTruth||null;
  }

  function pendingImportDate(){
    const explicit=global.__CE_QC_PENDING_IMPORT_DATE__||{};
    const active=explicit.active===true?normalizeDate(explicit.reportDate):'';
    if(active)return active;
    try{
      const fromV146=normalizeDate(global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__?.getPendingDate?.());
      if(fromV146)return fromV146;
    }catch{}
    return '';
  }

  function currentTargetDate(){
    const pending=pendingImportDate();
    if(pending)return pending;
    const input=normalizeDate(document.getElementById('reportDate')?.value);
    if(input)return input;
    const top=normalizeDate(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value);
    if(top)return top;
    try{
      const imported=normalizeDate(typeof unifiedImportState!=='undefined'?unifiedImportState?.reportDate:'');
      if(imported)return imported;
    }catch{}
    return '';
  }

  function statusState(){
    const target=currentTargetDate();
    const truth=canonicalTruth();
    const truthDate=normalizeDate(truth?.reportDate);
    if(!target){
      return{kind:'unconfirmed',reportDate:'',truth:null,reason:'TARGET_DATE_UNRESOLVED'};
    }
    if(!truth||!truthDate||truthDate!==target){
      return{kind:'unconfirmed',reportDate:target,truth:null,reason:'CURRENT_DATE_STATUS_NOT_READY'};
    }
    const stages=Array.isArray(truth.stages)?truth.stages:[];
    const fresh=truth.statusFresh===true||(stages.length===3&&stages.every(stage=>stage?.statusFresh!==false));
    if(!fresh){
      return{kind:'unconfirmed',reportDate:target,truth,reason:'CURRENT_DATE_STATUS_STALE'};
    }
    if(truth.complete===true)return{kind:'complete',reportDate:target,truth,reason:'CANONICAL_COMPLETE'};
    return{kind:'incomplete',reportDate:target,truth,reason:'CANONICAL_FRESH_INCOMPLETE'};
  }

  function startButton(){return document.querySelector('[data-testid="global-auto-process"]');}
  function rememberStartButton(btn){
    if(!btn||btn.dataset.v441StartLock==='1')return;
    btn.dataset.v441StartLock='1';
    btn.dataset.v441PreviousDisabled=btn.disabled?'1':'0';
    btn.dataset.v441PreviousText=btn.textContent||'';
    btn.dataset.v441PreviousTitle=btn.getAttribute('title')||'';
  }
  function lockStartButton(state){
    const btn=startButton();if(!btn)return;
    rememberStartButton(btn);
    const complete=state?.kind==='complete';
    btn.disabled=true;
    btn.setAttribute('aria-disabled','true');
    btn.dataset.v441LockReason=complete?'complete':'unconfirmed';
    btn.textContent=complete?'七业务已完成':'状态确认中';
    btn.title=complete
      ?`${state?.reportDate||''} 七业务均已完成，无需重复处理`
      :`${state?.reportDate||''} 当前日报状态尚未确认，禁止重复启动；状态由独立只读通道自动确认`;
  }
  function unlockStartButton(){
    const btn=startButton();if(!btn||btn.dataset.v441StartLock!=='1')return;
    const active=global.__CE_QC_UNIFIED_RUN_STAGE__?.owner==='V67'&&global.__CE_QC_UNIFIED_RUN_STAGE__?.active===true;
    const previousDisabled=btn.dataset.v441PreviousDisabled==='1';
    const previousText=btn.dataset.v441PreviousText||'开始全自动处理';
    const previousTitle=btn.dataset.v441PreviousTitle||'';
    delete btn.dataset.v441StartLock;
    delete btn.dataset.v441LockReason;
    delete btn.dataset.v441PreviousDisabled;
    delete btn.dataset.v441PreviousText;
    delete btn.dataset.v441PreviousTitle;
    btn.removeAttribute('aria-disabled');
    if(active){btn.disabled=true;return;}
    btn.disabled=previousDisabled;
    btn.textContent=previousText;
    if(previousTitle)btn.title=previousTitle;else btn.removeAttribute('title');
  }

  async function waitForStatusAdvance(beforeCheckedAt){
    const deadline=Date.now()+ENTRY_CONFIRM_WAIT_MS;
    let state=statusState();
    while(state.kind==='unconfirmed'&&Date.now()<deadline){
      const checkedAt=Number(canonicalTruth()?.checkedAt||0);
      if(checkedAt>Number(beforeCheckedAt||0))break;
      await sleep(120);
      state=statusState();
    }
    return statusState();
  }

  async function ensureFreshEntryState(){
    let state=statusState();
    for(let attempt=0;attempt<2&&state.kind==='unconfirmed';attempt+=1){
      const beforeCheckedAt=Number(canonicalTruth()?.checkedAt||0);
      try{await Promise.resolve(global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__?.refresh?.({force:true}));}catch{}
      state=statusState();
      if(state.kind!=='unconfirmed')return state;
      if(Number(canonicalTruth()?.checkedAt||0)<=beforeCheckedAt){
        state=await waitForStatusAdvance(beforeCheckedAt);
        if(state.kind!=='unconfirmed')return state;
      }
      if(attempt===0)await sleep(220);
    }
    return state;
  }

  function currentCompleteTruth(){
    const state=statusState();
    return state.kind==='complete'?state.truth:null;
  }

  function exactShopeeRestartInterruption(state){
    if(state?.kind!=='incomplete')return false;
    const target=normalizeDate(state.reportDate);
    const stages=Array.isArray(state.truth?.stages)?state.truth.stages:[];
    const ccsl=stages.find(stage=>stage?.key==='CCSL');
    const shopee=stages.find(stage=>stage?.key==='SHOPEE');
    if(!target||ccsl?.complete!==true||ccsl?.statusFresh===false)return false;
    if(!shopee||shopee.complete===true||shopee.statusFresh===false||shopee.state!=='failed')return false;
    if(normalizeDate(shopee.date)!==target)return false;
    return String(shopee.details||'').toUpperCase().includes('PROCESS_RESTART_INTERRUPTED');
  }

  function resumeButtons(){
    return [...document.querySelectorAll('button')].filter(btn=>{
      const onclick=String(btn.getAttribute('onclick')||'');
      const label=norm(btn.textContent);
      return /resumeUnified\s*\(/.test(onclick)||label.includes('继续七业务处理');
    });
  }

  function rememberEntryButton(btn){
    if(btn.dataset.v169EntryLock==='1')return;
    btn.dataset.v169EntryLock='1';
    btn.dataset.v169PreviousDisplay=btn.style.display||'';
    btn.dataset.v169PreviousTitle=btn.getAttribute('title')||'';
    btn.dataset.v169PreviousDisabled=btn.disabled?'1':'0';
    btn.dataset.v169PreviousHidden=btn.hidden?'1':'0';
  }

  function lockResumeButtons(state){
    const complete=state?.kind==='complete';
    const reportDate=state?.reportDate||'';
    resumeButtons().forEach(btn=>{
      rememberEntryButton(btn);
      btn.dataset.v169LockReason=complete?'complete':'unconfirmed';
      btn.disabled=true;
      btn.hidden=true;
      btn.style.display='none';
      btn.title=complete
        ?`${reportDate} 七业务均已完成，无需继续处理`
        :`${reportDate} 当前日报状态尚未确认，禁止重复启动或继续处理`;
    });
  }

  function unlockResumeButtons(){
    document.querySelectorAll('button[data-v169-entry-lock="1"]').forEach(btn=>{
      btn.disabled=btn.dataset.v169PreviousDisabled==='1';
      btn.hidden=btn.dataset.v169PreviousHidden==='1';
      btn.style.display=btn.dataset.v169PreviousDisplay||'';
      const previousTitle=btn.dataset.v169PreviousTitle;
      if(previousTitle)btn.title=previousTitle;else btn.removeAttribute('title');
      delete btn.dataset.v169EntryLock;
      delete btn.dataset.v169LockReason;
      delete btn.dataset.v169PreviousDisplay;
      delete btn.dataset.v169PreviousTitle;
      delete btn.dataset.v169PreviousDisabled;
      delete btn.dataset.v169PreviousHidden;
    });
  }

  function syncLegacyStatus(truth){
    const expected=normalizeDate(truth.reportDate);
    const re=/^日报\s*(\d{4}-\d{2}-\d{2})\s*·\s*当前业务.*处理中$/;
    document.querySelectorAll('div,span,p').forEach(node=>{
      if(node.children?.length)return;
      const value=norm(node.textContent);
      const match=value.match(re);
      if(!match)return;
      if(expected&&match[1]!==expected)return;
      if(!node.dataset.v169PreviousText)node.dataset.v169PreviousText=node.textContent||'';
      node.dataset.v169CanonicalComplete='1';
      node.textContent=`日报 ${match[1]} · 七业务已全部完成`;
    });
  }

  function restoreLegacyStatus(){
    document.querySelectorAll('[data-v169-previous-text]').forEach(node=>{
      if(node.dataset.v169PreviousText)node.textContent=node.dataset.v169PreviousText;
      delete node.dataset.v169PreviousText;
      delete node.dataset.v169CanonicalComplete;
    });
  }

  function syncVerifiedRunLatch(state){
    const reportDate=normalizeDate(state?.reportDate);
    if(!reportDate||state?.kind==='unconfirmed')return;
    const existing=global.__CE_QC_LAST_VERIFIED_UNIFIED_COMPLETION__||null;
    if(state.kind==='complete'){
      if(normalizeDate(existing?.reportDate)!==reportDate||existing?.owner!=='V67'){
        global.__CE_QC_LAST_VERIFIED_UNIFIED_COMPLETION__={
          reportDate,
          verifiedAt:Date.now(),
          owner:'V67',
          source:'V169_CANONICAL_SEVEN_BUSINESS_TRUTH',
          canonicalUiLock:true
        };
      }
      return;
    }
    if(normalizeDate(existing?.reportDate)===reportDate&&existing?.source==='V169_CANONICAL_SEVEN_BUSINESS_TRUTH'){
      global.__CE_QC_LAST_VERIFIED_UNIFIED_COMPLETION__=null;
    }
  }

  function wrapUnifiedEntry(name){
    const original=global[name];
    if(typeof original!=='function'||original.__v169CanonicalCompletionGuard)return;
    originalEntries[name]=original;
    const guarded=async function(){
      const state=await ensureFreshEntryState();
      if(state.kind==='complete'){
        syncVerifiedRunLatch(state);
        lockStartButton(state);
        lockResumeButtons(state);
        syncLegacyStatus(state.truth);
        console.info('[CE-QC][V169]',name,'skipped because seven-business canonical truth is complete for',state.reportDate||'current report');
        return{
          ok:true,
          skipped:true,
          code:'SEVEN_BUSINESS_ALREADY_COMPLETE',
          reportDate:state.reportDate,
          complete:true,
          statusFresh:true
        };
      }
      if(state.kind==='unconfirmed'){
        lockStartButton(state);
        lockResumeButtons(state);
        console.info('[CE-QC][V441]',name,'blocked while isolated current-date status is unconfirmed for',state.reportDate||'current report');
        return{
          ok:false,
          skipped:true,
          code:'SEVEN_BUSINESS_STATUS_UNCONFIRMED',
          reportDate:state.reportDate,
          complete:false,
          statusFresh:false
        };
      }
      unlockStartButton();
      unlockResumeButtons();
      const start=startButton();
      if(start)delete start.dataset.v421UnconfirmedEntry;
      if(name==='runUnified'&&exactShopeeRestartInterruption(state)&&typeof originalEntries.resumeUnified==='function'){
        const handoff=global.__CE_QC_V67_RESILIENT_RUN_GUARD__?.createShopeeRestartHandoff?.({
          reportDate:state.reportDate,
          checkedAt:Number(state.truth?.checkedAt||0),
          recoveryRevision:V423_EXPLICIT_SHOPEE_RESTART_REVISION
        });
        if(!handoff){
          console.warn('[CE-QC][V424]',state.reportDate,'exact SHOPEE restart was visible but V67 rejected the same-proof resume-floor handoff; refusing to reopen CCSL.');
          return{ok:false,skipped:true,code:'SHOPEE_RESTART_HANDOFF_REJECTED',reportDate:state.reportDate,complete:false,statusFresh:true};
        }
        console.info('[CE-QC][V424]',state.reportDate,'explicit Start consumed exact SHOPEE PROCESS_RESTART_INTERRUPTED proof and delegated the same proof to the V67 SHOPEE resume floor');
        return originalEntries.resumeUnified.call(this,handoff);
      }
      return original.apply(this,arguments);
    };
    guarded.__v169CanonicalCompletionGuard=true;
    guarded.__v169Original=original;
    global[name]=guarded;
  }

  function installEntryGuards(){
    wrapUnifiedEntry('runUnified');
    wrapUnifiedEntry('resumeUnified');
  }

  function apply(){
    installEntryGuards();
    const state=statusState();
    syncVerifiedRunLatch(state);
    if(state.kind==='complete'){
      lockStartButton(state);
      lockResumeButtons(state);
      syncLegacyStatus(state.truth);
    }else if(state.kind==='unconfirmed'){
      lockStartButton(state);
      lockResumeButtons(state);
      restoreLegacyStatus();
    }else{
      unlockStartButton();
      unlockResumeButtons();
      const start=startButton();
      if(start)delete start.dataset.v421UnconfirmedEntry;
      restoreLegacyStatus();
    }
    global.__CE_QC_V138_CCSL_SCAN_PROGRESS__?.enforceLastTruth?.();
    return state.kind==='complete';
  }

  function refreshAndApply(){
    Promise.resolve(global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__?.refresh?.())
      .catch(()=>{})
      .finally(()=>setTimeout(apply,40));
  }

  function schedule(){
    clearTimeout(observerTimer);
    observerTimer=setTimeout(apply,60);
  }

  function settle(){
    installEntryGuards();
    apply();
    refreshAndApply();
    let tries=0;
    const timer=setInterval(()=>{
      tries+=1;
      if(apply()||tries>=20)clearInterval(timer);
    },250);
    setTimeout(apply,900);
  }

  installIsolatedStatusFetchBridge();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',settle,{once:true});else settle();
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','class','style']});
  document.addEventListener('click',event=>{
    const btn=event.target?.closest?.('[data-testid="global-auto-process"]');
    if(!btn)return;
    const state=statusState();
    if(state.kind==='unconfirmed'||state.kind==='complete'){
      event.preventDefault();event.stopImmediatePropagation();lockStartButton(state);
    }
  },true);
  document.addEventListener('ce-qc-run-complete',()=>setTimeout(refreshAndApply,120));
  window.addEventListener('ce-qc:seven-business-status',apply);
  window.addEventListener('ce-qc:ccsl-status',apply);
  window.addEventListener('ce-qc:route-changed',settle);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')settle();});

  installEntryGuards();
  global.__CE_QC_V169_LEGACY_STATUS_SYNC__={version:VERSION,v411Compat:V411_FAIL_CLOSED_ENTRY_COMPAT,v420Revision:V420_ENTRY_CONFIRM_REVISION,v421Revision:V421_CLICKABLE_UNCONFIRMED_REVISION,v423Revision:V423_EXPLICIT_SHOPEE_RESTART_REVISION,v424Revision:V424_RESUME_FLOOR_HANDOFF_REVISION,v433StartOwner:V433_V168_SINGLE_START_OWNER,v441IsolatedStatus:V441_ISOLATED_STATUS_REVISION,v441FailClosedStart:V441_FAILCLOSED_START_REVISION,apply,refresh:refreshAndApply,statusState,currentCompleteTruth,ensureFreshEntryState,exactShopeeRestartInterruption};
  console.info('[CE-QC][V441_V169]',VERSION,V441_ISOLATED_STATUS_REVISION,V441_FAILCLOSED_START_REVISION,'local/LAN seven-business status reads are routed to the isolated read-only 5180 sidecar; unconfirmed/complete Start is DOM-enforced fail-closed and click-guarded; V423/V424 exact SHOPEE restart handoff remains unchanged.');
})(window);