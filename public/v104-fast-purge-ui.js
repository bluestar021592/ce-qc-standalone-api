(function installAsyncPurgeUiV130(global){
  if(global.__CE_QC_V105_ASYNC_PURGE_UI__)return;
  const VERSION='2026-08-14-v130-resilient-purge-submit-v4';
  let polling=false;
  let flowActive=false;

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const elapsedText=ms=>`${Math.max(0,Math.floor(Number(ms||0)/1000))} 秒`;

  function progressHtml(status={},mode='PREPARE'){
    const progress=Math.max(0,Math.min(100,Number(status.progress||0)));
    const title=mode==='EXECUTE'?'正在后台安全清空业务数据':'安全备份正在后台执行';
    return `<div class="purge-warning"><strong>${title}</strong><br>${escapeHtml(status.message||'正在处理')}<br><span>已用 ${escapeHtml(elapsedText(status.elapsedMs))} · ${progress}%</span><div style="height:8px;margin-top:10px;border-radius:8px;background:#eef3f8;overflow:hidden"><i style="display:block;height:100%;width:${progress}%;background:#1677ff;transition:width .25s ease"></i></div><small style="display:block;margin-top:8px;color:#6b7f96">任务在后台执行；完成后自动进入下一步。</small></div>`;
  }

  function setPreview(preview,html){if(preview&&preview.innerHTML!==html)preview.innerHTML=html;}
  function pollDelay(mode,unchangedCycles,networkErrors=0){
    if(document.visibilityState==='hidden')return 4000;
    if(networkErrors>0)return Math.min(4000,1600+networkErrors*300);
    if(mode==='EXECUTE'){
      if(unchangedCycles>=6)return 1800;
      if(unchangedCycles>=2)return 1200;
      return 700;
    }
    if(unchangedCycles>=8)return 2500;
    if(unchangedCycles>=3)return 1800;
    return 1000;
  }

  function abortLike(error){
    const name=String(error?.name||'');
    const text=String(error?.message||error||'');
    return name==='AbortError'||name==='TimeoutError'||/signal is aborted|aborted without reason|request.*timeout|timed out/i.test(text);
  }

  function recoverableTransport(error){
    const name=String(error?.name||'');
    const text=String(error?.message||error||'');
    return abortLike(error)||name==='TypeError'||/failed to fetch|network|load failed|连接|socket|connection/i.test(text);
  }

  async function directJson(url,options={},timeoutMs=7000){
    const controller=timeoutMs>0?new AbortController():null;
    const timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
    try{
      const init={cache:'no-store',credentials:'same-origin',...options};
      if(controller)init.signal=controller.signal;
      const response=await fetch(url,init);
      const text=await response.text();
      let payload={};
      try{payload=text?JSON.parse(text):{};}catch{}
      if(!response.ok||payload.ok===false){
        const error=new Error(payload.error||payload.message||`HTTP ${response.status}`);
        error.status=response.status;error.payload=payload;throw error;
      }
      return payload;
    }catch(error){
      if(abortLike(error)){
        const wrapped=new Error('请求响应延迟，正在自动恢复后台任务状态');
        wrapped.submitTimeout=true;wrapped.cause=error;throw wrapped;
      }
      throw error;
    }finally{if(timer)clearTimeout(timer);}
  }

  async function recoverRecentJob(kind){
    try{return await directJson(`/api/v105/data-purge/recover?kind=${encodeURIComponent(kind)}`,{},4000);}
    catch(error){if(Number(error?.status)===404)return null;throw error;}
  }

  async function recoverLoop(kind,preview){
    await sleep(900);
    for(let attempt=0;attempt<40;attempt+=1){
      if(attempt===0||attempt%5===0)setPreview(preview,`<div class="purge-warning"><strong>后台任务提交响应延迟</strong><br>正在自动恢复真实任务状态，请勿重复点击。已尝试 ${attempt+1} 次。</div>`);
      try{
        const recovered=await recoverRecentJob(kind);
        if(recovered?.jobId&&recovered?.pollUrl)return recovered;
      }catch(error){
        const status=Number(error?.status||0);
        if((status>=400&&status<500)&&status!==404)throw error;
      }
      await sleep(Math.min(1800,500+attempt*40));
    }
    throw new Error('后台任务状态暂时无法确认。请保持后台运行并重新打开“数据管理”查看结果，不要重复点击清空。');
  }

  async function submitBackground(kind,url,body,preview){
    const submitPromise=directJson(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})},0)
      .then(value=>({source:'submit',value}))
      .catch(error=>({source:'submitError',error}));
    const recoveryPromise=recoverLoop(kind,preview).then(value=>({source:'recover',value}));
    const outcome=await Promise.race([submitPromise,recoveryPromise]);
    if(outcome.source==='submit')return outcome.value;
    if(outcome.source==='recover')return outcome.value;
    if(!recoverableTransport(outcome.error))throw outcome.error;
    return (await recoveryPromise).value;
  }

  async function pollJob(pollUrl,preview,mode='PREPARE'){
    polling=true;
    let lastSignature='';
    let unchangedCycles=0;
    let networkErrors=0;
    let lastRenderedSecond=-1;
    try{
      for(let attempt=0;attempt<2400;attempt+=1){
        try{
          const status=await directJson(pollUrl,{},8000);
          networkErrors=0;
          if(status.status==='COMPLETED')return status.result;
          if(status.status==='FAILED'){
            const failure=new Error(status.error||status.message||'后台任务失败');
            failure.purgeJobFailed=true;
            throw failure;
          }
          const signature=`${status.status}|${status.progress}|${status.message||''}`;
          if(signature===lastSignature)unchangedCycles+=1;
          else{lastSignature=signature;unchangedCycles=0;}
          const elapsedSecond=Math.floor(Number(status.elapsedMs||0)/1000);
          if(lastRenderedSecond<0||elapsedSecond-lastRenderedSecond>=2||unchangedCycles===0){
            setPreview(preview,progressHtml(status,mode));
            lastRenderedSecond=elapsedSecond;
          }
        }catch(error){
          const httpStatus=Number(error?.status||0);
          if(error?.purgeJobFailed||error?.reloginRequired||(httpStatus>=400&&httpStatus<500))throw error;
          networkErrors+=1;
          if(networkErrors>=20)throw new Error('后台任务仍在执行，但页面连续无法读取状态。请保持后台运行，稍后重新打开数据管理查看结果。');
          setPreview(preview,`<div class="purge-warning"><strong>后台任务仍在运行</strong><br>主进程正在处理数据库，页面正在自动恢复状态（${networkErrors}/20）…</div>`);
        }
        await sleep(pollDelay(mode,unchangedCycles,networkErrors));
      }
      throw new Error('后台任务等待超时，请重新打开数据管理查看。');
    }finally{polling=false;}
  }

  async function executeChallengeAutomatically(challenge,preview){
    let remaining=Math.max(0,Math.ceil((new Date(challenge.notBefore).getTime()-Date.now())/1000));
    while(remaining>0){
      setPreview(preview,`<div class="purge-success">安全备份已完成并通过完整性校验。</div><div class="purge-warning">安全倒计时 ${remaining} 秒后自动清空业务数据，无需再次点击。</div>`);
      await sleep(1000);
      remaining-=1;
    }
    setPreview(preview,progressHtml({progress:1,message:'正在提交后台安全清空任务',elapsedMs:0},'EXECUTE'));
    const submitted=await submitBackground('EXECUTE','/api/admin/data-purge/execute',{challengeId:challenge.challengeId,phrase:'永久清除全部业务数据',backupConfirmed:true},preview);
    if(submitted?.async&&submitted?.pollUrl){
      setPreview(preview,progressHtml(submitted,'EXECUTE'));
      return pollJob(submitted.pollUrl,preview,'EXECUTE');
    }
    return submitted;
  }

  global.openDataPurge=async function v130OpenDataPurge(){
    if(accessSession.user?.role!=='ADMIN'||flowActive)return;
    if(!window.confirm('确定要清空全部业务数据吗？系统会先创建并校验完整备份，用户、权限、配置、白名单、备份和审计不会删除。'))return;
    flowActive=true;
    const dialog=document.getElementById('dataPurgeDialog');
    const preview=document.getElementById('purgePreview');
    document.getElementById('purgeStepOne').hidden=false;
    document.getElementById('purgeStepTwo').hidden=true;
    dialog.hidden=false;
    purgeChallenge=null;
    setPreview(preview,progressHtml({progress:1,message:'正在提交后台安全备份任务',elapsedMs:0},'PREPARE'));
    try{
      const prepared=await submitBackground('PREPARE','/api/admin/data-purge/prepare',{},preview);
      const challenge=prepared?.async&&prepared?.pollUrl?await pollJob(prepared.pollUrl,preview,'PREPARE'):prepared;
      if(!challenge?.challengeId)throw new Error('清空前备份完成，但未取得有效清空凭证。');
      purgeChallenge=challenge;
      const result=await executeChallengeAutomatically(challenge,preview);
      await applyCompletedPurge(result);
    }catch(error){
      purgeChallenge=null;
      const message=abortLike(error)?'后台任务响应延迟，系统正在恢复状态。请勿重复点击清空。':(error.message||String(error));
      setPreview(preview,`<div class="purge-error">无法完成一键清空：${escapeHtml(message)}</div>`);
    }finally{flowActive=false;}
  };

  global.executeDataPurge=async function v130ExecuteDataPurge(){
    if(!purgeChallenge?.challengeId||flowActive)return;
    flowActive=true;
    const preview=document.getElementById('purgePreview');
    try{
      const result=await executeChallengeAutomatically(purgeChallenge,preview);
      await applyCompletedPurge(result);
    }catch(error){
      const message=abortLike(error)?'后台任务响应延迟，系统正在恢复状态。请勿重复点击清空。':(error.message||String(error));
      setPreview(preview,`<div class="purge-error">清空失败：${escapeHtml(message)}</div>`);
    }finally{flowActive=false;}
  };

  global.__CE_QC_V105_ASYNC_PURGE_UI__={version:VERSION,isPolling:()=>polling,isFlowActive:()=>flowActive,pollDelay,recoverRecentJob};
  console.info('[CE-QC][V130_PURGE_UI]',VERSION);
})(window);
