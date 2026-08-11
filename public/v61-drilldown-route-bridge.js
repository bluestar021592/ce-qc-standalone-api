(function installV61DrilldownRouteBridge(global){
  const VERSION='2026-08-11-v61-drilldown-route-bridge-v1';
  if(global.__CE_QC_V61_DRILLDOWN_ROUTE_BRIDGE__)return;
  global.__CE_QC_V61_DRILLDOWN_ROUTE_BRIDGE__=VERSION;

  const nativeFetch=global.fetch.bind(global);
  const rewrite=url=>{
    const text=String(url||'');
    if(text.startsWith('/api/v55/metric-detail?'))return text.replace('/api/v55/metric-detail?','/api/v61/metric-detail?');
    if(text.includes('/api/v55/metric-detail?'))return text.replace('/api/v55/metric-detail?','/api/v61/metric-detail?');
    return text;
  };

  global.fetch=function ceQcV61Fetch(input,init){
    try{
      if(typeof input==='string'){
        const next=rewrite(input);
        if(next!==input)input=next;
      }else if(input instanceof Request){
        const next=rewrite(input.url);
        if(next!==input.url)input=new Request(next,input);
      }
    }catch(error){
      console.warn('[CE-QC][V61_BRIDGE] rewrite skipped',error);
    }
    return nativeFetch(input,init);
  };

  console.info('[CE-QC][V61_DRILLDOWN_ROUTE_BRIDGE]',VERSION);
})(window);
