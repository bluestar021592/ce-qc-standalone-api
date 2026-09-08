(function installV473AllExportSidecarUi(global){
  if(global.__CE_QC_V473_EXPORT_UI__)return;
  const VERSION='2026-09-08-v473-all-export-sidecar-ui-v2';
  const SIDECAR_VERSION='2026-09-08-v473-all-business-isolated-export-sidecar-v1';
  const ACTIVE_JOB_KEY='ce_qc_active_export_job_v473';
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let pollEpoch=0;

  function sidecarOrigin(){return location.protocol==='http:'?`http://${location.hostname}:5178`:'';}
  function requestCredentials(url){try{return new URL(url,location.origin).origin===location.origin?'same-origin':'include';}catch{return 'include';}}
  async function json(url,init={},timeoutMs=8000,label='接口'){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);timer.unref?.();
    try{
      const response=await global.fetch(url,{cache:'no-store',credentials:requestCredentials(url),signal:controller.signal,...init});
      const raw=await response.text();let payload={};try{payload=raw?JSON.parse(raw):{};}catch{}
      if(!response.ok||payload?.ok===false){const error=new Error(payload?.error||payload?.message||(raw&&!/^\s*</.test(raw)?raw.slice(0,240):`HTTP ${response.status}`));error.status=response.status;error.code=payload?.code||`HTTP_${response.status}`;throw error;}
      return payload;
    }catch(error){if(error?.name==='AbortError')throw Object.assign(new Error(`${label}${Math.round(timeoutMs/1000)}秒内未响应`),{code:'V473_TIMEOUT'});throw error;}
    finally{clearTimeout(timer);}
  }
  function targets(){return {progress:document.getElementById('exportProgressV194')||document.getElementById('exportProgressV193')||document.getElementById('exportProgressV192')||document.getElementById('exportProgress'),files:document.getElementById('exportGeneratedFilesV194')||document.getElementById('exportGeneratedFilesV193')||document.getElementById('exportGeneratedFilesV192')||document.getElementById('exportGeneratedFiles')};}
  function payload(){const active=document.querySelector('.period-tab.active')?.dataset?.period||'daily';return {periodType:String(active||'daily'),date:document.getElementById('periodExportDate')?.value||'',fromDate:document.getElementById('periodExportFrom')?.value||'',toDate:document.getElementById('periodExportTo')?.value||'',businessType:document.getElementById('periodExportBusiness')?.value||'ALL'};}
  function valid(p,progress){if(p.periodType==='custom'){if(!p.fromDate||!p.toDate){progress.textContent='请选择开始日期和结束日期';return false;}if(p.fromDate>p.toDate){progress.textContent='开始日期不能晚于结束日期';return false;}}else if(!p.date){progress.textContent='请选择基准日期';return false;}return true;}
  function escapeHtml(value=''){return String(value).replace(/[&<>]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]));}
  function escapeAttr(value=''){return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  function renderFiles(target,files=[]){target.innerHTML=files.map(file=>`<a class="export-file-item" href="${escapeAttr(file.url||'')}"><span>${escapeHtml(file.name||'')}</span><b>${/\.zip$/i.test(String(file.name||''))?'下载全部完整报表':'下载完整表'}</b></a>`).join('');}
  function saveActive(jobId,pollUrl,p){try{localStorage.setItem(ACTIVE_JOB_KEY,JSON.stringify({jobId,pollUrl,payload:p,version:VERSION,savedAt:new Date().toISOString()}));}catch{}}
  function loadActive(){try{const v=JSON.parse(localStorage.getItem(ACTIVE_JOB_KEY)||'null');return v?.version===VERSION&&v?.jobId?v:null;}catch{return null;}}
  function clearActive(){try{localStorage.removeItem(ACTIVE_JOB_KEY);}catch{}}
  async function waitForJob(jobId,pollUrl,progress,files){const epoch=++pollEpoch;let lastGood=Date.now();let errors=0;while(epoch===pollEpoch){try{const job=await json(pollUrl,{},15000,'V473导出状态接口');errors=0;lastGood=Date.now();const status=String(job.status||'').toUpperCase();const pct=Math.max(0,Math.min(100,Number(job.progress||0)));progress.textContent=`[V473独立导出] Job ${jobId} · ${job.message||'后台生成中'} · ${pct}%${job.historyPreflight?` · 安全检查:${job.historyPreflight}`:''}`;if(status==='COMPLETED'){const ready=(Array.isArray(job.files)?job.files:[]).filter(x=>x?.url&&x?.name);if(!ready.length){const error=new Error('后台任务已完成，但没有返回可下载文件');error.jobTerminal=true;throw error;}renderFiles(files,ready);clearActive();progress.textContent=`[V473独立导出] Job ${jobId} · 生成完成：共 ${ready.length} 个完整文件，可直接下载`;return;}if(['FAILED','CANCELLED'].includes(status)){clearActive();const error=new Error(job.message||job.error||'后台导出失败');error.code=job.errorCode||status;error.jobTerminal=true;throw error;}}catch(error){if(error?.jobTerminal||['FAILED','CANCELLED','SEVEN_BUSINESS_HISTORY_INCOMPLETE','SEVEN_BUSINESS_PREFLIGHT_FAILED'].includes(String(error.code||'').toUpperCase())||[401,403,404].includes(Number(error.status||0)))throw error;errors+=1;const seconds=Math.max(1,Math.floor((Date.now()-lastGood)/1000));progress.textContent=`[V473独立导出] Job ${jobId} · 独立状态连接暂时中断 ${seconds} 秒，任务仍保留；正在恢复（第 ${errors} 次）…`;}
      await sleep(errors?5000:2500);
    }}
  async function startExport(button){const {progress,files}=targets();if(!progress||!files)return;const p=payload();if(!valid(p,progress))return;pollEpoch+=1;files.innerHTML='';const old=button?.textContent||'';if(button){button.disabled=true;button.textContent='后台生成中…';}try{const base=sidecarOrigin();if(!base)throw new Error('当前页面不是本地HTTP环境，无法连接V473独立导出服务。');progress.textContent='[V473独立导出] 正在连接5178独立导出服务；不会占用主看板5177…';const ping=await json(`${base}/api/v473/export-ping`,{},3500,'V473独立导出服务');if(String(ping.version||'')!==SIDECAR_VERSION)throw new Error(`V473独立导出服务版本不一致：${ping.version||'未知版本'}`);const start=await json(`${base}/api/v473/export-period/prepare`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)},5000,'V473导出创建接口');const jobId=String(start.jobId||'').trim();if(!jobId)throw new Error('独立导出服务没有返回任务编号');let pollUrl=String(start.pollUrl||'').trim();if(pollUrl.startsWith('/'))pollUrl=`${base}${pollUrl}`;if(!pollUrl)throw new Error('独立导出服务没有返回状态地址');saveActive(jobId,pollUrl,p);progress.textContent=`[V473独立导出] Job ${jobId} · ${start.message||'任务已创建'} · 0% · 5178独立进程`;await waitForJob(jobId,pollUrl,progress,files);}catch(error){progress.textContent=`[V473独立导出] 导出失败：${error?.message||String(error)}`;}finally{if(button){button.disabled=false;button.textContent=old||'一键导出全部报表';}}}
  function claim(){const button=document.querySelector('[data-testid="export-all-reports"]');if(!button||button.dataset.ceQcV473Owner==='1')return button;const clone=button.cloneNode(true);clone.removeAttribute('onclick');clone.dataset.ceQcExportOwner='v193';clone.dataset.ceQcV473Owner='1';button.replaceWith(clone);clone.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();void startExport(clone);},true);return clone;}
  async function resume(){const active=loadActive();if(!active)return;const {progress,files}=targets();if(!progress||!files)return;progress.textContent=`[V473独立导出] 检测到任务 ${active.jobId}，正在恢复5178状态通道…`;try{await waitForJob(active.jobId,active.pollUrl,progress,files);}catch(error){if(Number(error.status||0)===404)clearActive();progress.textContent=`[V473独立导出] 恢复任务失败：${error?.message||String(error)}`;}}
  function exportCompat(){const button=claim();return startExport(button);}

  claim();document.addEventListener('click',event=>{if(event.target?.closest?.('[data-page="reports"],.side-link'))setTimeout(()=>claim(),0);},true);setTimeout(()=>{claim();void resume();},120);
  global.exportPeriodReport=exportCompat;
  global.exportPeriodReportV194=exportCompat;
  global.exportPeriodReportV473=exportCompat;
  global.resumeActiveExportJob=resume;
  global.__CE_QC_V473_EXPORT_UI__={version:VERSION,sidecarVersion:SIDECAR_VERSION,sidecarOrigin,claim,startExport,resume};
  console.info('[CE-QC][V473_EXPORT_UI]',VERSION);
})(window);
