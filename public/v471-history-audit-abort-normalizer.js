(function installV471HistoryAuditAbortNormalizer(global){
  if(global.__CE_QC_V471_HISTORY_ABORT_NORMALIZER__)return;
  const VERSION='2026-09-08-v471-history-audit-timeout-abort-normalizer-v1';
  const TARGET_REASON='V451_HISTORY_AUDIT_TIMEOUT';
  const proto=global.AbortController?.prototype;
  const nativeAbort=proto?.abort;
  if(!proto||typeof nativeAbort!=='function'){
    global.__CE_QC_V471_HISTORY_ABORT_NORMALIZER__={version:VERSION,installed:false,reason:'ABORT_CONTROLLER_UNAVAILABLE'};
    return;
  }
  proto.abort=function v471NormalizedAbort(reason){
    if(reason===TARGET_REASON)return nativeAbort.call(this);
    return nativeAbort.call(this,reason);
  };
  global.__CE_QC_V471_HISTORY_ABORT_NORMALIZER__={version:VERSION,installed:true,targetReason:TARGET_REASON};
  console.info('[CE-QC][V471_HISTORY_ABORT_NORMALIZER]',VERSION,'normalizes only V451 history-audit timeout abort reason to a standard AbortError; no network/database/business mutation.');
})(window);
