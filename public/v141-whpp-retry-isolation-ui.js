(function installV141WhppRetryIsolationUi(global){
  if(global.__CE_QC_V141_WHPP_RETRY_ISOLATION_UI__)return;
  global.__CE_QC_V141_WHPP_RETRY_ISOLATION_UI__=true;
  const VERSION='2026-08-16-v143-whpp-retry-layout-ui-v1';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  let retryBusy=false;

  function visible(){return location.pathname==='/import'||document.getElementById('importPage')?.classList?.contains('active')||document.getElementById('importPage')?.hidden===false;}
  function statusNode(){return document.getElementById('ccslRunStatus');}
  function installLayout(){
    if(document.getElementById('v143ImportWorkspaceStyle'))return;
    const style=document.createElement('style');style.id='v143ImportWorkspaceStyle';style.textContent=`
      #importPage .operations-dashboard{
        display:grid!important;
        grid-template-columns:minmax(420px,.88fr) minmax(560px,1.12fr)!important;
        grid-template-areas:"import summary" "run run" "carry carry"!important;
        gap:14px!important;align-items:start!important;
      }
      #importPage #unifiedImport{grid-area:import!important;align-self:start!important;margin:0!important;}
      #importPage .unified-summary-panel{grid-area:summary!important;min-height:0!important;height:auto!important;align-self:start!important;margin:0!important;}
      #importPage #runPanel{grid-area:run!important;width:100%!important;margin:0!important;}
      #importPage #v139CarryManualPanel{grid-area:carry!important;width:100%!important;margin:0!important;}
      #importPage .unified-summary-panel #unifiedClassificationSummary{min-height:0!important;height:auto!important;}
      #importPage .unified-summary-panel .unified-count-grid{grid-template-columns:repeat(4,minmax(120px,1fr))!important;gap:10px!important;}
      #importPage .unified-summary-panel .empty-state,#importPage .unified-summary-panel .empty-state.compact{min-height:120px!important;padding:22px 18px!important;}
      #importPage #v139CarryManualPanel .unified-count-grid{grid-template-columns:repeat(4,minmax(150px,1fr))!important;gap:10px!important;}
      #importPage #v139CarryManualPanel .preview-table-wrap{max-height:260px!important;overflow:auto!important;}
      #importPage #v142HistoryAudit{margin-top:14px!important;}
      #v143WhppRetryStrip{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px;padding:12px 14px;border:1px solid #d8e5f5;border-radius:10px;background:#f7faff;}
      #v143WhppRetryStrip .v143-title{font-weight:700;color:#173b68;}
      #v143WhppRetryStrip .v143-meta{color:#58708e;}
      #v143WhppRetryStrip .v143-actions{margin-left:auto;display:flex;gap:8px;align-items:center;}
      @media(max-width:1280px){
        #importPage .operations-dashboard{grid-template-columns:1fr!important;grid-template-areas:"import" "summary" "run" "carry"!important;}
        #importPage .unified-summary-panel .unified-count-grid,#importPage #v139CarryManualPanel .unified-count-grid{grid-template-columns:repeat(2,minmax(140px,1fr))!important;}
        #v143WhppRetryStrip .v143-actions{margin-left:0;}
      }
    `;document.head.appendChild(style);
  }
  function runPanel(){return document.getElementById('runPanel')||statusNode()?.closest('section,article,.panel');}
  function retryStrip(){
    installLayout();const panel=runPanel();if(!panel)return null;let strip=document.getElementById('v143WhppRetryStrip');if(strip)return strip;
    strip=document.createElement('div');strip.id='v143WhppRetryStrip';strip.innerHTML='<span class="v143-title">WHPP接口待重试</span><span class="v143-meta">正在读取…</span><div class="v143-actions"><button id="v143WhppRetryBtn" class="btn primary compact" type="button">独立重试下一批200票</button></div>';
    panel.appendChild(strip);strip.querySelector('#v143WhppRetryBtn')?.addEventListener('click',runRetry);return strip;
  }
  function renderPartial(retry){
    const count=Math.max(0,Number(retry||0));if(!count)return;const node=statusNode();
    if(node)node.innerHTML=`<span class="status-pill warning">WHPP尚未完全结束</span><p>当前快照已保存 · <b>${fmt(count)}票</b>接口待重试，断点已保留。</p><p class="muted">这些失败票现在使用下方“WHPP接口待重试”独立队列处理，不需要重新跑整份日报，也不会阻塞后续日期上传。</p>`;
  }
  async function queue(){
    if(!visible())return;const strip=retryStrip();if(!strip)return;const meta=strip.querySelector('.v143-meta');const btn=strip.querySelector('#v143WhppRetryBtn');
    try{const r=await fetch('/api/v143/whpp-retry-queue?limit=200',{cache:'no-store',credentials:'same-origin'});const p=await r.json();if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);const total=Number(p.summary?.total||0);const dates=(p.summary?.byDate||[]).map(x=>`${esc(x.reportDate)} ${fmt(x.count)}票`).join(' · ');meta.innerHTML=total?`待重试 <b>${fmt(total)}</b> 票${dates?` · ${dates}`:''}。只处理失败票，成功票不会重查。`:'<span style="color:#15965a;font-weight:700">待重试 0票</span>';if(btn){btn.disabled=retryBusy||total===0;btn.textContent=total?`独立重试下一批${Math.min(200,total)}票`:'WHPP待重试已清零';}}
    catch(error){meta.innerHTML=`<span style="color:#c23a3a">读取失败：${esc(error.message)}</span>`;if(btn)btn.disabled=true;}
  }
  async function runRetry(){
    if(retryBusy)return;const strip=retryStrip();if(!strip)return;retryBusy=true;const btn=strip.querySelector('#v143WhppRetryBtn');const meta=strip.querySelector('.v143-meta');if(btn){btn.disabled=true;btn.textContent='正在独立重试…';}meta.innerHTML='<span style="color:#a66a00">正在按25→10→5→1缩小批次补偿，失败请求至少重试3轮…</span>';
    try{const r=await fetch('/api/v143/whpp-retry-queue/recheck',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:200}),credentials:'same-origin'});const p=await r.json();if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);meta.innerHTML=`本批处理 <b>${fmt(p.processed)}</b> · 恢复有效结果 <b>${fmt(p.recovered)}</b> · 本批闭环 <b>${fmt(p.closed)}</b> · 仍待重试 <b>${fmt(p.stillRetry)}</b>`;await queue();global.__CE_QC_V142_HISTORY_AUDIT__?.refresh?.();}
    catch(error){meta.innerHTML=`<span style="color:#c23a3a">本批重试失败：${esc(error.message)}</span>`;}
    finally{retryBusy=false;await queue();}
  }
  async function reconcile(){
    if(!visible())return;installLayout();retryStrip();await queue();
    try{const response=await fetch('/api/v132/whpp-fast-summary',{cache:'no-store',credentials:'same-origin'});if(!response.ok)return;const value=await response.json();const retry=Number(value?.metrics?.retryPending||0);if(value?.completed&&retry>0)renderPartial(retry);}catch{}
  }
  document.addEventListener('ce-qc-run-complete',event=>{const retry=Number(event?.detail?.whppRetryPending||0);if(retry>0)setTimeout(()=>renderPartial(retry),0);setTimeout(reconcile,180);});
  document.addEventListener('click',event=>{if(event.target?.closest?.('[data-page="import"],.side-link[data-path="/import"]'))setTimeout(reconcile,150);},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(reconcile,180),{once:true});else setTimeout(reconcile,180);
  global.__CE_QC_V141_WHPP_RETRY_ISOLATION_UI__={version:VERSION,refresh:reconcile,retry:runRetry};
  console.info('[CE-QC][V143_WHPP_RETRY_LAYOUT_UI]',VERSION);
})(window);
