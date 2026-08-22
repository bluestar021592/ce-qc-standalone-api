(function installV235CacheReadyReload(global){
  if(global.__CE_QC_V235_CACHE_READY_RELOAD__)return;
  global.__CE_QC_V235_CACHE_READY_RELOAD__=true;
  const VERSION='2026-08-22-v235-cache-ready-reload-v1';
  const PATH_TYPE={ce:'CE',ceaf:'CEAF',tbkh:'TBKH',ali1688:'ALI1688',shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN'};
  let timer=null,attempt=0,lastKey='';
  function current(){
    const type=PATH_TYPE[String(location.pathname||'').replace(/^\//,'').toLowerCase()]||'';
    const date=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);
    return{type,date,key:`${type}|${date}`};
  }
  function waiting(){return /缓存尚未完成|等待正式快照|状态读取中/.test(String(document.body?.innerText||''));}
  function stop(){if(timer)clearTimeout(timer);timer=null;attempt=0;}
  function schedule(ms=1200){if(timer)clearTimeout(timer);timer=setTimeout(check,ms);}
  async function check(){
    const c=current();
    if(!c.type||!c.date||!waiting()){stop();return;}
    if(lastKey!==c.key){lastKey=c.key;attempt=0;}
    if(attempt++>=45){stop();return;}
    try{
      const response=await fetch(`/api/v234/current-summary?reportDate=${encodeURIComponent(c.date)}&_v235=${Date.now()}`,{cache:'no-store',credentials:'same-origin'});
      const data=await response.json();
      const metric=data?.business?.[c.type];
      if(response.ok&&metric?.ready){
        const reloadKey=`ce-qc-v235-ready:${c.key}:${data.snapshotId||''}`;
        if(sessionStorage.getItem(reloadKey)!=='1'){
          sessionStorage.setItem(reloadKey,'1');
          location.reload();
          return;
        }
        stop();return;
      }
    }catch{}
    schedule(Math.min(3000,1000+attempt*80));
  }
  const observer=new MutationObserver(()=>{if(waiting()&&!timer)schedule(250);});
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query,#dashboardRangeQuery')){stop();schedule(450);}},true);
  global.addEventListener('popstate',()=>{stop();schedule(350);});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(400),{once:true});else schedule(400);
  console.info('[CE-QC][V235_CACHE_READY_RELOAD]',VERSION);
})(window);
