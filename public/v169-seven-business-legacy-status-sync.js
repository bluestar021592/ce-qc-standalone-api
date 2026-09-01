(function installSevenBusinessLegacyStatusSyncV169(global){
  if(global.__CE_QC_V169_LEGACY_STATUS_SYNC__)return;
  const VERSION='2026-09-01-v400-canonical-completion-ui-and-entry-lock-v1';
  let observerTimer=null;
  const norm=value=>String(value||'').replace(/\s+/g,' ').trim();
  const normalizeDate=value=>{
    const text=String(value||'').trim().replace(/\//g,'-').slice(0,10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
  };

  function canonicalTruth(){
    return global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__?.lastTruth||null;
  }

  function currentTargetDate(){
    const input=normalizeDate(document.getElementById('reportDate')?.value);
    if(input)return input;
    try{
      const imported=normalizeDate(typeof unifiedImportState!=='undefined'?unifiedImportState?.reportDate:'');
      if(imported)return imported;
    }catch{}
    const top=normalizeDate(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value);
    if(top)return top;
    return '';
  }

  function currentCompleteTruth(){
    const truth=canonicalTruth();
    if(!truth?.complete)return null;
    const truthDate=normalizeDate(truth.reportDate);
    const target=currentTargetDate();
    if(target&&truthDate&&target!==truthDate)return null;
    return truth;
  }

  function resumeButtons(){
    return [...document.querySelectorAll('button')].filter(btn=>{
      const onclick=String(btn.getAttribute('onclick')||'');
      const label=norm(btn.textContent);
      return /resumeUnified\s*\(/.test(onclick)||label.includes('继续七业务处理');
    });
  }

  function lockResumeButtons(truth){
    resumeButtons().forEach(btn=>{
      if(btn.dataset.v169CanonicalComplete!=='1'){
        btn.dataset.v169CanonicalComplete='1';
        btn.dataset.v169PreviousDisplay=btn.style.display||'';
        btn.dataset.v169PreviousTitle=btn.getAttribute('title')||'';
        btn.dataset.v169PreviousDisabled=btn.disabled?'1':'0';
      }
      btn.disabled=true;
      btn.hidden=true;
      btn.style.display='none';
      btn.title=`${truth.reportDate||''} 七业务均已完成，无需继续处理`;
    });
  }

  function unlockResumeButtons(){
    document.querySelectorAll('button[data-v169-canonical-complete="1"]').forEach(btn=>{
      btn.disabled=btn.dataset.v169PreviousDisabled==='1';
      btn.hidden=false;
      btn.style.display=btn.dataset.v169PreviousDisplay||'';
      const previousTitle=btn.dataset.v169PreviousTitle;
      if(previousTitle)btn.title=previousTitle;else btn.removeAttribute('title');
      delete btn.dataset.v169CanonicalComplete;
      delete btn.dataset.v169PreviousDisplay;
      delete btn.dataset.v169PreviousTitle;
      delete btn.dataset.v169PreviousDisabled;
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

  function syncVerifiedRunLatch(truth){
    const reportDate=normalizeDate(truth?.reportDate);
    if(!reportDate)return;
    const existing=global.__CE_QC_LAST_VERIFIED_UNIFIED_COMPLETION__||null;
    if(truth.complete){
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
    const guarded=function(){
      const truth=currentCompleteTruth();
      if(truth){
        syncVerifiedRunLatch(truth);
        lockResumeButtons(truth);
        syncLegacyStatus(truth);
        console.info('[CE-QC][V169]',name,'skipped because seven-business canonical truth is complete for',truth.reportDate||'current report');
        return Promise.resolve({
          ok:true,
          skipped:true,
          code:'SEVEN_BUSINESS_ALREADY_COMPLETE',
          reportDate:normalizeDate(truth.reportDate),
          complete:true
        });
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
    const truth=canonicalTruth();
    if(!truth)return false;
    syncVerifiedRunLatch(truth);
    const completeTruth=currentCompleteTruth();
    if(completeTruth){
      lockResumeButtons(completeTruth);
      syncLegacyStatus(completeTruth);
    }else{
      unlockResumeButtons();
      restoreLegacyStatus();
    }
    global.__CE_QC_V138_CCSL_SCAN_PROGRESS__?.enforceLastTruth?.();
    return Boolean(completeTruth);
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
    refreshAndApply();
    let tries=0;
    const timer=setInterval(()=>{
      tries+=1;
      if(apply()||tries>=12)clearInterval(timer);
    },250);
    setTimeout(apply,900);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',settle,{once:true});else settle();
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('ce-qc-run-complete',()=>setTimeout(refreshAndApply,120));
  window.addEventListener('ce-qc:seven-business-status',apply);
  window.addEventListener('ce-qc:ccsl-status',apply);
  window.addEventListener('ce-qc:route-changed',settle);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')settle();});

  installEntryGuards();
  global.__CE_QC_V169_LEGACY_STATUS_SYNC__={version:VERSION,apply,refresh:refreshAndApply};
  console.info('[CE-QC][V169]',VERSION,'legacy status, continue CTA and both unified execution entries follow V168 canonical completion truth; completed WHPP cannot re-enter the same report lifecycle.');
})(window);
