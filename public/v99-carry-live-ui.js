(function installCarryLiveRefreshV99(global){
  if(global.__CE_QC_V99_CARRY_LIVE__)return;
  const VERSION='2026-08-14-v99-carry-live-ui-v1';
  const POLL_MS=60*1000;
  let refreshing=false;

  function carryVisible(){
    if(document.visibilityState==='hidden')return false;
    const host=document.getElementById('v27CarryContent');
    if(!host)return false;
    const page=host.closest('.page,.v27-carry-page')||host;
    return !page.hidden && getComputedStyle(page).display!=='none';
  }

  async function refreshIfVisible(){
    if(refreshing||!carryVisible())return;
    if(typeof global.v27CarryRefreshCurrent!=='function')return;
    refreshing=true;
    try{
      await Promise.resolve(global.v27CarryRefreshCurrent());
    }catch(error){
      console.warn('[CE-QC][V99_CARRY_LIVE]',error?.message||error);
    }finally{refreshing=false;}
  }

  const timer=setInterval(refreshIfVisible,POLL_MS);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')setTimeout(refreshIfVisible,500);
  });
  document.addEventListener('ce-qc-run-complete',()=>setTimeout(refreshIfVisible,500));
  global.__CE_QC_V99_CARRY_LIVE__={version:VERSION,refresh:refreshIfVisible,timer};
  setTimeout(refreshIfVisible,5000);
  console.info('[CE-QC][V99_CARRY_LIVE]',VERSION);
})(window);
