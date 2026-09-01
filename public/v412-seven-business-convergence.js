(function installSevenBusinessConvergenceV412(global){
  if(global.__CE_QC_V412_SEVEN_BUSINESS_CONVERGENCE__)return;
  const VERSION='2026-09-01-v413-lifecycle-bound-seven-business-convergence-v4';
  const TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
  const SELECTORS={CE:'ce',CEAF:'ceaf',TBKH:'tbkh',ALI1688:'ali1688',SHOPEECN:'shopeecn',SHOPEEVN:'shopeevn',WHPP:'whpp'};
  const WHPP_DONE_KEY='ce_qc_v412_whpp_done';
  let observer=null;
  let observerTimer=null;
  let wrapping=false;
  let minimumTruthCheckedAt=0;

  const normalizeDate=value=>{const text=String(value||'').trim().replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};
  const num=value=>{const parsed=Number(String(value??'').replace(/[^0-9.-]/g,''));return Number.isFinite(parsed)?parsed:0;};
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');

  function importState(){try{if(typeof unifiedImportState!=='undefined')return unifiedImportState;}catch{}return global.unifiedImportState||null;}
  function currentDate(){
    try{const pending=normalizeDate(global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__?.getPendingDate?.());if(pending)return pending;}catch{}
    const input=normalizeDate(document.getElementById('reportDate')?.value);if(input)return input;
    const state=importState();const stateDate=normalizeDate(state?.reportDate);if(stateDate)return stateDate;
    return normalizeDate(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value);
  }
  function lifecycleKey(){const state=importState()||{};return String(state.snapshotId||state.batchId||state.sourceSnapshotId||state.importSnapshotId||'').trim();}
  function stateCounts(){const counts=importState()?.classificationCounts||{};const explicit=TYPES.every(type=>Object.prototype.hasOwnProperty.call(counts,type));return explicit?Object.fromEntries(TYPES.map(type=>[type,num(counts[type])])):null;}
  function domCounts(){return Object.fromEntries(TYPES.map(type=>[type,num(document.querySelector(`[data-testid="classification-${SELECTORS[type]}"]`)?.textContent)]));}
  function counts(){return stateCounts()||domCounts();}
  function sevenTotal(){const values=counts();return TYPES.reduce((sum,type)=>sum+num(values[type]),0);}
  function whppTotal(){return num(counts().WHPP);}

  function patchText(root,total){
    if(!root||!total)return false;
    const text=fmt(total);let changed=false;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    for(const node of nodes){
      const before=String(node.nodeValue||'');
      const next=before
        .replace(/有效唯一单号\s*[\d,]+/g,`有效唯一单号 ${text}`)
        .replace(/日报导入完成，\s*共\s*[\d,]+\s*个唯一运单/g,`日报导入完成，共 ${text} 个唯一运单`)
        .replace(/导入成功：\s*有效\s*[\d,]+\s*票/g,`导入成功：有效 ${text} 票`)
        .replace(/导入成功：[^·\n]*·\s*有效唯一单号\s*[\d,]+/g,value=>value.replace(/有效唯一单号\s*[\d,]+/,`有效唯一单号 ${text}`))
        .replace(/七业务有效唯一单号\s*[\d,]+/g,`七业务有效唯一单号 ${text}`);
      if(next!==before){node.nodeValue=next;changed=true;}
    }
    return changed;
  }
  function syncTotal(){
    const total=sevenTotal();if(total<=0)return 0;
    const totalText=fmt(total);
    const grid=document.querySelector('#unifiedClassificationSummary .unified-count-grid');
    const valid=grid?.querySelector('[data-testid="classification-valid-unique"]');
    if(valid&&String(valid.textContent||'').trim()!==totalText)valid.textContent=totalText;
    const state=importState();
    if(state){
      const summary=state.summary||{};
      if(num(summary.validUniqueWaybills)!==total||num(summary.sevenBusinessValidUniqueWaybills)!==total||num(summary.totalUnique)!==total){
        state.summary={...summary,validUniqueWaybills:total,sevenBusinessValidUniqueWaybills:total,totalUnique:total};
      }
      if(num(state.sevenBusinessValidUniqueWaybills)!==total)state.sevenBusinessValidUniqueWaybills=total;
      state.visibleTotalRevision=VERSION;
    }
    // Legacy import owners can render the green success banner outside fileStatus.
    // Reconcile the whole import page, but only text matching an import-total phrase
    // can change. The throttled observer below prevents repeated DOM scans/churn.
    patchText(document.getElementById('importPage'),total);
    if(document.documentElement.dataset.v412SevenBusinessTotal!==String(total))document.documentElement.dataset.v412SevenBusinessTotal=String(total);
    return total;
  }

  function readMarker(){try{return JSON.parse(localStorage.getItem(WHPP_DONE_KEY)||'null');}catch{return null;}}
  function writeMarker(reportDate,source='V168'){const date=normalizeDate(reportDate);const key=lifecycleKey();if(!date||!key)return false;try{localStorage.setItem(WHPP_DONE_KEY,JSON.stringify({reportDate:date,lifecycleKey:key,whppTotal:whppTotal(),completed:true,source,savedAt:Date.now()}));return true;}catch{return false;}}
  function clearMarker(){try{localStorage.removeItem(WHPP_DONE_KEY);}catch{}}
  function markerMatches(target){const marker=readMarker();const key=lifecycleKey();return Boolean(marker?.completed===true&&key&&marker.lifecycleKey===key&&normalizeDate(marker.reportDate)===normalizeDate(target));}
  function truthCurrentEnough(truth){const checkedAt=Number(truth?.checkedAt||0);return !minimumTruthCheckedAt||checkedAt>=minimumTruthCheckedAt;}
  function learnWhppCompletion(){
    const truth=global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__?.lastTruth||null;
    const date=normalizeDate(truth?.reportDate);
    if(!truthCurrentEnough(truth)||date!==currentDate())return false;
    const whpp=(truth?.stages||[]).find(stage=>stage?.key==='WHPP');
    if(date&&whpp?.state==='done'&&whpp?.statusFresh!==false)return writeMarker(date,'V168_CANONICAL_DONE');
    return false;
  }
  function exactFreshStagesDone(target){
    const truth=global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__?.lastTruth||null;
    if(normalizeDate(truth?.reportDate)!==target||!truthCurrentEnough(truth))return false;
    const stages=truth?.stages||[];
    const byKey=key=>stages.find(stage=>stage?.key===key);
    const ccsl=byKey('CCSL'),shopee=byKey('SHOPEE'),whpp=byKey('WHPP');
    const freshDone=stage=>stage?.state==='done'&&stage?.statusFresh!==false;
    if(freshDone(whpp))writeMarker(target,'V168_CANONICAL_DONE');
    const whppDone=freshDone(whpp)||markerMatches(target);
    return freshDone(ccsl)&&freshDone(shopee)&&whppDone;
  }
  function renderCompleted(target){
    global.__CE_QC_LAST_VERIFIED_UNIFIED_COMPLETION__={reportDate:target,verifiedAt:Date.now(),owner:'V67',source:'V413_LIFECYCLE_BOUND_WHPP_COMPLETION'};
    global.__CE_QC_UNIFIED_RUN_STAGE__={owner:'V67',type:'DONE',active:false,reportDate:target,updatedAt:Date.now()};
    const node=document.getElementById('ccslRunStatus');if(node)node.innerHTML='<span class="status-pill success">七业务当日日报处理完成：CCSL → SHOPEE → WHPP均已验证正式结果。</span>';
    const button=document.querySelector('[data-testid="global-auto-process"]');if(button){button.disabled=true;button.textContent='七业务已完成';button.title=`${target} 七业务均已有正式结果，无需重复处理`;}
    try{document.dispatchEvent(new CustomEvent('ce-qc-run-complete',{detail:{reportDate:target,complete:true,source:'V413'}}));}catch{}
  }
  async function refreshThenLearn(){try{await global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__?.refresh?.();}catch{}return learnWhppCompletion();}
  async function guardCall(original,thisArg,args){const target=currentDate();await refreshThenLearn();if(target&&exactFreshStagesDone(target)){renderCompleted(target);return {ok:true,reportDate:target,skipped:true,reason:'SEVEN_BUSINESS_ALREADY_COMPLETE_V413'};}return original.apply(thisArg,args);}
  function wrapEntries(){
    if(wrapping)return;wrapping=true;
    try{for(const name of ['runUnified','resumeUnified']){const original=global[name];if(typeof original!=='function'||original.__v412Wrapped)continue;const wrapped=function(){return guardCall(original,this,arguments);};wrapped.__v412Wrapped=true;wrapped.__v412Original=original;global[name]=wrapped;}}finally{wrapping=false;}
  }
  function runObservedSync(){observerTimer=null;syncTotal();learnWhppCompletion();wrapEntries();}
  function scheduleObservedSync(){if(observerTimer)return;observerTimer=setTimeout(runObservedSync,60);}
  function installObserver(){if(observer)return;observer=new MutationObserver(scheduleObservedSync);observer.observe(document.body,{childList:true,subtree:true,characterData:true});}
  function invalidateForNewLifecycle(){minimumTruthCheckedAt=Date.now();clearMarker();}
  function install(){
    syncTotal();learnWhppCompletion();wrapEntries();installObserver();
    [0,80,250,700,1500,3000].forEach(ms=>setTimeout(()=>{syncTotal();learnWhppCompletion();wrapEntries();},ms));
    document.addEventListener('ce-qc-unified-import-committed',()=>{invalidateForNewLifecycle();syncTotal();void refreshThenLearn();});
    document.addEventListener('ce-qc-run-complete',()=>{minimumTruthCheckedAt=Date.now();setTimeout(()=>{void refreshThenLearn().finally(()=>{syncTotal();wrapEntries();});},40);});
    document.addEventListener('change',event=>{if(event.target?.id==='excelFile')invalidateForNewLifecycle();},true);
    document.addEventListener('click',event=>{if(event.target?.closest?.('[data-testid="combined-daily-import"]'))invalidateForNewLifecycle();},true);
    global.__CE_QC_V412_SEVEN_BUSINESS_CONVERGENCE__={version:VERSION,syncTotal,learnWhppCompletion,clearMarker,readMarker,markerMatches,lifecycleKey,sevenTotal};
    console.info('[CE-QC][V413_SEVEN_BUSINESS_CONVERGENCE]',VERSION,'seven-business total always includes WHPP across classification cards and import-success text; observer work is throttled and idempotent; persisted WHPP completion is exact-lifecycle only; stale pre-import truth cannot satisfy a new lifecycle.');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,40),{once:true});else setTimeout(install,40);
})(window);
