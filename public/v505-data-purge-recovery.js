(function installV505DataPurgeRecovery(global){
  if(global.__CE_QC_V505_DATA_PURGE_RECOVERY__)return;
  const PATCH_ID='2026-09-10-v505-async-purge-prepare-execute-ui-v6';
  let active=false;
  let elapsedTimer=null;
  let startedAt=0;
  let lastStatus='';
  let currentJob=null;

  const escapeText=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const previewNode=()=>document.getElementById('purgePreview');

  async function requestJson(url,options={},timeoutMs=10000){
    const controller=timeoutMs>0?new AbortController():null;
    const timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
    try{
      const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options,...(controller?{signal:controller.signal}:{})});
      const raw=await response.text();
      let data={};try{data=raw?JSON.parse(raw):{};}catch{}
      if(!response.ok||data.ok===false){const error=new Error(data.error||data.message||`HTTP ${response.status}`);error.status=response.status;error.payload=data;throw error;}
      return data;
    }catch(error){
      if(error?.name==='AbortError'){
        const wrapped=new Error('状态请求超时，后台任务不会因此重复启动。');
        wrapped.code='PURGE_TRANSPORT_TIMEOUT';
        throw wrapped;
      }
      const wrapped=error instanceof Error?error:new Error(String(error||'后台连接中断'));
      if(!wrapped.code)wrapped.code='PURGE_TRANSPORT_INTERRUPTED';
      throw wrapped;
    }finally{if(timer)clearTimeout(timer);}
  }

  function elapsedText(){
    const seconds=Math.max(0,Math.floor((Date.now()-startedAt)/1000));
    const minutes=Math.floor(seconds/60);const remain=seconds%60;
    return minutes?`${minutes}分${String(remain).padStart(2,'0')}秒`:`${seconds}秒`;
  }

  function renderWorking(message='后台已接收任务，正在创建并校验清空前安全备份',detail='任务在独立进程执行；页面只读取真实状态，不会因为心跳延迟重复启动任务。'){
    const node=previewNode();if(!node)return;
    lastStatus=message;
    node.innerHTML=`<div class="purge-warning"><b>${escapeText(message)}</b><br><span>后台任务独立执行 · 已等待 <b id="v505PurgeElapsed">${escapeText(elapsedText())}</b></span><br><small>${escapeText(detail)}</small></div>`;
  }
  function startElapsedClock(){clearInterval(elapsedTimer);elapsedTimer=setInterval(()=>{const node=document.getElementById('v505PurgeElapsed');if(node)node.textContent=elapsedText();},1000);}
  function stopElapsedClock(){clearInterval(elapsedTimer);elapsedTimer=null;}

  async function submitPrepare(){
    return requestJson('/api/admin/data-purge/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},12000);
  }

  async function pollBackgroundJob(job,mode='PREPARE'){
    const statusUrl=String(job.statusUrl||job.pollUrl||'');
    if(!statusUrl)throw new Error('后台任务没有返回状态地址，已安全停止。');
    const deadline=Date.now()+(mode==='EXECUTE'?60:45)*60_000;
    let transportErrors=0;
    while(Date.now()<deadline){
      let status;
      try{
        status=await requestJson(`${statusUrl}?t=${Date.now()}`,{},7000);
        transportErrors=0;
      }catch(error){
        transportErrors+=1;
        renderWorking('状态通道短暂不可用，后台任务保持锁定并继续运行',`正在自动重连（${transportErrors}/30）。不要重复点击清空。`);
        if(transportErrors>=30){
          const blocked=new Error('页面暂时无法读取后台状态，但系统仍保持清空任务锁。请稍后重新打开数据管理查看结果，不要重复点击。');
          blocked.code='PURGE_STATUS_UNAVAILABLE';
          throw blocked;
        }
        await wait(2000);continue;
      }
      if(String(status.jobId||'')!==String(job.jobId||''))throw new Error('后台任务编号不一致，已安全停止。');
      const state=String(status.status||'').toUpperCase();
      if(state==='SUCCEEDED')return status;
      if(state==='FAILED')throw new Error(status.error||`${mode==='EXECUTE'?'清空':'安全备份'}后台任务失败。`);
      const heartbeatAt=Number(status.heartbeatAt||0);
      const stale=Boolean(status.heartbeatStale)||(heartbeatAt>0&&Date.now()-heartbeatAt>60_000);
      if(stale){
        renderWorking(mode==='EXECUTE'?'清空进程仍在运行，但状态心跳延迟':'安全备份进程仍在运行，但状态心跳延迟','系统不会解除任务锁，也不会启动第二个任务；继续等待真实进程结果。');
      }else if(mode==='EXECUTE'){
        renderWorking('正在后台事务化清空业务数据','HTTP请求已经结束；独立进程完成后页面会自动刷新。');
      }else{
        renderWorking(state==='QUEUED'?'安全备份任务已排队，等待独立进程接管':'正在后台备份并校验数据库完整性');
      }
      await wait(2000);
    }
    const timeout=new Error(`后台${mode==='EXECUTE'?'清空':'安全备份'}超过等待上限。任务锁仍然有效时系统不会重复启动；请稍后重新进入数据管理查看。`);
    timeout.code='PURGE_BACKGROUND_WAIT_LIMIT';
    throw timeout;
  }

  async function recoverVerifiedChallenge(job){
    const result=await requestJson('/api/admin/data-purge/prepare',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recoverJobId:job.jobId})
    },12000);
    if(String(result.kind||'').toUpperCase()==='EXECUTE')return result;
    if(String(result.status||'').toUpperCase()!=='SUCCEEDED'||!result.challengeId)throw new Error('安全备份完成，但最终清空凭证尚未就绪。');
    return result;
  }

  async function finishExistingExecution(job){
    const status=String(job.status||'').toUpperCase();
    if(status!=='SUCCEEDED')await pollBackgroundJob(job,'EXECUTE');
    stopElapsedClock();
    const node=previewNode();
    if(node)node.innerHTML='<div class="purge-success"><b>业务数据已安全清空。</b><br>正在刷新系统状态…</div>';
    await wait(500);
    location.reload();
  }

  async function executeChallenge(challenge){
    const node=previewNode();
    const waitMs=Math.max(0,new Date(challenge.notBefore).getTime()-Date.now());
    if(waitMs>0){
      node?.insertAdjacentHTML('beforeend',`<div class="purge-warning">安全倒计时 ${Math.ceil(waitMs/1000)} 秒后自动提交后台清空。</div>`);
      await wait(waitMs+100);
    }
    renderWorking('正在提交后台事务化清空任务','提交接口只负责创建独立任务，不再等待大数据库DELETE完成。');
    const execution=await requestJson('/api/admin/data-purge/execute',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challengeId:challenge.challengeId,phrase:'永久清除全部业务数据',backupConfirmed:true})
    },12000);
    currentJob=execution;
    if(execution?.async||String(execution.kind||'').toUpperCase()==='EXECUTE'){
      await finishExistingExecution(execution);
      return null;
    }
    return execution;
  }

  async function v505OpenDataPurge(){
    if(active)return;
    let session;
    try{session=await requestJson('/api/session',{},8000);}catch(error){return alert(`无法读取管理员状态：${error.message}`);}
    if(String(session?.user?.role||'').toUpperCase()!=='ADMIN')return;
    if(!global.confirm('确定要清空全部业务数据吗？系统会先创建并校验完整备份，用户、权限、配置、白名单、备份和审计不会删除。'))return;

    const dialog=document.getElementById('dataPurgeDialog');
    const stepOne=document.getElementById('purgeStepOne');
    const stepTwo=document.getElementById('purgeStepTwo');
    if(stepOne)stepOne.hidden=false;if(stepTwo)stepTwo.hidden=true;if(dialog)dialog.hidden=false;
    active=true;startedAt=Date.now();currentJob=null;renderWorking();startElapsedClock();

    try{
      let submitted=await submitPrepare();
      currentJob=submitted;
      if(String(submitted.kind||'').toUpperCase()==='EXECUTE'){
        await finishExistingExecution(submitted);
        return;
      }
      if(String(submitted.status||'').toUpperCase()!=='SUCCEEDED'||!submitted.challengeId){
        await pollBackgroundJob(submitted,'PREPARE');
        renderWorking('安全备份已完成，正在读取最终校验凭证');
        submitted=await recoverVerifiedChallenge(submitted);
        currentJob=submitted;
        if(String(submitted.kind||'').toUpperCase()==='EXECUTE'){
          await finishExistingExecution(submitted);
          return;
        }
      }

      const challenge=submitted;
      const node=previewNode();
      if(node){
        node.innerHTML=`<div class="purge-success"><b>安全备份与完整性校验已完成。</b></div><dl><dt>数据库</dt><dd>${escapeText(challenge.databasePath||'')}</dd><dt>安全备份</dt><dd>${escapeText(challenge.backup?.path||'')}</dd><dt>备份大小</dt><dd>${Number(challenge.backup?.size||0).toLocaleString()} 字节</dd><dt>完整性</dt><dd>${escapeText(challenge.backup?.integrity||'')}</dd></dl>`;
      }
      const result=await executeChallenge(challenge);
      if(result){
        stopElapsedClock();
        if(typeof global.applyCompletedPurge==='function')await global.applyCompletedPurge(result);
        else if(typeof applyCompletedPurge==='function')await applyCompletedPurge(result);
        else location.reload();
      }
    }catch(error){
      stopElapsedClock();
      const node=previewNode();
      const keepLocked=['PURGE_STATUS_UNAVAILABLE','PURGE_BACKGROUND_WAIT_LIMIT','PURGE_TRANSPORT_TIMEOUT'].includes(String(error?.code||''));
      if(node)node.innerHTML=`<div class="purge-error"><b>${keepLocked?'后台任务状态暂时无法确认。':'清空未执行。'}</b><br>${escapeText(error.message||error)}<br><small>${keepLocked?'不要重复点击；系统仍按任务锁保护，稍后重新进入数据管理查看。':'安全机制已经停止本次动作；确认后台进程已结束后再重新开始。'}</small></div>`;
    }finally{active=false;}
  }

  function claimPurgeOwner(){global.openDataPurge=v505OpenDataPurge;try{openDataPurge=v505OpenDataPurge;}catch{}}
  claimPurgeOwner();setTimeout(claimPurgeOwner,1200);setTimeout(claimPurgeOwner,3500);
  global.__CE_QC_V505_DATA_PURGE_RECOVERY__={patchId:PATCH_ID,openDataPurge:v505OpenDataPurge,getStatus:()=>({active,lastStatus,startedAt,currentJob})};
  global.__CE_QC_V105_ASYNC_PURGE_UI__={version:PATCH_ID,isPolling:()=>active,isFlowActive:()=>active,pollDelay:()=>2000,recoverRecentJob:async()=>currentJob,owner:'V505'};
  console.info('[CE-QC][V505_DATA_PURGE_RECOVERY]',PATCH_ID);
})(window);
