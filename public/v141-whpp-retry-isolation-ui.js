(function installV141WhppRetryIsolationUi(global){
  if(global.__CE_QC_V141_WHPP_RETRY_ISOLATION_UI__)return;
  global.__CE_QC_V141_WHPP_RETRY_ISOLATION_UI__=true;
  const VERSION='2026-08-16-v143-whpp-retry-layout-ui-v2';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  let pollTimer=null;
  let lastQueue=null;

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
      #v143WhppRetryStrip .v143-meta{color:#58708e;flex:1 1 600px;line-height:1.7;}
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
  function renderPartial(dayRetry,historyRetry){
    const day=Math.max(0,Number(dayRetry||0));const history=Math.max(0,Number(historyRetry||0));if(!day&&!history)return;const node=statusNode();
    if(node)node.innerHTML=`<span class="status-pill warning">WHPP尚未完全结束</span><p>8/11当日待重试 <b>${fmt(day)}</b> 票 · 历史WHPP待重试总量 <b>${fmt(history)}</b> 票。</p><p class="muted">这些失败票使用下方独立队列处理，不需要重新跑整份日报，也不会阻塞后续日期上传。</p>`;
  }
  function schedulePoll(){clearTimeout(pollTimer);pollTimer=setTimeout(()=>queue({poll:true}),1200);}
  async function queue({poll=false}={}){
    if(!visible())return null;const strip=retryStrip();if(!strip)return null;const meta=strip.querySelector('.v143-meta');const btn=strip.querySelector('#v143WhppRetryBtn');
    try{
      const r=await fetch('/api/v143/whpp-retry-queue?limit=200',{cache:'no-store',credentials:'same-origin'});const p=await r.json();if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);lastQueue=p;
      const total=Number(p.summary?.total||0);const dates=(p.summary?.byDate||[]).map(x=>`${esc(x.reportDate)} ${fmt(x.count)}票`).join(' · ');const job=p.job||{};
      if(job.running){
        const resolved=Math.max(0,Number(job.resolved||0));const jobTotal=Math.max(0,Number(job.total||0));
        meta.innerHTML=`<b style="color:#a66a00">后台重试处理中</b> · ${esc(job.phase||'处理中')} · 进度 <b>${fmt(resolved)}/${fmt(jobTotal)}</b> · 当前历史待重试 <b>${fmt(total)}</b> 票${dates?`<br><span class="muted">${dates}</span>`:''}`;
        if(btn){btn.disabled=true;btn.textContent='后台重试处理中…';}
        schedulePoll();
      }else if(job.error){
        meta.innerHTML=`<b style="color:#c23a3a">上一次重试失败：</b>${esc(job.error)}<br><span class="muted">失败票仍保留在SQLite，可再次重试；当前待重试 ${fmt(total)} 票。</span>`;
        if(btn){btn.disabled=total===0;btn.textContent=total?`重新尝试下一批${Math.min(200,total)}票`:'WHPP待重试已清零';}
      }else if(job.completedAt&&job.id){
        meta.innerHTML=`上一本批处理 <b>${fmt(job.total)}</b> · 恢复有效结果 <b>${fmt(job.recovered)}</b> · 本批闭环 <b>${fmt(job.closed)}</b> · 本批仍待重试 <b>${fmt(job.stillRetry)}</b> · 当前历史队列 <b>${fmt(total)}</b> 票${dates?`<br><span class="muted">${dates}</span>`:''}`;
        if(btn){btn.disabled=total===0;btn.textContent=total?`独立重试下一批${Math.min(200,total)}票`:'WHPP待重试已清零';}
      }else{
        meta.innerHTML=total?`待重试 <b>${fmt(total)}</b> 票${dates?` · ${dates}`:''}。只处理失败票，成功票不会重查。`:'<span style="color:#15965a;font-weight:700">待重试 0票</span>';
        if(btn){btn.disabled=total===0;btn.textContent=total?`独立重试下一批${Math.min(200,total)}票`:'WHPP待重试已清零';}
      }
      return p;
    }catch(error){
      meta.innerHTML=`<span style="color:#c23a3a">WHPP待重试队列读取失败：${esc(error.message)}</span>`;if(btn)btn.disabled=true;if(poll)schedulePoll();return null;
    }
  }
  async function runRetry(){
    const strip=retryStrip();if(!strip)return;const btn=strip.querySelector('#v143WhppRetryBtn');const meta=strip.querySelector('.v143-meta');if(btn){btn.disabled=true;btn.textContent='正在启动后台重试…';}meta.innerHTML='<span style="color:#a66a00">正在启动WHPP后台独立重试任务…</span>';
    try{
      const r=await fetch('/api/v143/whpp-retry-queue/recheck',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:200}),credentials:'same-origin'});const p=await r.json();if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);
      meta.innerHTML='<span style="color:#a66a00">后台任务已启动，正在读取实时进度…</span>';await queue({poll:true});
    }catch(error){
      meta.innerHTML=`<span style="color:#c23a3a">无法启动WHPP独立重试：${esc(error.message)}</span><br><span class="muted">失败票没有被删除。</span>`;if(btn){btn.disabled=false;btn.textContent='重新尝试启动';}
    }
  }
  async function reconcile(){
    if(!visible())return;installLayout();retryStrip();const q=await queue();
    try{const response=await fetch('/api/v132/whpp-fast-summary',{cache:'no-store',credentials:'same-origin'});if(!response.ok)return;const value=await response.json();const dayRetry=Number(value?.metrics?.retryPending||0);const historyRetry=Number(q?.summary?.total||0);if((value?.completed&&dayRetry>0)||historyRetry>0)renderPartial(dayRetry,historyRetry);}catch{}
  }
  document.addEventListener('ce-qc-run-complete',()=>setTimeout(reconcile,180));
  document.addEventListener('click',event=>{if(event.target?.closest?.('[data-page="import"],.side-link[data-path="/import"]'))setTimeout(reconcile,150);},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(reconcile,180),{once:true});else setTimeout(reconcile,180);
  global.__CE_QC_V141_WHPP_RETRY_ISOLATION_UI__={version:VERSION,refresh:reconcile,retry:runRetry};
  console.info('[CE-QC][V143_WHPP_RETRY_LAYOUT_UI]',VERSION);
})(window);
