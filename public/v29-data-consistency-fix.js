(function loadCeQcRuntimePatches() {
  if (new URLSearchParams(location.search).has('visualTest')) return;

  function loadScript(src, onload) {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    if (onload) script.onload = onload;
    document.head.appendChild(script);
  }

  function renderSevenBusinessClassification(){
    const target=document.getElementById('unifiedClassificationSummary');
    if(!target)return;
    let imported=null;
    try{imported=typeof unifiedImportState!=='undefined'?unifiedImportState:null;}catch{}
    const counts=imported?.classificationCounts||{};
    const summary=imported?.summary||{};
    if(!Object.keys(counts).length)return;
    const types=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
    const classified=types.reduce((sum,type)=>sum+Number(counts[type]||0),0);
    const valid=Number(summary.validUniqueWaybills||imported?.sourceReconciliation?.validUniqueWaybills||0);
    const difference=classified-valid;
    const balanced=difference===0;
    const signature=`${valid}|${types.map(type=>Number(counts[type]||0)).join('|')}`;
    if(target.dataset.sevenBusinessSignature===signature)return;
    target.dataset.sevenBusinessSignature=signature;
    const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const fmt=value=>Number(value||0).toLocaleString('zh-CN');
    target.innerHTML=`<div class="unified-count-grid"><div><span>有效唯一单号</span><b data-testid="classification-valid-unique">${fmt(valid)}</b></div>${types.map(type=>`<div><span>${esc(type)}</span><b data-testid="classification-${type.toLowerCase()}">${fmt(counts[type]||0)}</b></div>`).join('')}<div><span>七板块合计</span><b>${fmt(classified)}</b></div></div><div class="unified-warning-grid"><span>原始行 <b>${fmt(summary.rawRows||0)}</b></span><span>重复 <b data-testid="classification-duplicates">${fmt(summary.duplicateRows||0)}</b></span><span>无单号 <b data-testid="classification-missing-waybill">${fmt(summary.missingWaybillRows||0)}</b></span><span>收件人缺失 <b data-testid="classification-missing-recipient">${fmt(summary.missingRecipientWarnings||0)}</b></span><span>分类冲突 <b data-testid="classification-conflicts">${fmt(summary.classificationConflicts||0)}</b></span><span class="status-pill ${balanced?'ok':'danger'}">分类守恒 ${balanced?'通过':`失败 ${difference>0?'+':''}${difference}`}</span></div>`;
  }

  if(typeof renderUnifiedImportResult==='function'){
    const originalRenderUnifiedImportResult=renderUnifiedImportResult;
    renderUnifiedImportResult=function vManualRefreshSevenBusinessSummary(...args){
      const result=originalRenderUnifiedImportResult.apply(this,args);
      renderSevenBusinessClassification();
      return result;
    };
    queueMicrotask(renderSevenBusinessClassification);
  }

  loadScript('/v29-data-consistency-core.js?v=20260809-v29-core-1', function () {
    loadScript('/v33-live-run-progress.js?v=20260809-v33-1');
  });
})();