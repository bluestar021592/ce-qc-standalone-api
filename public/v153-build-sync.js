(function installBuildSync(global){
  if(global.__CE_QC_V153_BUILD_SYNC__)return;
  const loadedBuild=String(global.__CE_QC_UI_BUILD_ID__||'');
  let timer=null,reloading=false;
  async function probe(){
    if(reloading)return;
    try{
      const response=await fetch('/api/runtime-build?_='+Date.now(),{cache:'no-store',credentials:'same-origin'});
      if(!response.ok)return;
      const data=await response.json().catch(()=>({}));
      const serverBuild=String(data?.buildId||'');
      if(loadedBuild&&serverBuild&&serverBuild!==loadedBuild){
        reloading=true;
        location.reload();
      }
    }catch{}
  }
  timer=setInterval(probe,30000);
  timer?.unref?.();
  setTimeout(probe,2500);
  global.__CE_QC_V153_BUILD_SYNC__={loadedBuild,probe};
})(window);
