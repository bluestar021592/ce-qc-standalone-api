(function installWhppUnifiedSnapshotViewV137(global){
  if(global.__CE_QC_V137_WHPP_UNIFIED_VIEW__)return;
  const VERSION='2026-08-15-v137-whpp-unified-snapshot-view-v2';

  function selectedDate(){
    const heading=document.querySelector('#whppFastPage .v18-page-heading p')?.textContent||'';
    const headingDate=heading.match(/\d{4}-\d{2}-\d{2}/)?.[0]||'';
    if(headingDate)return headingDate;
    const values=[
      document.getElementById('reportDate')?.value,
      document.getElementById('topRangeTo')?.value,
      document.getElementById('dashboardRangeTo')?.value
    ];
    for(const value of values){const text=String(value||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;}
    return '';
  }

  function reconcileHeading(){
    const page=document.getElementById('whppFastPage');
    if(!page||page.hidden)return;
    const node=page.querySelector('.v18-page-heading p');
    if(!node)return;
    const text=String(node.textContent||'');
    const date=selectedDate()||'—';
    let target='';
    if(/已完成WHPP独立扫描\/轨迹\/闭环快照|数据来自当前业务有效快照/.test(text)){
      target=`日报 ${date} · 数据来自当前业务有效快照`;
    }else if(/WHPP日报已分类但尚未完成独立扫描\/轨迹|尚未生成最终快照|处理中/.test(text)){
      target=`日报 ${date} · 当前业务快照处理中`;
    }
    if(!target)return;
    page.dataset.sourceTruth='UNIFIED_BUSINESS_SNAPSHOT';
    if(node.textContent!==target)node.textContent=target;
  }

  let queued=false;
  function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;reconcileHeading();});}

  let observedPage=null;
  let pageObserver=null;
  let bootstrapObserver=null;
  function attachPageObserver(){
    const page=document.getElementById('whppFastPage');
    if(!page)return false;
    if(page===observedPage)return true;
    pageObserver?.disconnect();
    observedPage=page;
    pageObserver=new MutationObserver(()=>{if(!page.hidden)schedule();});
    pageObserver.observe(page,{subtree:true,childList:true,characterData:true});
    schedule();
    return true;
  }

  function install(){
    if(!attachPageObserver()){
      bootstrapObserver=new MutationObserver(()=>{
        if(attachPageObserver()){bootstrapObserver?.disconnect();bootstrapObserver=null;}
      });
      bootstrapObserver.observe(document.body,{subtree:true,childList:true});
    }
    global.addEventListener('popstate',()=>{attachPageObserver();setTimeout(reconcileHeading,0);});
    document.addEventListener('ce-qc-run-complete',()=>{attachPageObserver();setTimeout(reconcileHeading,0);});
    reconcileHeading();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  global.__CE_QC_V137_WHPP_UNIFIED_VIEW__={version:VERSION,reconcileHeading};
  console.info('[CE-QC][V137_WHPP_UNIFIED_VIEW]',VERSION);
})(window);
