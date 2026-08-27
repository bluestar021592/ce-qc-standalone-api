(function installSevenBusinessLegacyStatusSyncV169(global){
  if(global.__CE_QC_V169_LEGACY_STATUS_SYNC__)return;
  const VERSION='2026-08-27-v333-legacy-status-no-dom-owner-v1';
  function apply(){
    const truth=global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__?.lastTruth;
    if(!truth)return false;
    // V333 ownership boundary: V169 is compatibility-only.
    // V168 exclusively owns #sevenBusinessStageSummary and V138 exclusively owns #ccslRunStatus.
    global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__?.refresh?.();
    global.__CE_QC_V138_CCSL_SCAN_PROGRESS__?.enforceLastTruth?.();
    return Boolean(truth.complete);
  }
  function settle(){
    let tries=0;
    const timer=setInterval(()=>{tries+=1;if(apply()||tries>=12)clearInterval(timer);},250);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',settle,{once:true});else settle();
  document.addEventListener('ce-qc-run-complete',()=>setTimeout(apply,300));
  global.__CE_QC_V169_LEGACY_STATUS_SYNC__={version:VERSION,apply};
  console.info('[CE-QC][V333_LEGACY_STATUS_SYNC]',VERSION,'compatibility bridge only; never writes canonical summary or CCSL detail DOM.');
})(window);
