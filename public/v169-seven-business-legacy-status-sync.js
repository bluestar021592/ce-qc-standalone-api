(function installSevenBusinessLegacyStatusSyncV169(global){
  if(global.__CE_QC_V169_LEGACY_STATUS_SYNC__)return;
  const VERSION='2026-08-17-v169-seven-business-legacy-status-sync-v1';
  function apply(){
    const truth=global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__?.lastTruth;
    if(!truth?.complete)return false;
    const status=document.getElementById('ccslRunStatus');
    if(!status)return false;
    const date=String(truth.reportDate||'').replace(/-/g,'/');
    status.innerHTML=`<span class="status-pill success">七业务已完成</span><div style="margin-top:8px">当前阶段：完成</div><div>处理日期：${date||'-'}</div><div>CCSL、SHOPEE CN/VN、WHPP本土均已有正式结果，无需重复处理。</div>`;
    return true;
  }
  function settle(){
    let tries=0;
    const timer=setInterval(()=>{tries+=1;if(apply()||tries>=12)clearInterval(timer);},250);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',settle,{once:true});else settle();
  document.addEventListener('ce-qc-run-complete',()=>setTimeout(apply,300));
  global.__CE_QC_V169_LEGACY_STATUS_SYNC__={version:VERSION,apply};
  console.info('[CE-QC][V169_LEGACY_STATUS_SYNC]',VERSION);
})(window);
