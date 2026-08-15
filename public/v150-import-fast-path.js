(function installUnifiedImportFastPathV155(global){
  if(global.__CE_QC_V150_IMPORT_FAST_PATH__)return;
  const VERSION='2026-08-15-v155-classification-first-local-spool-v6';
  let busy=false,catalogTimer=null,queuePollTimer=null,latestJobId='';
  const jobs=new Map();

  const el=id=>document.getElementById(id);
  const html=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  function setBusy(value){busy=Boolean(value);const button=document.querySelector('[data-testid="combined-daily-import"]');if(button){button.disabled=busy;button.textContent=busy?'正在上传日报…':'导入综合日报并自动分类';}const file=el('excelFile');if(file)file.disabled=busy;}
  function setStatus(text,kind='muted'){const target=el('fileStatus');if(!target)return;const cls=kind==='success'?'success':kind==='danger'?'danger':'muted';target.innerHTML=`<div class="import-fast-status ${cls}">${text}</div>`;}
  async function readJson(response){const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{}if(!response.ok||payload?.ok===false){const error=new Error(payload?.error||payload?.message||`上传失败（HTTP ${response.status}）`);error.status=response.status;error.payload=payload;throw error;}return payload;}
  function bindState(result){if(!result||result?.queued)return;try{unifiedImportState=result;}catch{global.unifiedImportState=result;}try{if(result.state)appState=result.state;}catch{}try{if(result.shopeeState)shopeeState=result.shopeeState;}catch{}try{historyModeDate=result.reportDate||historyModeDate;}catch{}try{reportDateManualCorrection=false;reportDateOverrideSource='';}catch{}const date=el('reportDate');if(date&&result.reportDate){date.value=result.reportDate;date.readOnly=true;}const source=el('dateDetectionSource');if(source)source.textContent=result.dateDetectionSource||'日报自动识别';try{if(typeof renderUnifiedImportResult==='function')renderUnifiedImportResult();}catch(error){console.warn('[CE-QC][V155_IMPORT] result render skipped',error);}}
  function classificationLine(result){const c=result?.classificationCounts||{},s=result?.summary||{};return `有效 ${fmt(s.validUniqueWaybills)}票 · CE ${fmt(c.CE)} · CEAF ${fmt(c.CEAF)} · TBKH ${fmt(c.TBKH)} · ALI1688 ${fmt(c.ALI1688)} · SHOPEE CN ${fmt(c.SHOPEECN)} · SHOPEE VN ${fmt(c.SHOPEEVN)} · WHPP ${fmt(c.WHPP)}`;}
  function classifiedText(result,fileName=''){return `<b>${html(result?.reportDate||'')} 识别完成，已自动分类。</b><br>${classificationLine(result)}<br><span>${html(fileName||'日报')} 已进入后台安全入库，你现在可以直接继续上传下一份。</span>`;}
  function successText(result){return `<b>${html(result.reportDate||'')} 自动分类及入库完成。</b><br>${classificationLine(result)}`;}
  function queuedText(result,fileName,dateText){return `<b>${html(fileName)} 已收到，正在自动识别并分类…</b><br>${dateText?`日期 ${html(dateText)} · `:''}任务 ${html(result.jobId||'')} · 页面已释放，可以继续选择下一份日报。`;}
  function refreshCatalogLater(){clearTimeout(catalogTimer);catalogTimer=setTimeout(async()=>{try{const response=await fetch('/api/unified-history',{cache:'no-store',credentials:'same-origin'});const data=await readJson(response);try{historyCatalog.UNIFIED=data.rows||historyCatalog.UNIFIED||[];}catch{}try{if(typeof renderHistoryOptions==='function')renderHistoryOptions();}catch{}}catch(error){console.warn('[CE-QC][V155_IMPORT] deferred history refresh skipped',error);}},5000);}
  function queuePanel(){let target=el('importQueueStatus');if(target)return target;const anchor=el('fileStatus');if(!anchor)return null;target=document.createElement('div');target.id='importQueueStatus';target.style.marginTop='8px';anchor.insertAdjacentElement('afterend',target);return target;}
  function phaseText(phase){return ({QUEUED:'等待自动识别',STARTING:'准备识别',PARSING:'正在识别Excel',VALIDATING:'正在校验分类',CLASSIFIED:'识别完成，已自动分类',PERSISTING:'后台安全入库',WAITING_SQLITE:'数据库繁忙，后台自动重试',PROCESSING:'处理中',COMPLETED:'已完成',FAILED:'失败',RECOVERED_AFTER_RESTART:'重启后自动恢复'})[String(phase||'').toUpperCase()]||String(phase||'处理中');}
  function renderJobs(){const target=queuePanel();if(!target)return;const rows=[...jobs.values()].slice(-8).reverse();if(!rows.length){target.innerHTML='';return;}target.innerHTML=`<div style="border:1px solid #dbe7f5;border-radius:8px;padding:8px 10px;background:#f8fbff"><div style="font-weight:700;margin-bottom:6px">日报自动识别队列</div>${rows.map(item=>{const job=item.job||{},status=String(job.status||item.status||'QUEUED').toUpperCase(),phase=phaseText(job.phase||status),done=status==='COMPLETED',failed=status==='FAILED',result=job.result||{},preview=job.preview||{},count=Number(result.summary?.validUniqueWaybills||preview.summary?.validUniqueWaybills||job.total||0),date=result.reportDate||preview.reportDate||job.reportDate||item.dateText||'',error=job.error?.message||'';const icon=done?'✅':failed?'❌':job.preview?'✔':'⏳';const detail=done?`${date?`${html(date)} · `:''}${count?`${fmt(count)}票 · `:''}自动分类及入库完成`:failed?html(error||'后台导入失败'):job.preview?`${date?`${html(date)} · `:''}${count?`${fmt(count)}票 · `:''}已自动分类，后台入库中`:html(phase);return `<div style="padding:5px 0;border-top:1px solid #edf2f7">${icon} <b>${html(item.fileName||job.originalName||'日报')}</b> · ${detail}</div>`;}).join('')}</div>`;}
  function scheduleQueuePoll(delay=500){clearTimeout(queuePollTimer);queuePollTimer=setTimeout(pollQueueJobs,delay);}
  async function pollQueueJobs(){let hasActive=false;for(const [jobId,item] of jobs){const current=String(item.job?.status||item.status||'QUEUED').toUpperCase();if(['COMPLETED','FAILED'].includes(current))continue;hasActive=true;try{const response=await fetch(`/api/import/unified-queue/${encodeURIComponent(jobId)}?_=${Date.now()}`,{cache:'no-store',credentials:'same-origin'});const data=await readJson(response);item.job=data.job||{};item.status=item.job.status||item.status;
        if(item.job.preview&&!item.previewBound){item.previewBound=true;bindState(item.job.preview);if(jobId===latestJobId)setStatus(classifiedText(item.job.preview,item.fileName),'success');global.dispatchEvent(new CustomEvent('ce-qc-unified-import-classified',{detail:{jobId,reportDate:item.job.preview.reportDate||'',classificationCounts:item.job.preview.classificationCounts||{}}}));}
        if(String(item.job.status||'').toUpperCase()==='COMPLETED'&&!item.completedBound){item.completedBound=true;if(item.job.result)bindState(item.job.result);if(jobId===latestJobId)setStatus(successText(item.job.result||item.job.preview||{}),'success');refreshCatalogLater();global.dispatchEvent(new CustomEvent('ce-qc-unified-import-saved',{detail:{reportDate:item.job.result?.reportDate||item.job.reportDate||'',total:Number(item.job.result?.summary?.validUniqueWaybills||item.job.total||0),jobId}}));}
        if(String(item.job.status||'').toUpperCase()==='FAILED'&&jobId===latestJobId)setStatus(`<b>日报识别/导入失败：${html(item.job.error?.message||'未知错误')}</b>`,'danger');
        jobs.set(jobId,item);
      }catch(error){item.lastPollError=error?.message||String(error);jobs.set(jobId,item);}}
    renderJobs();if(hasActive&&[...jobs.values()].some(item=>!['COMPLETED','FAILED'].includes(String(item.job?.status||item.status||'').toUpperCase())))scheduleQueuePoll(700);}
  function rememberJob(result,fileName,dateText){if(!result?.jobId)return;latestJobId=result.jobId;jobs.set(result.jobId,{jobId:result.jobId,fileName,dateText,status:result.status||'QUEUED',job:{status:result.status||'QUEUED',phase:'QUEUED',originalName:fileName,reportDate:dateText},previewBound:false,completedBound:false});renderJobs();scheduleQueuePoll(250);}

  async function importUnifiedExcelFast(){
    if(busy)return;
    const input=el('excelFile'),file=input?.files?.[0];
    if(!file){setStatus('请选择综合日报Excel。','danger');return;}
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    if(!['xls','xlsx'].includes(ext)){setStatus('综合日报只支持 .xls 或 .xlsx。','danger');return;}
    if(file.size>80*1024*1024){setStatus('文件超过80MB，已超过当前单文件安全上限，请拆分日报后再导入。','danger');return;}
    const date=el('reportDate'),dateText=String(date?.value||'').trim();
    setBusy(true);setStatus(`正在上传 ${html(file.name)}… 上传完成后会立即自动识别分类。`);
    const body=new FormData();body.append('file',file);if(date?.value)body.append('reportDate',date.value);
    try{
      const response=await fetch('/api/import/unified-daily-report',{method:'POST',body,cache:'no-store',credentials:'same-origin'});
      const result=await readJson(response);
      if(result.queued){setStatus(queuedText(result,file.name,dateText),'success');rememberJob(result,file.name,dateText);if(input)input.value='';global.dispatchEvent(new CustomEvent('ce-qc-unified-import-queued',{detail:{jobId:result.jobId,fileName:file.name,date:dateText}}));return result;}
      bindState(result);setStatus(successText(result),'success');if(input)input.value='';refreshCatalogLater();global.dispatchEvent(new CustomEvent('ce-qc-unified-import-saved',{detail:{reportDate:result.reportDate,total:Number(result.summary?.validUniqueWaybills||0)}}));return result;
    }catch(error){const diagnostics=Array.isArray(error?.payload?.sheetDiagnostics)?error.payload.sheetDiagnostics:[];const detail=diagnostics.length?`<br>${diagnostics.slice(0,5).map(row=>`${html(row.sheetName)}：${html(row.reason||row.status||'识别失败')}`).join('<br>')}`:'';setStatus(`<b>导入失败：${html(error?.message||error)}</b>${detail}`,'danger');return null;}
    finally{setBusy(false);}
  }
  global.importUnifiedExcel=importUnifiedExcelFast;
  global.__CE_QC_V150_IMPORT_FAST_PATH__={version:VERSION,import:importUnifiedExcelFast,policy:'LOCAL_FAST_SPOOL_CLASSIFY_FIRST_BACKGROUND_PERSIST_V155'};
  console.info('[CE-QC][V155_IMPORT_CLASSIFICATION_FIRST]',VERSION);
})(window);
