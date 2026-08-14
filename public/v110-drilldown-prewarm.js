(function installDrilldownPrewarmV110(global){
  if(global.__CE_QC_V110_DRILLDOWN_PREWARM__)return;
  const VERSION='2026-08-14-v110-intent-drilldown-prewarm-v2';
  const warmed=new Map();
  const active=new Map();
  const TTL=55_000;
  const INTENT_DELAY_MS=320;
  let timer=null;
  let pendingTarget=null;

  function valid(value){const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
  function range(){
    const from=valid(document.getElementById('dashboardRangeFrom')?.value||document.getElementById('topRangeFrom')?.value);
    const to=valid(document.getElementById('dashboardRangeTo')?.value||document.getElementById('topRangeTo')?.value);
    if(from&&to&&from<=to)return {from,to};
    try{const date=valid(historyModeDate||unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate);return date?{from:date,to:date}:null;}catch{return null;}
  }
  function clearPending(){
    if(timer){clearTimeout(timer);timer=null;}
    pendingTarget=null;
  }
  function warm(){
    clearPending();
    if(document.visibilityState!=='visible')return;
    const r=range();if(!r)return;
    const key=`${r.from}|${r.to}`;const now=Date.now();
    if(now-Number(warmed.get(key)||0)<TTL||active.has(key))return;
    const url=`/api/v55/reconciliation?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`;
    const request=fetch(url,{credentials:'same-origin',cache:'no-store'})
      .then(response=>{if(response.ok)warmed.set(key,Date.now());return response;})
      .catch(()=>null).finally(()=>active.delete(key));
    active.set(key,request);
  }
  function metricTarget(event){
    return event.target?.closest?.('.v18-metric-card,.metric-card,.kpi-card,[data-detail-tab],[data-metric-key]')||null;
  }
  function intent(event){
    const target=metricTarget(event);if(!target)return;
    if(event.type==='pointerover'&&target.contains(event.relatedTarget))return;
    clearPending();pendingTarget=target;
    timer=setTimeout(()=>{if(pendingTarget===target)warm();},INTENT_DELAY_MS);
  }
  function leave(event){
    const target=metricTarget(event);if(!target||pendingTarget!==target)return;
    if(target.contains(event.relatedTarget))return;
    clearPending();
  }
  document.addEventListener('pointerover',intent,{capture:true,passive:true});
  document.addEventListener('pointerout',leave,{capture:true,passive:true});
  document.addEventListener('focusin',intent,true);
  document.addEventListener('focusout',leave,true);
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('#topRangeQuery,#dashboardRangeQuery')){warmed.clear();clearPending();}
  },true);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')clearPending();});
  global.__CE_QC_V110_DRILLDOWN_PREWARM__={version:VERSION,warm,cacheSize:()=>warmed.size,intentDelayMs:INTENT_DELAY_MS};
  console.info('[CE-QC][V110_DRILLDOWN_PREWARM]',VERSION);
})(window);
