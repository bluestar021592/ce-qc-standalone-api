(function installAsyncPurgeUiV105(global){
  if(global.__CE_QC_V105_ASYNC_PURGE_UI__)return;
  const VERSION='2026-08-14-v105-async-purge-ui-v2';
  let polling=false;

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const elapsedText=ms=>`${Math.max(0,Math.floor(Number(ms||0)/1000))} 秒`;

  function showPreparing(preview,status={}){
    const progress=Math.max(0,Math.min(100,Number(status.progress||0)));
    preview.innerHTML=`<div class="purge-warning"><strong>安全备份正在后台执行</strong><br>${escapeHtml(status.message||'正在准备 SQLite 在线安全备份')}<br><span>已用 ${escapeHtml(elapsedText(status.elapsedMs))} · ${progress}%</span><div style="height:8px;margin-top:10px;border-radius:8px;background:#eef3f8;overflow:hidden"><i style="display:block;height:100%;width:${progress}%;background:#1677ff;transition:width .25s ease"></i></div><small style="display:block;margin-top:8px;color:#6b7f96">页面不会被备份任务锁死；任务完成后会自动进入下一步。</small></div>`;
  }

  function showReady(preview,challenge){
    const total=Object.values(challenge.counts||{}).reduce((sum,value)=>sum+Number(value||0),0);
    preview.innerHTML=`<div class="purge-success">备份和完整性校验已完成，可以继续清空。</div><dl><dt>数据库</dt><dd>${escapeHtml(challenge.databasePath||'')}</dd><dt>业务记录总行数</dt><dd>${formatInt(total)}</dd><dt>安全备份</dt><dd>${escapeHtml(challenge.backup?.path||challenge.backup?.filePath||'')}</dd><dt>备份大小</dt><dd>${formatInt(challenge.backup?.size||0)} 字节</dd><dt>完整性</dt><dd>${escapeHtml(challenge.backup?.integrity||'')}</dd><dt>将被删除</dt><dd>${(challenge.deleteScope||[]).map(escapeHtml).join('、')}</dd><dt>将被保留</dt><dd>${(challenge.retainedScope||[]).map(escapeHtml).join('、')}</dd></dl>`;
    const admin=document.getElementById('purgeAdmin');
    if(admin)admin.textContent=challenge.administrator||'';
  }

  async function pollJob(pollUrl,preview){
    polling=true;
    try{
      for(let attempt=0;attempt<2400;attempt+=1){
        if(document.getElementById('dataPurgeDialog')?.hidden) await sleep(750);
        const status=await api(pollUrl,{cache:'no-store'});
        if(status.status==='COMPLETED')return status.result;
        if(status.status==='FAILED')throw new Error(status.error||status.message||'清空前安全备份失败');
        showPreparing(preview,status);
        await sleep(750);
      }
      throw new Error('清空前备份任务等待超时，请重新打开数据管理后查看。');
    }finally{polling=false;}
  }

  global.openDataPurge=async function v105OpenDataPurge(){
    if(accessSession.user?.role!=='ADMIN'||polling)return;
    if(!window.confirm('确定要清空全部业务数据吗？系统会先创建并校验完整备份，用户、权限、配置、白名单、备份和审计不会删除。'))return;
    const dialog=document.getElementById('dataPurgeDialog');
    const preview=document.getElementById('purgePreview');
    document.getElementById('purgeStepOne').hidden=false;
    document.getElementById('purgeStepTwo').hidden=true;
    dialog.hidden=false;
    purgeChallenge=null;
    showPreparing(preview,{progress:1,message:'正在提交后台安全备份任务',elapsedMs:0});
    try{
      const prepared=await api('/api/admin/data-purge/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const challenge=prepared?.async&&prepared?.pollUrl
        ? await pollJob(prepared.pollUrl,preview)
        : prepared;
      if(!challenge?.challengeId)throw new Error('清空前备份完成，但未取得有效清空凭证。');
      purgeChallenge=challenge;
      showReady(preview,challenge);
      document.getElementById('purgeStepOne').hidden=false;
      document.getElementById('purgeStepTwo').hidden=true;
    }catch(error){
      purgeChallenge=null;
      preview.innerHTML=`<div class="purge-error">无法开始清空：${escapeHtml(error.message||String(error))}</div>`;
    }
  };

  global.__CE_QC_V105_ASYNC_PURGE_UI__={version:VERSION,isPolling:()=>polling};
  console.info('[CE-QC][V105_ASYNC_PURGE_UI]',VERSION);
})(window);
