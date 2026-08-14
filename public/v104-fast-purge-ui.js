(function installFastPurgeUiV104(global){
  if(global.__CE_QC_V104_FAST_PURGE_UI__)return;
  const VERSION='2026-08-14-v104-fast-purge-ui-v1';
  let timer=null;
  let startedAt=0;

  function stop(){
    if(timer)clearInterval(timer);
    timer=null;
    startedAt=0;
  }

  function tick(){
    const dialog=document.getElementById('dataPurgeDialog');
    const preview=document.getElementById('purgePreview');
    if(!dialog||dialog.hidden||!preview){stop();return;}
    const warning=preview.querySelector('.purge-warning');
    if(!warning){stop();return;}
    const text=String(warning.textContent||'');
    if(!/正在创建并校验清空前备份|快速在线备份/.test(text)){stop();return;}
    const elapsed=Math.max(0,Math.floor((Date.now()-startedAt)/1000));
    warning.textContent=`正在执行快速在线备份与完整性校验… 已用 ${elapsed} 秒。请勿关闭页面。`;
  }

  function start(){
    stop();
    startedAt=Date.now();
    tick();
    timer=setInterval(tick,1000);
  }

  const original=global.openDataPurge;
  if(typeof original==='function'){
    global.openDataPurge=async function v104OpenDataPurge(...args){
      const pending=original.apply(this,args);
      setTimeout(()=>{
        const preview=document.getElementById('purgePreview');
        if(preview?.textContent?.includes('正在创建并校验清空前备份'))start();
      },100);
      try{return await pending;}
      finally{stop();}
    };
  }

  global.__CE_QC_V104_FAST_PURGE_UI__={version:VERSION,start,stop};
  console.info('[CE-QC][V104_FAST_PURGE_UI]',VERSION);
})(window);
