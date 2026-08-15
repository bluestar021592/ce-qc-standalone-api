(function retireTrendTruthV56(global){
  const VERSION='2026-08-15-v141-retired-v56-trend-truth-v3';

  function cleanup(){
    document.querySelectorAll('.v56-trend-blocker,#v56TrendHistoryTruth,#v56HomeTrendHistoryTruth,#v56AttemptEvidenceTruth,#v56HomeAttemptEvidenceTruth').forEach(node=>node.remove());
    document.querySelectorAll('.v56-history-blocked').forEach(node=>node.classList.remove('v56-history-blocked'));
  }

  cleanup();
  setTimeout(cleanup,0);
  setTimeout(cleanup,200);

  global.__CE_QC_V56_TREND_TRUTH__={
    version:VERSION,
    retired:true,
    active:false,
    replacement:'V137_RANGE_TRENDS',
    cleanup
  };
  console.info('[CE-QC][V141] legacy V56 trend truth retired');
})(window);
