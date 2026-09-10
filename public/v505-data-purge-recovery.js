(function installV505DataPurgeRecovery(global){
  if(global.__CE_QC_V505_DATA_PURGE_RECOVERY__)return;
  const PATCH_ID='2026-09-10-v505-idempotent-purge-recovery-ui-v1';
  let active=false;
  let elapsedTimer=null;
  let startedAt=0;
  let lastStatus='';

  const escapeText=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const previewNode=()=>document.getElementById('purgePreview');

  async function requestJson(url,options={}){
    let response;
    try{
      response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});
    }catch(error){
      const wrapped=new Error(error?.message||'后台连接中断');
      wrapped.code='PURGE_TRANSPORT_INTERRUPTED';
      throw wrapped;
    }
    const raw=await response.text();
    let data={};
    try{data=raw?JSON.parse(raw):{};}catch{}
    if(!response.ok||data.ok===false){
      const error=new Error(data.error||data.message||`HTTP ${response.status}`);
      error.status=response.status;
      error.payload=data;
      throw error;
    }
    return data;
  }

  function elapsedText(){
    const seconds=Math.max(0,Math.floor((Date.now()-startedAt)/1000));
    const minutes=Math.floor(seconds/60);
    const remain=seconds%60;
    return minutes?`${minutes}分${String(remain).padStart(2,'0')}秒`:`${seconds}秒`;
  }

  function renderWorking(message='正在创建并校验清空前安全备份'){
    const node=previewNode();
    if(!node)return;
    lastStatus=message;
    node.innerHTML=`<div class="purge-warning"><b>${escapeText(message)}</b><br><span>后台任务仍在执行 · 已等待 <b id="v505PurgeElapsed">${escapeText(elapsedText())}</b></span><br><small>25GB级数据库需要较长时间。页面不会把“等待响应”误判成失败，也不会重复创建备份。</small></div>`;
  }

  function startElapsedClock(){
    clearInterval(elapsedTimer);
    elapsedTimer=setInterval(()=>{
      const elapsed=document.getElementById('v505PurgeElapsed');
      if(elapsed)elapsed.textContent=elapsedText();
    },1000);
  }

  function stopElapsedClock(){clearInterval(elapsedTimer);elapsedTimer=null;}

  function isPrepareStillRunning(error){
    return String(error?.message||'').includes('PURGE_PREPARE_RUNNING');
  }

  function isRecoverableTransport(error){
    return error?.code==='PURGE_TRANSPORT_INTERRUPTED'
      || String(error?.message||'').includes('Failed to fetch')
      || String(error?.message||'').includes('NetworkError')
      || String(error?.message||'').includes('连接中断');
  }

  async function prepareWithRecovery(){
    let recoveryChecks=0;
    while(true){
      try{
        const result=await requestJson('/api/admin/data-purge/prepare',{
          method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
        });
        return result;
      }catch(error){
        if(!isPrepareStillRunning(error)&&!isRecoverableTransport(error))throw error;
        recoveryChecks+=1;
        renderWorking(isPrepareStillRunning(error)
          ? `安全备份仍在后台执行，正在等待同一任务完成（确认 ${recoveryChecks}）`
          : `浏览器连接短暂中断，正在恢复同一后台任务（确认 ${recoveryChecks}）`);
        await wait(20_000);
      }
    }
  }

  async function v505OpenDataPurge(){
    if(active)return;
    let session;
    try{session=await requestJson('/api/session');}catch(error){return alert(`无法读取管理员状态：${error.message}`);}
    if(String(session?.user?.role||'').toUpperCase()!=='ADMIN')return;
    if(!global.confirm('确定要清空全部业务数据吗？系统会先创建并校验完整备份，用户、权限、配置、白名单、备份和审计不会删除。'))return;

    const dialog=document.getElementById('dataPurgeDialog');
    const stepOne=document.getElementById('purgeStepOne');
    const stepTwo=document.getElementById('purgeStepTwo');
    if(stepOne)stepOne.hidden=false;
    if(stepTwo)stepTwo.hidden=true;
    if(dialog)dialog.hidden=false;
    active=true;
    startedAt=Date.now();
    renderWorking();
    startElapsedClock();

    try{
      const challenge=await prepareWithRecovery();
      try{purgeChallenge=challenge;}catch{}
      const node=previewNode();
      const total=Object.values(challenge.counts||{}).reduce((sum,value)=>sum+Number(value||0),0);
      if(node){
        node.innerHTML=`<div class="purge-success"><b>安全备份与完整性校验已完成。</b>${challenge.recovered?' 已恢复之前正在执行的同一任务。':''}</div><dl><dt>数据库</dt><dd>${escapeText(challenge.databasePath||'')}</dd><dt>业务记录总行数</dt><dd>${Number(total||0).toLocaleString()}</dd><dt>安全备份</dt><dd>${escapeText(challenge.backup?.path||'')}</dd><dt>备份大小</dt><dd>${Number(challenge.backup?.size||0).toLocaleString()} 字节</dd><dt>完整性</dt><dd>${escapeText(challenge.backup?.integrity||'')}</dd></dl>`;
      }
      const waitMs=Math.max(0,new Date(challenge.notBefore).getTime()-Date.now());
      if(waitMs>0){
        node?.insertAdjacentHTML('beforeend',`<div class="purge-warning">安全倒计时 ${Math.ceil(waitMs/1000)} 秒后自动清空。</div>`);
        await wait(waitMs+100);
      }
      node?.insertAdjacentHTML('beforeend','<div class="purge-warning"><b>正在执行最终清空并刷新看板…</b></div>');
      const result=await requestJson('/api/admin/data-purge/execute',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challengeId:challenge.challengeId,phrase:'永久清除全部业务数据',backupConfirmed:true})
      });
      stopElapsedClock();
      if(typeof global.applyCompletedPurge==='function')await global.applyCompletedPurge(result);
      else if(typeof applyCompletedPurge==='function')await applyCompletedPurge(result);
      else location.reload();
    }catch(error){
      stopElapsedClock();
      const node=previewNode();
      if(node)node.innerHTML=`<div class="purge-error"><b>清空未执行。</b><br>${escapeText(error.message||error)}<br><small>业务数据没有因本提示被重复删除；可关闭窗口后重新进入。</small></div>`;
    }finally{
      active=false;
    }
  }

  function claimPurgeOwner(){
    global.openDataPurge=v505OpenDataPurge;
    try{openDataPurge=v505OpenDataPurge;}catch{}
  }

  claimPurgeOwner();
  setTimeout(claimPurgeOwner,1200);
  setTimeout(claimPurgeOwner,3500);
  global.__CE_QC_V505_DATA_PURGE_RECOVERY__={patchId:PATCH_ID,openDataPurge:v505OpenDataPurge,getStatus:()=>({active,lastStatus,startedAt})};
  console.info('[CE-QC][V505_DATA_PURGE_RECOVERY]',PATCH_ID);
})(window);
