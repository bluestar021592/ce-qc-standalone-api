(function installV505DataPurgeRecovery(global){
  if(global.__CE_QC_V505_DATA_PURGE_RECOVERY__)return;
  const PATCH_ID='2026-09-10-v505-async-purge-prepare-ui-v4';
  let active=false;
  let elapsedTimer=null;
  let startedAt=0;
  let lastStatus='';
  let currentJob=null;

  const escapeText=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const previewNode=()=>document.getElementById('purgePreview');

  async function requestJson(url,options={}){
    let response;
    try{response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});}
    catch(error){const wrapped=new Error(error?.message||'后台连接中断');wrapped.code='PURGE_TRANSPORT_INTERRUPTED';throw wrapped;}
    const raw=await response.text();
    let data={};try{data=raw?JSON.parse(raw):{};}catch{}
    if(!response.ok||data.ok===false){const error=new Error(data.error||data.message||`HTTP ${response.status}`);error.status=response.status;error.payload=data;throw error;}
    return data;
  }

  function elapsedText(){
    const seconds=Math.max(0,Math.floor((Date.now()-startedAt)/1000));
    const minutes=Math.floor(seconds/60);const remain=seconds%60;
    return minutes?`${minutes}分${String(remain).padStart(2,'0')}秒`:`${seconds}秒`;
  }

  function renderWorking(message='后台已接收任务，正在创建并校验清空前安全备份'){
    const node=previewNode();if(!node)return;
    lastStatus=message;
    node.innerHTML=`<div class="purge-warning"><b>${escapeText(message)}</b><br><span>后台任务独立执行 · 已等待 <b id="v505PurgeElapsed">${escapeText(elapsedText())}</b></span><br><small>浏览器不会再用一个长连接等待25GB级备份；页面会读取真实后台状态，期间请勿重复点击。</small></div>`;
  }
  function startElapsedClock(){clearInterval(elapsedTimer);elapsedTimer=setInterval(()=>{const node=document.getElementById('v505PurgeElapsed');if(node)node.textContent=elapsedText();},1000);}
  function stopElapsedClock(){clearInterval(elapsedTimer);elapsedTimer=null;}

  async function submitPrepare(){
    return requestJson('/api/admin/data-purge/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  }

  async function pollBackgroundJob(job){
    const statusUrl=String(job.statusUrl||'');
    if(!statusUrl)throw new Error('后台任务没有返回状态地址，已安全停止。');
    const deadline=Date.now()+40*60_000;
    while(Date.now()<deadline){
      let status;
      try{status=await requestJson(`${statusUrl}?t=${Date.now()}`,{credentials:'same-origin'});}
      catch(error){
        renderWorking('状态通道短暂不可用，后台备份仍在继续，正在重新连接');
        await wait(2000);continue;
      }
      if(String(status.jobId||'')!==String(job.jobId||''))throw new Error('后台任务编号不一致，已安全停止。');
      const state=String(status.status||'').toUpperCase();
      const now=Date.now();
      const heartbeatAt=Number(status.heartbeatAt||0);
      const submittedAt=Number(status.submittedAt||0);
      if(state==='RUNNING'&&heartbeatAt>0&&now-heartbeatAt>20_000)throw new Error('后台安全备份任务超过20秒没有心跳，已停止前端等待；没有执行删除。');
      if(state==='QUEUED'&&submittedAt>0&&now-submittedAt>30_000)throw new Error('后台安全备份任务排队超过30秒仍未启动，已停止前端等待；没有执行删除。');
      if(state==='SUCCEEDED')return status;
      if(state==='FAILED')throw new Error(status.error||'清空前安全备份失败。');
      renderWorking(state==='QUEUED'?'后台任务已排队，准备锁定数据库并开始安全备份':'正在后台备份并校验数据库完整性');
      await wait(2000);
    }
    throw new Error('清空前安全备份超过40分钟仍未完成，已停止前端等待；系统不会自动删除业务数据。');
  }

  async function recoverVerifiedChallenge(job){
    const result=await requestJson('/api/admin/data-purge/prepare',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recoverJobId:job.jobId})
    });
    if(String(result.status||'').toUpperCase()!=='SUCCEEDED'||!result.challengeId)throw new Error('安全备份完成，但最终清空凭证尚未就绪。');
    return result;
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
    if(stepOne)stepOne.hidden=false;if(stepTwo)stepTwo.hidden=true;if(dialog)dialog.hidden=false;
    active=true;startedAt=Date.now();currentJob=null;renderWorking();startElapsedClock();

    try{
      let submitted=await submitPrepare();
      if(String(submitted.status||'').toUpperCase()==='SUCCEEDED'&&submitted.challengeId){
        currentJob=submitted;
      }else{
        currentJob=submitted;
        await pollBackgroundJob(submitted);
        renderWorking('安全备份已完成，正在读取最终校验凭证');
        submitted=await recoverVerifiedChallenge(submitted);
        currentJob=submitted;
      }

      const challenge=submitted;
      const node=previewNode();
      if(node){
        node.innerHTML=`<div class="purge-success"><b>安全备份与完整性校验已完成。</b></div><dl><dt>数据库</dt><dd>${escapeText(challenge.databasePath||'')}</dd><dt>安全备份</dt><dd>${escapeText(challenge.backup?.path||'')}</dd><dt>备份大小</dt><dd>${Number(challenge.backup?.size||0).toLocaleString()} 字节</dd><dt>完整性</dt><dd>${escapeText(challenge.backup?.integrity||'')}</dd></dl>`;
      }
      const waitMs=Math.max(0,new Date(challenge.notBefore).getTime()-Date.now());
      if(waitMs>0){node?.insertAdjacentHTML('beforeend',`<div class="purge-warning">安全倒计时 ${Math.ceil(waitMs/1000)} 秒后自动清空。</div>`);await wait(waitMs+100);}
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
      if(node)node.innerHTML=`<div class="purge-error"><b>清空未执行。</b><br>${escapeText(error.message||error)}<br><small>安全机制已停止删除动作；关闭窗口后可重新开始。</small></div>`;
    }finally{active=false;}
  }

  function claimPurgeOwner(){global.openDataPurge=v505OpenDataPurge;try{openDataPurge=v505OpenDataPurge;}catch{}}
  claimPurgeOwner();setTimeout(claimPurgeOwner,1200);setTimeout(claimPurgeOwner,3500);
  global.__CE_QC_V505_DATA_PURGE_RECOVERY__={patchId:PATCH_ID,openDataPurge:v505OpenDataPurge,getStatus:()=>({active,lastStatus,startedAt,currentJob})};
  console.info('[CE-QC][V505_DATA_PURGE_RECOVERY]',PATCH_ID);
})(window);
