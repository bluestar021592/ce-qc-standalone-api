(function installV560DirectDataPurge(global){
  const PATCH_ID='2026-09-20-v560-direct-no-backup-ui-v1';
  const PHRASE='永久清除全部业务数据';
  let openedAt=0;
  let active=false;
  let timer=null;
  const node=id=>document.getElementById(id);
  const escapeText=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  async function requestJson(url,options={},timeoutMs=60*60_000){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options,signal:controller.signal});
      const raw=await response.text();
      let data={};try{data=raw?JSON.parse(raw):{};}catch{}
      if(!response.ok||data.ok===false){
        const error=new Error(data.error||data.message||`HTTP ${response.status}`);
        error.status=response.status;error.code=String(data.code||'DIRECT_PURGE_HTTP_REJECTED');error.payload=data;throw error;
      }
      return data;
    }finally{clearTimeout(timeout);}
  }

  function elapsedSeconds(){return Math.max(0,Math.floor((Date.now()-openedAt)/1000));}
  function updateDirectPurgeButton(){
    const button=node('directPurgeExecuteButton');
    const phrase=node('directPurgePhrase');
    const countdown=node('directPurgeCountdown');
    const remain=Math.max(0,5-elapsedSeconds());
    if(countdown)countdown.textContent=remain>0?`请等待 ${remain} 秒`:'已完成安全倒计时，可最终确认清空';
    if(button)button.disabled=active||remain>0||String(phrase?.value||'')!==PHRASE;
  }
  function startClock(){
    clearInterval(timer);
    timer=setInterval(updateDirectPurgeButton,250);
    updateDirectPurgeButton();
  }
  function stopClock(){clearInterval(timer);timer=null;}

  async function openDirectDataPurge(){
    if(active)return;
    if(!global.confirm('打开直接清空向导？不会创建新备份，也不会启用V505安全封锁。只有最终再次确认后才会删除业务数据。'))return;
    openedAt=Date.now();
    const dialog=node('directPurgeDialog');if(dialog)dialog.hidden=false;
    const phrase=node('directPurgePhrase');if(phrase)phrase.value='';
    const preview=node('directPurgePreview');
    if(preview)preview.innerHTML='<div class="purge-warning"><b>直接清空模式：不创建备份，不启用安全封锁。</b><br><small>仍使用 ADMIN 权限校验、5秒倒计时、最终确认和单次 SQLite 事务。用户、权限、配置、白名单、已有备份和审计不会删除。</small></div>';
    startClock();
  }
  function closeDirectDataPurge(){
    if(active)return alert('直接清空事务正在执行，当前不能关闭为“已取消”。请等待结果。');
    stopClock();
    const dialog=node('directPurgeDialog');if(dialog)dialog.hidden=true;
  }
  async function executeDirectDataPurge(){
    if(active)return;
    updateDirectPurgeButton();
    const button=node('directPurgeExecuteButton');
    if(button?.disabled)return alert('请准确输入“永久清除全部业务数据”，并等待5秒倒计时结束。');
    if(!global.confirm('最终确认：现在将直接永久清空全部业务数据。不会创建新备份。用户、权限、配置、白名单、已有备份和审计会保留。是否继续？'))return;
    active=true;stopClock();
    if(button)button.disabled=true;
    const phrase=node('directPurgePhrase');if(phrase)phrase.disabled=true;
    const preview=node('directPurgePreview');
    const started=Date.now();
    if(preview)preview.innerHTML='<div class="purge-warning"><b>正在直接事务化清空全部业务数据…</b><br><span>不会创建备份，也不会等待安全封锁。</span><br><small id="directPurgeElapsed">已等待 0 秒</small></div>';
    const elapsed=setInterval(()=>{const e=node('directPurgeElapsed');if(e)e.textContent=`已等待 ${Math.floor((Date.now()-started)/1000)} 秒`;},1000);
    try{
      const result=await requestJson('/api/admin/data-purge/direct',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phrase:PHRASE})
      });
      clearInterval(elapsed);
      const deleted=Object.values(result.before||{}).reduce((sum,value)=>sum+Number(value||0),0);
      if(preview)preview.innerHTML=`<div class="purge-success"><b>全部业务数据已直接清空。</b><br>共删除 <b>${deleted.toLocaleString()}</b> 行业务记录。<br><small>未创建新备份；用户、权限、配置、白名单、已有备份和审计已保留。现在可以重新上传新的日报数据。</small></div>`;
    }catch(error){
      clearInterval(elapsed);
      active=false;
      if(phrase)phrase.disabled=false;
      if(preview)preview.innerHTML=`<div class="purge-error"><b>直接清空未完成。</b><br>${escapeText(error.message||error)}<br><small>未显示成功前不要重复点击；可把此错误直接发给开发处理。</small></div>`;
      openedAt=Date.now()-5000;
      startClock();
      return;
    }
    active=false;
  }

  global.openDirectDataPurge=openDirectDataPurge;
  global.closeDirectDataPurge=closeDirectDataPurge;
  global.executeDirectDataPurge=executeDirectDataPurge;
  global.updateDirectPurgeButton=updateDirectPurgeButton;
  global.__CE_QC_V560_DIRECT_PURGE__={patchId:PATCH_ID,getStatus:()=>({active,openedAt})};
  console.info('[CE-QC][V560_DIRECT_PURGE]',PATCH_ID);
})(window);
