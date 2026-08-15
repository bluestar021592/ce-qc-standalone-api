(function installUnifiedImportFastPathV153(global){
  if(global.__CE_QC_V150_IMPORT_FAST_PATH__)return;
  const VERSION='2026-08-15-v153-nonblocking-upload-queue-v4';
  let busy=false,catalogTimer=null;

  const el=id=>document.getElementById(id);
  const html=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  function setBusy(value){busy=Boolean(value);const button=document.querySelector('[data-testid="combined-daily-import"]');if(button){button.disabled=busy;button.textContent=busy?'正在接收日报…':'导入综合日报并自动分类';}const file=el('excelFile');if(file)file.disabled=busy;}
  function setStatus(text,kind='muted'){const target=el('fileStatus');if(!target)return;const cls=kind==='success'?'success':kind==='danger'?'danger':'muted';target.innerHTML=`<div class="import-fast-status ${cls}">${text}</div>`;}
  async function readJson(response){const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{}if(!response.ok||payload?.ok===false){const error=new Error(payload?.error||payload?.message||`上传失败（HTTP ${response.status}）`);error.status=response.status;error.payload=payload;throw error;}return payload;}
  function bindState(result){if(result?.queued)return;try{unifiedImportState=result;}catch{global.unifiedImportState=result;}try{if(result.state)appState=result.state;}catch{}try{if(result.shopeeState)shopeeState=result.shopeeState;}catch{}try{historyModeDate=result.reportDate||historyModeDate;}catch{}try{reportDateManualCorrection=false;reportDateOverrideSource='';}catch{}const date=el('reportDate');if(date&&result.reportDate){date.value=result.reportDate;date.readOnly=true;}const source=el('dateDetectionSource');if(source)source.textContent=result.dateDetectionSource||'日报自动识别';try{if(typeof renderUnifiedImportResult==='function')renderUnifiedImportResult();}catch(error){console.warn('[CE-QC][V153_IMPORT] result render skipped',error);}}
  function successText(result){const c=result.classificationCounts||{},s=result.summary||{};return `<b>${html(result.reportDate||'')} 已保存，可以继续上传下一份。</b><br>`+`有效 ${fmt(s.validUniqueWaybills)}票 · CE ${fmt(c.CE)} · CEAF ${fmt(c.CEAF)} · TBKH ${fmt(c.TBKH)} · ALI1688 ${fmt(c.ALI1688)} · SHOPEE CN ${fmt(c.SHOPEECN)} · SHOPEE VN ${fmt(c.SHOPEEVN)} · WHPP ${fmt(c.WHPP)}`;}
  function queuedText(result,fileName,dateText){return `<b>${html(fileName)} 已接收，已进入后台导入队列。</b><br>`+`${dateText?`日期 ${html(dateText)} · `:''}任务 ${html(result.jobId||'')} · 你现在可以直接继续上传下一份日报。`;}
  function refreshCatalogLater(){clearTimeout(catalogTimer);catalogTimer=setTimeout(async()=>{try{const response=await fetch('/api/unified-history',{cache:'no-store',credentials:'same-origin'});const data=await readJson(response);try{historyCatalog.UNIFIED=data.rows||historyCatalog.UNIFIED||[];}catch{}try{if(typeof renderHistoryOptions==='function')renderHistoryOptions();}catch{}}catch(error){console.warn('[CE-QC][V153_IMPORT] deferred history refresh skipped',error);}},8000);}
  async function importUnifiedExcelFast(){
    if(busy)return;
    const input=el('excelFile'),file=input?.files?.[0];
    if(!file){setStatus('请选择综合日报Excel。','danger');return;}
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    if(!['xls','xlsx'].includes(ext)){setStatus('综合日报只支持 .xls 或 .xlsx。','danger');return;}
    if(file.size>80*1024*1024){setStatus('文件超过80MB，已超过当前单文件安全上限，请拆分日报后再导入。','danger');return;}
    const date=el('reportDate'),dateText=String(date?.value||'').trim();
    setBusy(true);setStatus(`正在接收 ${html(file.name)}…`);
    const body=new FormData();body.append('file',file);if(date&&!date.readOnly&&date.value)body.append('reportDate',date.value);
    try{
      const response=await fetch('/api/import/unified-daily-report',{method:'POST',body,cache:'no-store',credentials:'same-origin'});
      const result=await readJson(response);
      if(result.queued){setStatus(queuedText(result,file.name,dateText),'success');if(input)input.value='';refreshCatalogLater();global.dispatchEvent(new CustomEvent('ce-qc-unified-import-queued',{detail:{jobId:result.jobId,fileName:file.name,date:dateText}}));return result;}
      bindState(result);setStatus(successText(result),'success');if(input)input.value='';refreshCatalogLater();global.dispatchEvent(new CustomEvent('ce-qc-unified-import-saved',{detail:{reportDate:result.reportDate,total:Number(result.summary?.validUniqueWaybills||0)}}));return result;
    }catch(error){const diagnostics=Array.isArray(error?.payload?.sheetDiagnostics)?error.payload.sheetDiagnostics:[];const detail=diagnostics.length?`<br>${diagnostics.slice(0,5).map(row=>`${html(row.sheetName)}：${html(row.reason||row.status||'识别失败')}`).join('<br>')}`:'';setStatus(`<b>导入失败：${html(error?.message||error)}</b>${detail}`,'danger');return null;}
    finally{setBusy(false);}
  }
  global.importUnifiedExcel=importUnifiedExcelFast;
  global.__CE_QC_V150_IMPORT_FAST_PATH__={version:VERSION,import:importUnifiedExcelFast,policy:'DURABLE_WORKER_QUEUE_NONBLOCKING'};
  console.info('[CE-QC][V153_IMPORT_QUEUE_UI]',VERSION);
})(window);
