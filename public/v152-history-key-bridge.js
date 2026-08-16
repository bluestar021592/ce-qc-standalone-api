(function installV152HistoryKeyBridge(global){
  if(global.__CE_QC_V152_HISTORY_KEY_BRIDGE__)return;
  const VERSION='2026-08-16-v152-history-key-bridge-v1';
  const TYPE_BY_PAGE={ce:'CE',ceaf:'CEAF',tbkh:'TBKH',ali1688:'ALI1688',shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN'};

  const num=value=>{const n=Number(value||0);return Number.isFinite(n)?n:0;};
  const countFromRate=(total,pct)=>Math.max(0,Math.round(num(total)*num(pct)/100));

  function aliasSummary(summary={},type='CCSL'){
    const s={...(summary||{})};
    const total=num(s.today??s.pnh??s.todayPnh??s['今日PNH']??s['ALL_今日总单']??0);
    const pod=num(s.todayPod??s.scanPod??s['今日POD']??0);
    const podRate=num(s.podRate??s['POD率']??s['首投POD率']??0);
    const firstRate=num(s.firstPodRate??s['首投POD率']??podRate);
    const ocRate=num(s.ocRate??0);
    const ocCount=num(s.ocCount??s['OC1+']??countFromRate(total,ocRate));

    s.today=total;s.pnh=total;s.todayPnh=total;s.todayPod=pod;s.scanPod=pod;
    s.podRate=podRate;s.firstPodRate=firstRate;s.ocRate=ocRate;
    s['今日PNH']=total;s['今日POD']=pod;s['POD率']=podRate;s['首投POD率']=firstRate;s['OC1+']=ocCount;

    if(type==='SHOPEECN'||type==='SHOPEEVN'||type==='SHOPEE'){
      const group=type==='SHOPEECN'?'CN':type==='SHOPEEVN'?'VN':'ALL';
      s[`${group}_今日总单`]=total;
      s[`${group}_今日POD`]=pod;
      s[`${group}_POD率`]=podRate;
      s[`${group}_OC1+`]=ocCount;
      s[`${group}_首派成功率`]=firstRate;
    }
    return s;
  }

  function normalizeHistory(state,type){
    if(!state||typeof state!=='object')return state;
    const history=Array.isArray(state.historySummary)?state.historySummary:[];
    state.historySummary=history.map(item=>{
      const reportDate=String(item?.reportDate||item?.summary?.reportDate||'').slice(0,10);
      return {...item,reportDate,summary:aliasSummary(item?.summary||item||{},type)};
    });
    return state;
  }

  function normalizeAll(){
    try{
      if(typeof appState!=='undefined')normalizeHistory(appState,'CCSL');
      if(typeof shopeeState!=='undefined')normalizeHistory(shopeeState,'SHOPEE');
      if(typeof businessStates!=='undefined'&&businessStates){
        for(const [page,type] of Object.entries(TYPE_BY_PAGE)){
          void page;
          if(businessStates[type])normalizeHistory(businessStates[type],type);
        }
      }
    }catch(error){console.warn('[CE-QC][V152_HISTORY_BRIDGE]',error?.message||error);}
  }

  const originalRender=global.renderAll;
  if(typeof originalRender==='function'){
    global.renderAll=function v152HistoryAwareRender(...args){normalizeAll();return originalRender.apply(this,args);};
  }

  document.addEventListener('ce-qc-run-complete',()=>{normalizeAll();setTimeout(()=>{try{global.renderAll?.();}catch{}},80);});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',normalizeAll,{once:true});else normalizeAll();
  global.__CE_QC_V152_HISTORY_KEY_BRIDGE__={version:VERSION,normalizeAll,aliasSummary};
  console.info('[CE-QC][V152_HISTORY_KEY_BRIDGE]',VERSION);
})(window);
