(function installV106PurgeLegacyControlGuard(){
  const hide=()=>{
    document.querySelectorAll('#purgeStepOne .modal-actions').forEach(node=>{node.hidden=true;});
    const stepTwo=document.getElementById('purgeStepTwo');
    if(stepTwo)stepTwo.hidden=true;
  };
  const restore=()=>document.querySelectorAll('#purgeStepOne .modal-actions').forEach(node=>{node.hidden=false;});
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('[data-testid="one-click-purge-home"],#adminDataNav,.danger-outline[onclick*="openDataPurge"]')){
      setTimeout(hide,0);
    }
  },true);
  const preview=document.getElementById('purgePreview');
  if(preview&&typeof MutationObserver==='function'){
    const observer=new MutationObserver(()=>{
      const text=String(preview.textContent||'');
      if(/后台|安全备份|倒计时|正在清空/.test(text))hide();
      if(/无法完成|清空失败/.test(text))restore();
    });
    observer.observe(preview,{childList:true,subtree:true,characterData:true});
  }
  window.__CE_QC_V106_PURGE_CONTROL_GUARD__={hide,restore};
})();
