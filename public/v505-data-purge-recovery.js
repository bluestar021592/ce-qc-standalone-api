(function installV505DataPurgeRecovery(global){
  const PATCH_ID='2026-09-20-v555-visible-execute-progress-v1';
  const previous=global.__CE_QC_V505_DATA_PURGE_RECOVERY__;
  if(previous?.patchId===PATCH_ID)return;
  if(previous?.getStatus?.().active){
    console.warn('[CE-QC][V505_DATA_PURGE_RECOVERY] active older owner retained until its current protected flow completes',previous.patchId||'unknown');
    return;
  }
  let active=false;
  let elapsedTimer=null;
  let confirmTimer=null;
  let startedAt=0;
  let lastStatus='';
  let currentJob=null;
  let preparedChallenge=null;
  let prepareInFlight=false;
  let executeInFlight=false;
  let dialogOpen=false;

  const escapeText=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const previewNode=()=>document.getElementById('purgePreview');
  const TRANSIENT_CONTROL_CODES=new Set(['PURGE_TRANSPORT_TIMEOUT','PURGE_TRANSPORT_INTERRUPTED','DATA_PURGE_SUBMISSION_BUSY','DATA_PURGE_HTTP_BUSY']);

  async function requestJson(url,options={},timeoutMs=10000){
    const controller=timeoutMs>0?new AbortController():null;
    const timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
    try{
      const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options,...(controller?{signal:controller.signal}:{})});
      const raw=await response.text();
      let data={};try{data=raw?JSON.parse(raw):{};}catch{}
      if(!response.ok||data.ok===false){
        const error=new Error(data.error||data.message||`HTTP ${response.status}`);
        error.status=response.status;
        error.payload=data;
        error.code=String(data.code||'PURGE_HTTP_REJECTED');
        throw error;
      }
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
  function renderIdle(){
    const node=previewNode();if(!node)return;
    lastStatus='等待管理员明确开始安全备份';
    node.innerHTML='<div class="purge-warning"><b>尚未开始任何备份或清空任务。</b><br><small>只有点击“备份并继续”后才会创建并校验清空前安全备份；仅打开此窗口不会启动25GB+数据库复制。</small></div>';
  }
  function startElapsedClock(){clearInterval(elapsedTimer);elapsedTimer=setInterval(()=>{const node=document.getElementById('v505PurgeElapsed');if(node)node.textContent=elapsedText();},1000);}
  function stopElapsedClock(){clearInterval(elapsedTimer);elapsedTimer=null;}
  function stopConfirmClock(){clearInterval(confirmTimer);confirmTimer=null;}
  function showExecutionProgress(){
    const stepOne=document.getElementById('purgeStepOne');
    const stepTwo=document.getElementById('purgeStepTwo');
    const button=document.getElementById('purgeExecuteButton');
    if(button)button.disabled=true;
    if(stepTwo)stepTwo.hidden=true;
    if(stepOne)stepOne.hidden=false;
    renderWorking('正在提交后台事务化清空任务','最终确认已收到。页面现在只显示真实后台任务状态；不要重复点击清空。');
  }

  async function submitPrepare(){
    return requestJson('/api/admin/data-purge/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},12000);
  }

  async function submitPrepareRecovering(maxAttempts=4){
    let lastError=null;
    for(let attempt=1;attempt<=maxAttempts;attempt+=1){
      try{return await submitPrepare();}
      catch(error){
        lastError=error;
        if(!TRANSIENT_CONTROL_CODES.has(String(error?.code||''))||attempt>=maxAttempts)throw error;
        renderWorking('正在恢复后台任务真实状态',`控制请求未确认（${attempt}/${maxAttempts}），系统只恢复同一任务，不会启动第二份备份或第二次删除。`);
        await wait(Math.min(3000,750*attempt));
      }
    }
    throw lastError||new Error('无法恢复后台任务状态。');
  }

  async function probeExecutionRecovery(job){
    const recovered=await submitPrepareRecovering(3);
    if(String(recovered.kind||'').toUpperCase()!=='EXECUTE')return job;
    if(String(recovered.jobId||'')!==String(job.jobId||''))throw new Error('后台恢复任务编号不一致，已安全停止。');
    const merged={...job,...recovered};
    currentJob=merged;
    return merged;
  }

  async function pollBackgroundJob(initialJob,mode='PREPARE'){
    let job=initialJob;
    let statusUrl=String(job.statusUrl||job.pollUrl||'');
    if(!statusUrl)throw new Error('后台任务没有返回状态地址，已安全停止。');
    const deadline=Date.now()+(mode==='EXECUTE'?60:45)*60_000;
    let transportErrors=0;
    let lastRecoveryProbeAt=0;
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
      let state=String(status.status||'').toUpperCase();
      if(state==='SUCCEEDED')return status;
      if(state==='FAILED')throw new Error(status.error||`${mode==='EXECUTE'?'清空':'安全备份'}后台任务失败。`);
      const heartbeatAt=Number(status.heartbeatAt||0);
      const heartbeatAge=heartbeatAt>0?Date.now()-heartbeatAt:0;
      const stale=Boolean(status.heartbeatStale)||(heartbeatAt>0&&heartbeatAge>60_000);
      const committedRecoveryDue=mode==='EXECUTE'&&state==='COMMITTED'&&heartbeatAt>0&&heartbeatAge>15_000;

      if(mode==='EXECUTE'&&(stale||committedRecoveryDue)&&Date.now()-lastRecoveryProbeAt>=10_000){
        lastRecoveryProbeAt=Date.now();
        try{
          job=await probeExecutionRecovery(job);
          statusUrl=String(job.statusUrl||job.pollUrl||statusUrl);
          state=String(job.status||state).toUpperCase();
          if(state==='SUCCEEDED')return job;
          if(state==='FAILED')throw new Error(job.error||'后台清空任务失败。');
        }catch(error){
          if(String(error?.message||'').includes('任务编号不一致'))throw error;
          renderWorking('正在核对后台清空任务真实状态','恢复探针不会解除任务锁，也不会重复删除；无法确认时继续等待原任务。');
        }
      }

      if(state==='COMMITTED'){
        renderWorking('业务数据事务已经提交，正在完成后置清理','系统持有精确提交凭证；即使原进程中断，也只恢复清理，不会再次执行删除。');
      }else if(stale){
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
    try{
      const result=await requestJson('/api/admin/data-purge/prepare',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recoverJobId:job.jobId})
      },12000);
      if(String(result.kind||'').toUpperCase()==='EXECUTE')return result;
      if(String(result.status||'').toUpperCase()!=='SUCCEEDED'||!result.challengeId)throw new Error('安全备份完成，但最终清空凭证尚未就绪。');
      return result;
    }catch(error){
      if(!TRANSIENT_CONTROL_CODES.has(String(error?.code||'')))throw error;
      const recovered=await submitPrepareRecovering(3);
      if(String(recovered.kind||'').toUpperCase()==='EXECUTE')return recovered;
      if(String(recovered.status||'').toUpperCase()!=='SUCCEEDED'||!recovered.challengeId)throw error;
      return recovered;
    }
  }

  async function finishExistingExecution(job){
    const status=String(job.status||'').toUpperCase();
    if(status!=='SUCCEEDED')await pollBackgroundJob(job,'EXECUTE');
    stopElapsedClock();stopConfirmClock();
    const node=previewNode();
    if(node)node.innerHTML='<div class="purge-success"><b>业务数据已安全清空。</b><br>正在刷新系统状态…</div>';
    await wait(500);
    location.reload();
  }

  async function postExecute(challenge){
    return requestJson('/api/admin/data-purge/execute',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challengeId:challenge.challengeId,phrase:'永久清除全部业务数据',backupConfirmed:true})
    },12000);
  }

  async function submitExecuteRecovering(challenge){
    try{return await postExecute(challenge);}
    catch(error){
      if(!TRANSIENT_CONTROL_CODES.has(String(error?.code||'')))throw error;
      renderWorking('清空提交响应未确认，正在恢复真实后台状态','不会因为HTTP中断再次直接删除；先读取服务端持久化任务。');
      const recovered=await submitPrepareRecovering(4);
      if(String(recovered.kind||'').toUpperCase()==='EXECUTE')return recovered;
      const sameChallenge=String(recovered.challengeId||'')===String(challenge.challengeId||'');
      if(String(recovered.status||'').toUpperCase()==='SUCCEEDED'&&sameChallenge){
        renderWorking('未发现已创建的删除任务，正在安全重提同一验证凭证','服务端精确凭证和全局提交锁会阻止重复DELETE。');
        return postExecute(challenge);
      }
      throw error;
    }
  }

  async function executeChallenge(challenge){
    renderWorking('正在提交后台事务化清空任务','只有管理员完成第二步勾选、精确短语和最终确认后才会进入这里。');
    const execution=await submitExecuteRecovering(challenge);
    currentJob=execution;
    if(execution?.async||String(execution.kind||'').toUpperCase()==='EXECUTE'){
      await finishExistingExecution(execution);
      return null;
    }
    return execution;
  }

  function refreshExplicitExecuteButton(){
    const button=document.getElementById('purgeExecuteButton');
    const countdown=document.getElementById('purgeCountdown');
    const checkbox=document.getElementById('purgeBackupConfirmed');
    const phrase=document.getElementById('purgePhrase');
    const challenge=preparedChallenge;
    const waitMs=challenge?Math.max(0,new Date(challenge.notBefore).getTime()-Date.now()):Infinity;
    const exact=String(phrase?.value||'')==='永久清除全部业务数据';
    const confirmed=Boolean(checkbox?.checked);
    const ready=Boolean(challenge&&Number.isFinite(waitMs)&&waitMs<=0&&exact&&confirmed&&!executeInFlight);
    if(button)button.disabled=!ready;
    if(countdown){
      if(!challenge)countdown.textContent='请先完成安全备份';
      else if(waitMs>0)countdown.textContent=`请等待 ${Math.ceil(waitMs/1000)} 秒`;
      else if(!confirmed||!exact)countdown.textContent='请勾选备份确认并准确输入确认短语';
      else countdown.textContent='已完成安全倒计时，可最终确认清空';
    }
    return ready;
  }

  function showPreparedChallenge(challenge){
    preparedChallenge=challenge;
    currentJob=challenge;
    stopElapsedClock();
    const node=previewNode();
    if(node)node.innerHTML=`<div class="purge-success"><b>安全备份与完整性校验已完成。</b><br><small>尚未提交任何删除任务。请在第二步再次明确确认。</small></div><dl><dt>数据库</dt><dd>${escapeText(challenge.databasePath||'')}</dd><dt>安全备份</dt><dd>${escapeText(challenge.backup?.path||'')}</dd><dt>备份大小</dt><dd>${Number(challenge.backup?.size||0).toLocaleString()} 字节</dd><dt>完整性</dt><dd>${escapeText(challenge.backup?.integrity||'')}</dd></dl>`;
    if(!dialogOpen){
      lastStatus='安全备份已完成；没有提交删除任务';
      active=false;
      return;
    }
    const stepOne=document.getElementById('purgeStepOne');
    const stepTwo=document.getElementById('purgeStepTwo');
    if(stepOne)stepOne.hidden=true;
    if(stepTwo)stepTwo.hidden=false;
    const admin=document.getElementById('purgeAdmin');if(admin)admin.textContent=String(challenge.administrator||'当前管理员');
    const phrase=document.getElementById('purgePhrase');if(phrase)phrase.value='';
    const checkbox=document.getElementById('purgeBackupConfirmed');if(checkbox)checkbox.checked=false;
    stopConfirmClock();
    refreshExplicitExecuteButton();
    confirmTimer=setInterval(refreshExplicitExecuteButton,250);
  }

  async function v505ContinueDataPurge(){
    if(prepareInFlight||executeInFlight)return;
    if(preparedChallenge){showPreparedChallenge(preparedChallenge);return;}
    active=true;prepareInFlight=true;startedAt=Date.now();renderWorking('正在创建并校验清空前安全备份','这是管理员点击“备份并继续”后才启动的独立后台任务；不会自动提交删除。');startElapsedClock();
    try{
      let submitted=await submitPrepareRecovering(4);
      currentJob=submitted;
      if(String(submitted.kind||'').toUpperCase()==='EXECUTE'){
        executeInFlight=true;
        await finishExistingExecution(submitted);
        return;
      }
      if(String(submitted.status||'').toUpperCase()!=='SUCCEEDED'||!submitted.challengeId){
        await pollBackgroundJob(submitted,'PREPARE');
        renderWorking('安全备份已完成，正在读取最终校验凭证','仍未提交任何删除任务。');
        submitted=await recoverVerifiedChallenge(submitted);
        currentJob=submitted;
        if(String(submitted.kind||'').toUpperCase()==='EXECUTE'){
          executeInFlight=true;
          await finishExistingExecution(submitted);
          return;
        }
      }
      if(String(submitted.status||'').toUpperCase()!=='SUCCEEDED'||!submitted.challengeId)throw new Error('安全备份未返回可用的清空凭证。');
      showPreparedChallenge(submitted);
    }catch(error){
      stopElapsedClock();
      const node=previewNode();
      const code=String(error?.code||'');
      const keepLocked=['PURGE_STATUS_UNAVAILABLE','PURGE_BACKGROUND_WAIT_LIMIT','PURGE_TRANSPORT_TIMEOUT','PURGE_TRANSPORT_INTERRUPTED'].includes(code)||/^DATA_PURGE_|^V505_PURGE_/.test(code)||Number(error?.status||0)===423;
      if(node)node.innerHTML=`<div class="purge-error"><b>${keepLocked?'后台任务或安全锁状态需要继续核对。':'备份未完成，未执行清空。'}</b><br>${escapeText(error.message||error)}<br><small>${keepLocked?'不要重复点击；系统会继续按持久化任务和安全锁保护。':'没有提交删除任务，可关闭窗口。'}</small></div>`;
    }finally{
      prepareInFlight=false;
      if(!executeInFlight&&(!dialogOpen||!preparedChallenge))active=false;
    }
  }

  async function v505ExecuteDataPurge(){
    if(executeInFlight||prepareInFlight)return;
    if(!refreshExplicitExecuteButton()||!preparedChallenge)return alert('请先完成备份确认、准确输入“永久清除全部业务数据”，并等待安全倒计时结束。');
    if(!global.confirm('最终确认：现在将永久清除全部业务数据。安全备份、用户、权限、配置、白名单和审计不会删除。是否继续？'))return;
    active=true;executeInFlight=true;startedAt=Date.now();stopConfirmClock();showExecutionProgress();startElapsedClock();
    try{
      const result=await executeChallenge(preparedChallenge);
      if(result){
        stopElapsedClock();
        if(typeof global.applyCompletedPurge==='function')await global.applyCompletedPurge(result);
        else if(typeof applyCompletedPurge==='function')await applyCompletedPurge(result);
        else location.reload();
      }
    }catch(error){
      stopElapsedClock();
      const node=previewNode();
      const code=String(error?.code||'');
      const keepLocked=['PURGE_STATUS_UNAVAILABLE','PURGE_BACKGROUND_WAIT_LIMIT','PURGE_TRANSPORT_TIMEOUT','PURGE_TRANSPORT_INTERRUPTED'].includes(code)||/^DATA_PURGE_|^V505_PURGE_/.test(code)||Number(error?.status||0)===423;
      if(node)node.innerHTML=`<div class="purge-error"><b>${keepLocked?'后台任务或安全锁状态需要继续核对。':'清空未执行。'}</b><br>${escapeText(error.message||error)}<br><small>${keepLocked?'不要重复点击；系统会继续按持久化任务和安全锁保护，稍后重新进入数据管理查看。':'安全机制已经停止本次动作；确认后台进程已结束后再重新开始。'}</small></div>`;
    }finally{executeInFlight=false;active=false;}
  }

  function v505CloseDataPurge(){
    if(executeInFlight)return alert('清空事务已经提交，当前不能把它当作已取消。请等待后台真实状态返回。');
    dialogOpen=false;
    const dialog=document.getElementById('dataPurgeDialog');if(dialog)dialog.hidden=true;
    stopConfirmClock();
    if(!prepareInFlight){stopElapsedClock();active=false;}
    if(prepareInFlight)lastStatus='安全备份仍在后台执行；关闭窗口不会提交删除任务';
  }

  async function v505OpenDataPurge(){
    if(executeInFlight)return;
    const knownRole=typeof accessSession!=='undefined'?String(accessSession?.user?.role||'').toUpperCase():'';
    if(knownRole&&knownRole!=='ADMIN')return alert('当前账户不是管理员，无法清空业务数据。');
    if(!global.confirm('打开清空向导？仅打开窗口不会启动备份，也不会删除数据。只有下一步明确点击“备份并继续”后才会开始创建安全备份。'))return;

    const dialog=document.getElementById('dataPurgeDialog');
    const stepOne=document.getElementById('purgeStepOne');
    const stepTwo=document.getElementById('purgeStepTwo');
    if(stepOne)stepOne.hidden=false;if(stepTwo)stepTwo.hidden=true;if(dialog)dialog.hidden=false;
    dialogOpen=true;active=true;preparedChallenge=null;currentJob=null;stopElapsedClock();stopConfirmClock();renderIdle();
  }

  function claimPurgeOwner(){
    global.openDataPurge=v505OpenDataPurge;
    global.continueDataPurge=v505ContinueDataPurge;
    global.executeDataPurge=v505ExecuteDataPurge;
    global.updatePurgeButton=refreshExplicitExecuteButton;
    global.closeDataPurge=v505CloseDataPurge;
    try{openDataPurge=v505OpenDataPurge;}catch{}
    try{continueDataPurge=v505ContinueDataPurge;}catch{}
    try{executeDataPurge=v505ExecuteDataPurge;}catch{}
    try{updatePurgeButton=refreshExplicitExecuteButton;}catch{}
    try{closeDataPurge=v505CloseDataPurge;}catch{}
  }
  claimPurgeOwner();setTimeout(claimPurgeOwner,1600);setTimeout(claimPurgeOwner,4200);setTimeout(claimPurgeOwner,8000);
  global.__CE_QC_V505_DATA_PURGE_RECOVERY__={patchId:PATCH_ID,openDataPurge:v505OpenDataPurge,continueDataPurge:v505ContinueDataPurge,executeDataPurge:v505ExecuteDataPurge,getStatus:()=>({active,lastStatus,startedAt,currentJob,preparedChallenge:Boolean(preparedChallenge),prepareInFlight,executeInFlight,dialogOpen})};
  global.__CE_QC_V105_ASYNC_PURGE_UI__={version:PATCH_ID,isPolling:()=>prepareInFlight||executeInFlight,isFlowActive:()=>active,pollDelay:()=>2000,recoverRecentJob:async()=>currentJob,owner:'V505'};
  console.info('[CE-QC][V505_DATA_PURGE_RECOVERY]',PATCH_ID);
})(window);
