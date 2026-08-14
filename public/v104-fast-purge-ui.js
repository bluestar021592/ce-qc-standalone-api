(function installAsyncPurgeUiV105(global){
  if(global.__CE_QC_V105_ASYNC_PURGE_UI__)return;
  const VERSION='2026-08-14-v123-adaptive-purge-ui-v1';
  let polling=false;

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const elapsedText=ms=>`${Math.max(0,Math.floor(Number(ms||0)/1000))} 秒`;

  function progressHtml(status={},mode='PREPARE'){
    const progress=Math.max(0,Math.min(100,Number(status.progress||0)));
    const title=mode==='EXECUTE'?'正在后台安全清空业务数据':'安全备份正在后台执行';
    return `<div class="purge-warning"><strong>${title}</strong><br>${escapeHtml(status.message||'正在处理')}<br><span>已用 ${escapeHtml(elapsedText(status.elapsedMs))} · ${progress}%</span><div style="height:8px;margin-top:10px;border-radius:8px;background:#eef3f8;overflow:hidden"><i style="display:block;height:100%;width:${progress}%;background:#1677ff;transition:width .25s ease"></i></div><small style="display:block;margin-top:8px;color:#6b7f96">任务在后台执行，网页不会被锁死；完成后自动进入下一步。</small></div>`;
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

  async function pollJob(pollUrl,preview,mode='PREPARE'){
    polling=true;
    let lastSignature='';
    let unchangedCycles=0;
    let networkErrors=0;
    let lastRenderedSecond=-1;
    try{
      for(let attempt=0;attempt<2400;attempt+=1){
        try{
          const status=await api(pollUrl,{cache:'no-store'});
          networkErrors=0;
          if(status.status==='COMPLETED')return status.result;
          if(status.status==='FAILED')throw new Error(status.error||status.message||'后台任务失败');
          const signature=`${status.status}|${status.progress}|${status.message||''}`;
          if(signature===lastSignature)unchangedCycles+=1;
          else{lastSignature=signature;unchangedCycles=0;}
          const elapsedSecond=Math.floor(Number(status.elapsedMs||0)/1000);
          if(signature!==lastSignature||lastRenderedSecond<0||elapsedSecond-lastRenderedSecond>=3||unchangedCycles===0){
            setPreview(preview,progressHtml(status,mode));
            lastRenderedSecond=elapsedSecond;
          }
        }catch(error){
          networkErrors+=1;
          if(error?.status===401||networkErrors>=8)throw error;
          setPreview(preview,`<div class="purge-warning"><strong>后台任务仍在运行</strong><br>页面连接正在恢复（${networkErrors}/8）…</div>`);
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
    const submitted=await api('/api/admin/data-purge/execute',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({challengeId:challenge.challengeId,phrase:'永久清除全部业务数据',backupConfirmed:true})
    });
    return submitted?.async&&submitted?.pollUrl?pollJob(submitted.pollUrl,preview,'EXECUTE'):submitted;
  }

  global.openDataPurge=async function v123OpenDataPurge(){
    if(accessSession.user?.role!=='ADMIN'||polling)return;
    if(!window.confirm('确定要清空全部业务数据吗？系统会先创建并校验完整备份，用户、权限、配置、白名单、备份和审计不会删除。'))return;
    const dialog=document.getElementById('dataPurgeDialog');
    const preview=document.getElementById('purgePreview');
    document.getElementById('purgeStepOne').hidden=false;
    document.getElementById('purgeStepTwo').hidden=true;
    dialog.hidden=false;
    purgeChallenge=null;
    setPreview(preview,progressHtml({progress:1,message:'正在提交后台安全备份任务',elapsedMs:0},'PREPARE'));
    try{
      const prepared=await api('/api/admin/data-purge/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const challenge=prepared?.async&&prepared?.pollUrl?await pollJob(prepared.pollUrl,preview,'PREPARE'):prepared;
      if(!challenge?.challengeId)throw new Error('清空前备份完成，但未取得有效清空凭证。');
      purgeChallenge=challenge;
      const result=await executeChallengeAutomatically(challenge,preview);
      await applyCompletedPurge(result);
    }catch(error){
      purgeChallenge=null;
      setPreview(preview,`<div class="purge-error">无法完成一键清空：${escapeHtml(error.message||String(error))}</div>`);
    }
  };

  // Keep the legacy final-confirm function usable if an old cached dialog happens
  // to expose it, but the normal V123 flow above no longer needs a second click.
  global.executeDataPurge=async function v123ExecuteDataPurge(){
    if(!purgeChallenge?.challengeId||polling)return;
    const preview=document.getElementById('purgePreview');
    try{
      const result=await executeChallengeAutomatically(purgeChallenge,preview);
      await applyCompletedPurge(result);
    }catch(error){
      setPreview(preview,`<div class="purge-error">清空失败：${escapeHtml(error.message||String(error))}</div>`);
    }
  };

  global.__CE_QC_V105_ASYNC_PURGE_UI__={version:VERSION,isPolling:()=>polling,pollDelay};
  console.info('[CE-QC][V123_ADAPTIVE_PURGE_UI]',VERSION);
})(window);
