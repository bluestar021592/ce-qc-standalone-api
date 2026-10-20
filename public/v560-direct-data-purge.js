(function installV560DirectDataPurge(global){
  const PATCH_ID='2026-09-21-v568-direct-no-backup-space-reclaim-ui-v1';
  const PHRASE='永久清除全部业务数据';
  const RETURN_TO='/purge-console.html';
  let openedAt=0;
  let active=false;
  let timer=null;
  let cp72PreflightReady=false;
  let requiresReconciliation=false;
  const node=id=>document.getElementById(id);
  const escapeText=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  async function requestJson(url,options={},timeoutMs=15_000){
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

  function isAuthExpired(error){
    return Number(error?.status||0)===401
      || String(error?.code||'')==='INTERNAL_AUTH_REQUIRED'
      || error?.payload?.reloginRequired===true;
  }
  function loginUrl(){
    return '/?returnTo='+encodeURIComponent(RETURN_TO);
  }
  function renderLoginRequired(){
    const preview=node('directPurgePreview');
    if(preview)preview.innerHTML='<div class="purge-error"><b>管理员登录已失效，正在跳转重新登录。</b><br><small>登录成功后会自动返回直接清空页面；不会自动执行清空。</small></div>';
  }
  function redirectToLogin(){
    renderLoginRequired();
    setTimeout(()=>global.location.replace(loginUrl()),80);
  }
  async function ensureAdminSession(){
    try{
      const session=await requestJson('/api/session',{},6000);
      if(String(session?.user?.role||'').toUpperCase()!=='ADMIN'){
        const error=new Error('当前账号不是 ADMIN，不能执行直接清空。');
        error.code='DIRECT_PURGE_ADMIN_REQUIRED';
        throw error;
      }
      return session;
    }catch(error){
      if(isAuthExpired(error)){redirectToLogin();return null;}
      throw error;
    }
  }

  function elapsedSeconds(){return Math.max(0,Math.floor((Date.now()-openedAt)/1000));}
  function updateDirectPurgeButton(){
    const button=node('directPurgeExecuteButton');
    const phrase=node('directPurgePhrase');
    const countdown=node('directPurgeCountdown');
    const remain=Math.max(0,5-elapsedSeconds());
    if(countdown)countdown.textContent=remain>0?`请等待 ${remain} 秒`:'已完成安全倒计时，可最终确认清空';
    if(button)button.disabled=active||requiresReconciliation||!cp72PreflightReady||remain>0||String(phrase?.value||'')!==PHRASE;
  }
  function startClock(){
    clearInterval(timer);
    timer=setInterval(updateDirectPurgeButton,250);
    updateDirectPurgeButton();
  }
  function stopClock(){clearInterval(timer);timer=null;}

  async function openDirectDataPurge(){
    if(active)return;
    if(requiresReconciliation)return alert('上一笔直接清空请求的结果需要只读核对，本页面禁止再次提交。请先核对后台业务表与任务状态。');
    cp72PreflightReady=false;
    const session=await ensureAdminSession();
    if(!session)return;
    let preflight;
    try{
      preflight=await requestJson('/api/admin/data-purge/direct/preflight',{},10000);
    }catch(error){
      if(isAuthExpired(error)){redirectToLogin();return;}
      alert('72个门店编码的只读预检暂不可用，清空已安全停止。未删除任何数据。');
      return;
    }
    cp72PreflightReady=preflight.cp72Ready===true&&Number(preflight.activeCpCount)===72
      &&preflight.dataStorageReady===true&&preflight.safeToStartClear===true;
    if(preflight.alreadyClearedNoFreshBusiness===true)
      return alert('检测到上一笔清空已提交，当前业务表仍为空。禁止重复清空；请先重新启动APP并按流程上传新的日报。');
    if(!cp72PreflightReady)
      return alert('清空已被阻止：72个有效CP门店码不完整、主数据盘不可用或安全预检未通过。没有删除任何数据。');
    const installed=preflight.version||{};
    if(installed.installedOnLocalMain!==true||installed.cachedMainMatchesInstalled!==true
      ||installed.formalUpdateVerified!==true
      ||installed.installedThroughManagedUpdaterVerified!==true)
      return alert('清空已被阻止：没有正式托管更新器的安装凭据；候选版、旧版或手工切换main都不能清空。');
    if(!global.confirm('本机安装提交 '+String(installed.installedCommit||'').slice(0,12)+
      ' 已与本地 main 记录一致；此检查不代表已联网确认最新版。打开清空向导？已有备份保留，只有最终确认后才删除业务数据。'))return;
    openedAt=Date.now();
    const dialog=node('directPurgeDialog');if(dialog)dialog.hidden=false;
    const phrase=node('directPurgePhrase');if(phrase)phrase.value='';
    const preview=node('directPurgePreview');
    if(preview)preview.innerHTML='<div class="purge-warning"><b>72个有效CP门店编码已通过只读预检。</b><br><small>不会新建备份；现有备份会保留。清空仅删除业务表及可再生成业务文件，历史证据归档会清理。用户、权限、72个有效CP配置与审计保留；后台还会在事务中再次核验CP配置。</small></div>';
    startClock();
  }
  function closeDirectDataPurge(){
    if(active)return alert('直接清空事务正在执行，当前不能关闭为“已取消”。请等待结果。');
    stopClock();
    const dialog=node('directPurgeDialog');if(dialog)dialog.hidden=true;
  }
  const STAGE_LABELS={
    QUEUED:'任务已提交',
    STARTING_WORKER:'独立后台线程已启动',
    RETIRING_LEGACY:'正在结束旧的备份/清空状态',
    WAITING_DB_LOCK:'正在取得数据库写锁',
    DELETE_TABLES:'正在清空业务表',
    VERIFYING:'正在校验清空结果',
    COMMITTING:'正在提交清空事务',
    COMMITTED:'清空事务已提交',
    RECLAIMING_SPACE:'正在释放数据库磁盘空间',
    FILE_CLEANUP:'正在清理可再生成业务文件（已有备份保留）',
    SUCCEEDED:'清空完成',
    FAILED:'清空失败'
  };

  function renderJobStatus(job,started){
    const preview=node('directPurgePreview');
    if(!preview)return;
    const stage=String(job?.stage||job?.status||'RUNNING').toUpperCase();
    const label=STAGE_LABELS[stage]||String(job?.message||'正在后台清空业务数据');
    const completed=Number(job?.completedTables||0);
    const total=Number(job?.totalTables||0);
    const deleted=Number(job?.deletedRows||0);
    const elapsed=Math.max(0,Math.floor((Date.now()-started)/1000));
    const progress=total>0?`<br><span>业务表进度：<b>${completed}/${total}</b></span>`:'';
    const deletedLine=deleted>0?`<br><span>已删除记录：<b>${deleted.toLocaleString()}</b> 行</span>`:'';
    preview.innerHTML=`<div class="purge-warning"><b>${escapeText(label)}</b>${progress}${deletedLine}<br><small>已等待 ${elapsed} 秒。清空在独立后台线程执行，页面和5177不会再被SQLite同步删除卡死。</small></div>`;
  }

  async function waitForDirectPurge(job,started){
    const jobId=String(job?.jobId||'');
    if(!jobId)throw new Error('后台没有返回清空任务编号。');
    let failures=0;
    for(;;){
      try{
        const status=await requestJson(`/api/admin/data-purge/direct/status?jobId=${encodeURIComponent(jobId)}`,{},12_000);
        failures=0;
        renderJobStatus(status,started);
        const state=String(status.status||'').toUpperCase();
        if(state==='SUCCEEDED')return status;
        if(state==='FAILED'){
          const error=new Error(status.error||status.message||'直接清空失败。');
          error.code=String(status.code||'DIRECT_PURGE_FAILED');
          // Terminal worker failure is authoritative; do not retry a FAILED job
          // just because the backend uses a non-DIRECT_PURGE error code.
          error.terminalPurgeJobFailure=true;
          throw error;
        }
      }catch(error){
        if(error?.terminalPurgeJobFailure===true
          || String(error?.code||'')==='DIRECT_PURGE_FAILED'
          || String(error?.code||'').startsWith('DIRECT_PURGE_WORKER')
          || (Number(error?.status||0)>=400&&Number(error?.status||0)<500))throw error;
        failures+=1;
        if(failures>=20)throw error;
      }
      await new Promise(resolve=>setTimeout(resolve,750));
    }
  }
  async function executeDirectDataPurge(){
    if(active)return;
    const session=await ensureAdminSession();
    if(!session)return;
    updateDirectPurgeButton();
    const button=node('directPurgeExecuteButton');
    if(button?.disabled)return alert('请准确输入“永久清除全部业务数据”，并等待5秒倒计时结束。');
    if(!global.confirm('最终确认：永久清空全部业务数据及可再生成业务文件。不会新建备份，已有备份会保留；72个CP门店编码、用户、权限、配置和审计也会保留。是否继续？'))return;
    active=true;stopClock();
    if(button)button.disabled=true;
    const phrase=node('directPurgePhrase');if(phrase)phrase.disabled=true;
    const preview=node('directPurgePreview');
    const started=Date.now();
    if(preview)preview.innerHTML='<div class="purge-warning"><b>正在提交独立后台清空任务…</b><br><span>不会创建备份，也不会等待安全封锁。</span><br><small>5177主线程将保持响应。</small></div>';
    try{
      const queued=await requestJson('/api/admin/data-purge/direct',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phrase:PHRASE})
      },15_000);
      renderJobStatus(queued,started);
      const result=await waitForDirectPurge(queued,started);
      const deleted=Number(result.deletedRows||0);
      if(preview)preview.innerHTML=`<div class="purge-success"><b>全部业务数据已直接清空。</b><br>共删除 <b>${deleted.toLocaleString()}</b> 行业务记录。<br><small>本次未新建备份，原有备份已保留；用户、权限、72个CP配置及审计已保留。请先通过原来的系统快捷方式完整关闭并重新打开 APP，重新登录后再上传日报，以便自动轨迹追踪读取新启动标记。</small></div>`;
    }catch(error){
      active=false;
      // The request may have reached the worker even if its final response is
      // unavailable. Freeze this destructive wizard until an independent read-only
      // reconciliation; NEVER silently re-enable its submit button.
      requiresReconciliation=true;
      cp72PreflightReady=false;
      if(button)button.disabled=true;
      if(phrase)phrase.disabled=true;
      if(isAuthExpired(error)){redirectToLogin();return;}
      if(preview)preview.innerHTML=`<div class="purge-error"><b>清空结果尚不能确认为成功或未执行，已禁止重复提交。</b><br>${escapeText(error.message||error)}<br><small>先只读核对后台任务状态、业务表及72个门店编码，再决定后续操作。请勿再次清空或上传新日报。</small></div>`;
      return;
    }
    active=false;
  }

  global.openDirectDataPurge=openDirectDataPurge;
  global.closeDirectDataPurge=closeDirectDataPurge;
  global.executeDirectDataPurge=executeDirectDataPurge;
  global.updateDirectPurgeButton=updateDirectPurgeButton;
  global.__CE_QC_V560_DIRECT_PURGE__={patchId:PATCH_ID,getStatus:()=>({active,openedAt,requiresReconciliation})};
  Promise.resolve().then(()=>ensureAdminSession()).catch(error=>{
    const preview=node('directPurgePreview');
    if(preview)preview.innerHTML=`<div class="purge-error"><b>管理员身份检查失败。</b><br>${escapeText(error?.message||error)}</div>`;
  });
  console.info('[CE-QC][V560_DIRECT_PURGE]',PATCH_ID);
})(window);
