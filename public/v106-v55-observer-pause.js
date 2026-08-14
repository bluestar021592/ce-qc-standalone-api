(function pauseLegacyV55Observer(global){
  if(global.__CE_QC_NATIVE_MUTATION_OBSERVER__||typeof global.MutationObserver!=='function')return;
  global.__CE_QC_NATIVE_MUTATION_OBSERVER__=global.MutationObserver;
  global.MutationObserver=class CeQcV55NoopObserver{
    constructor(){this.active=false;}
    observe(){this.active=true;}
    disconnect(){this.active=false;}
    takeRecords(){return [];}
  };
  console.info('[CE-QC][V106] legacy V55 whole-DOM observer paused');
})(window);
