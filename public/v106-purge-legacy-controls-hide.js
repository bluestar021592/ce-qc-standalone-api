(function installV106PurgeLegacyControlGuard(){
  const explicitV545=()=>String(window.__CE_QC_V505_DATA_PURGE_RECOVERY__?.patchId||'').includes('v545-explicit-two-step');
  const restore=()=>document.querySelectorAll('#purgeStepOne .modal-actions').forEach(node=>{node.hidden=false;});
  const hide=()=>{
    // V106 used to hide the legacy step-one controls because pre-V545 V505
    // immediately owned PREPARE itself. V545 intentionally restores a real
    // two-step user confirmation flow, so hiding “备份并继续” would make the
    // safe explicit workflow unusable. Once V545 is authoritative, V106 is a
    // compatibility owner guard only and must not alter either confirmation step.
    if(explicitV545()){restore();return;}
    document.querySelectorAll('#purgeStepOne .modal-actions').forEach(node=>{node.hidden=true;});
    const stepTwo=document.getElementById('purgeStepTwo');
    if(stepTwo)stepTwo.hidden=true;
  };
  const reassertV505Owner=()=>{
    const api=window.__CE_QC_V505_DATA_PURGE_RECOVERY__;
    const owner=api?.openDataPurge;
    if(typeof owner!=='function')return false;
    window.openDataPurge=owner;
    try{openDataPurge=owner;}catch{}
    if(explicitV545()){
      if(typeof api.continueDataPurge==='function'){window.continueDataPurge=api.continueDataPurge;try{continueDataPurge=api.continueDataPurge;}catch{}}
      if(typeof api.executeDataPurge==='function'){window.executeDataPurge=api.executeDataPurge;try{executeDataPurge=api.executeDataPurge;}catch{}}
      restore();
    }
    return true;
  };
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('[data-testid="one-click-purge-home"],#adminDataNav,.danger-outline[onclick*="openDataPurge"]')){
      reassertV505Owner();
      setTimeout(()=>explicitV545()?restore():hide(),0);
    }
  },true);
  const preview=document.getElementById('purgePreview');
  if(preview&&typeof MutationObserver==='function'){
    const observer=new MutationObserver(()=>{
      if(explicitV545()){restore();return;}
      const text=String(preview.textContent||'');
      if(/后台|安全备份|倒计时|正在清空/.test(text))hide();
      if(/无法完成|清空失败/.test(text))restore();
    });
    observer.observe(preview,{childList:true,subtree:true,characterData:true});
  }
  reassertV505Owner();
  setTimeout(reassertV505Owner,100);
  window.__CE_QC_V106_PURGE_CONTROL_GUARD__={version:'2026-09-15-v545-explicit-controls-visible-v1',hide,restore,reassertV505Owner};
})();
