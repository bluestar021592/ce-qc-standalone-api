(function restoreMutationObserverAfterV55(global){
  if(!global.__CE_QC_NATIVE_MUTATION_OBSERVER__)return;
  global.MutationObserver=global.__CE_QC_NATIVE_MUTATION_OBSERVER__;
  delete global.__CE_QC_NATIVE_MUTATION_OBSERVER__;
  console.info('[CE-QC][V106] native MutationObserver restored after V55 install');
})(window);
