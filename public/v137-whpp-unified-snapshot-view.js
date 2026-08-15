(function installWhppUnifiedSnapshotViewV137(global){
  if(global.__CE_QC_V137_WHPP_UNIFIED_VIEW__)return;
  const VERSION='2026-08-15-v137-whpp-unified-snapshot-view-v1';

  function selectedDate(){
    const values=[
      document.getElementById('reportDate')?.value,
      document.getElementById('topRangeTo')?.value,
      document.getElementById('dashboardRangeTo')?.value
    ];
    for(const value of values){const text=String(value||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;}
    const heading=document.querySelector('#whppFastPage .v18-page-heading p')?.textContent||'';
    return heading.match(/\d{4}-\d{2}-\d{2}/)?.[0]||'';
  }

  function reconcileHeading(){
    const page=document.getElementById('whppFastPage');
    if(!page||page.hidden)return;
    const node=page.querySelector('.v18-page-heading p');
    if(!node)return;
    const text=String(node.textContent||'');
    const date=selectedDate()||'—';
    if(/已完成WHPP独立扫描\/轨迹\/闭环快照|数据来自当前业务有效快照/.test(text)){
      node.textContent=`日报 ${date} · 数据来自当前业务有效快照`;
      page.dataset.sourceTruth='UNIFIED_BUSINESS_SNAPSHOT';
      return;
    }
    if(/WHPP日报已分类但尚未完成独立扫描\/轨迹|尚未生成最终快照|处理中/.test(text)){
      node.textContent=`日报 ${date} · 当前业务快照处理中`;
      page.dataset.sourceTruth='UNIFIED_BUSINESS_SNAPSHOT';
    }
  }

  let queued=false;
  function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;reconcileHeading();});}
  const observer=new MutationObserver(schedule);
  function install(){
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page="whpp"]'))setTimeout(reconcileHeading,0);},true);
    global.addEventListener('popstate',()=>setTimeout(reconcileHeading,0));
    reconcileHeading();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  global.__CE_QC_V137_WHPP_UNIFIED_VIEW__={version:VERSION,reconcileHeading};
  console.info('[CE-QC][V137_WHPP_UNIFIED_VIEW]',VERSION);
})(window);
