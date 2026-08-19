(function installCurrentHomeTruthV217Safe(global){
  'use strict';
  if(global.__CE_QC_V160_CURRENT_HOME_TRUTH__)return;
  const VERSION='2026-08-19-v217-disable-provisional-zero-overwrite-v1';

  // V160 used to replace a real saved dashboard state with an all-zero provisional
  // object whenever the newest unified import membership differed from the current
  // processed state. That made a healthy database render as "all 0" after restart
  // and could also hide the last completed report while a newer import was pending.
  // Runtime truth is now owned by the saved/range/business endpoints. An imported
  // but not-yet-processed report may be shown by the import page, but it must never
  // overwrite a completed dashboard with fabricated zero metrics.
  function sync(){ return false; }

  global.__CE_QC_V160_CURRENT_HOME_TRUTH__={
    version:VERSION,
    sync,
    disabled:true,
    reason:'V217 preserves persisted dashboard truth; provisional zero mutation retired.'
  };
  console.info('[CE-QC][V217_CURRENT_HOME_TRUTH]',VERSION,'V160 provisional zero mutation disabled.');
})(window);
