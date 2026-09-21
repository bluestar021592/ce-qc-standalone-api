(function installV560DirectDataPurge(global){
  const PATCH_ID='2026-09-20-v561-direct-no-backup-async-ui-v1';
  const PHRASE='永久清除全部业务数据';
  const RETURN_TO='/purge-console.html';
  let openedAt=0;
  let active=false;
  let timer=null;
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
    const session=await ensureAdminSession();
    if(!session)return;
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
  const STAGE_LABELS={
    QUEUED:'任务已提交',
    STARTING_WORKER:'独立后台线程已启动',
    RETIRING_LEGACY:'正在结束旧的备份/清空状态',
    WAITING_DB_LOCK:'正在取得数据库写锁',
    DELETE_TABLES:'正在清空业务表',
    VERIFYING:'正在校验清空结果',
    COMMITTING:'正在提交清空事务',
    COMMITTED:'清空事务已提交',
    FILE_CLEANUP:'正在清理临时文件',
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
          throw error;
        }
      }catch(error){
        if(String(error?.code||'')==='DIRECT_PURGE_FAILED'||String(error?.code||'').startsWith('DIRECT_PURGE_WORKER'))throw error;
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
    if(!global.confirm('最终确认：现在将直接永久清空全部业务数据。不会创建新备份。用户、权限、配置、白名单、已有备份和审计会保留。是否继续？'))return;
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
      if(preview)preview.innerHTML=`<div class="purge-success"><b>全部业务数据已直接清空。</b><br>共删除 <b>${deleted.toLocaleString()}</b> 行业务记录。<br><small>未创建新备份；用户、权限、配置、白名单、已有备份和审计已保留。现在可以重新上传新的日报数据。</small></div>`;
    }catch(error){
      active=false;
      if(isAuthExpired(error)){redirectToLogin();return;}
      if(phrase)phrase.disabled=false;
      if(preview)preview.innerHTML=`<div class="purge-error"><b>直接清空未完成。</b><br>${escapeText(error.message||error)}<br><small>未显示成功前不要重复点击；把此错误直接发给开发处理即可。</small></div>`;
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
  Promise.resolve().then(()=>ensureAdminSession()).catch(error=>{
    const preview=node('directPurgePreview');
    if(preview)preview.innerHTML=`<div class="purge-error"><b>管理员身份检查失败。</b><br>${escapeText(error?.message||error)}</div>`;
  });
  console.info('[CE-QC][V560_DIRECT_PURGE]',PATCH_ID);
})(window);
