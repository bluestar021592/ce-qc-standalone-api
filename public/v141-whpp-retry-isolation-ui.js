(function installV141WhppRetryIsolationUi(global){
  if(global.__CE_QC_V141_WHPP_RETRY_ISOLATION_UI__)return;
  global.__CE_QC_V141_WHPP_RETRY_ISOLATION_UI__=true;
  const VERSION='2026-08-16-v144-whpp-retry-workspace-auth-v1';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  let pollTimer=null;

  function visible(){return location.pathname==='/import'||document.getElementById('importPage')?.classList?.contains('active')||document.getElementById('importPage')?.hidden===false;}
  function statusNode(){return document.getElementById('ccslRunStatus');}
  function summaryPanel(){return document.querySelector('#importPage .unified-summary-panel');}
  function authLike(message=''){return /未授权|unauthorized|重新登录CE|需要重新登录CE|token|登录.*过期|授权.*失效/i.test(String(message||''));}

  function installLayout(){
    if(document.getElementById('v144ImportWorkspaceStyle'))return;
    document.getElementById('v143ImportWorkspaceStyle')?.remove();
    const style=document.createElement('style');style.id='v144ImportWorkspaceStyle';style.textContent=`
      #importPage .operations-dashboard{
        display:grid!important;
        grid-template-columns:minmax(420px,.88fr) minmax(560px,1.12fr)!important;
        grid-template-areas:"import summary" "run run" "carry carry"!important;
        gap:14px!important;align-items:start!important;
      }
      #importPage #unifiedImport{grid-area:import!important;align-self:start!important;margin:0!important;}
      #importPage .unified-summary-panel{
        grid-area:summary!important;align-self:stretch!important;height:100%!important;min-height:0!important;margin:0!important;
        display:flex!important;flex-direction:column!important;overflow:hidden!important;
      }
      #importPage #runPanel{grid-area:run!important;width:100%!important;margin:0!important;}
      #importPage #v139CarryManualPanel{grid-area:carry!important;width:100%!important;margin:0!important;}
      #importPage .unified-summary-panel #unifiedClassificationSummary{min-height:0!important;height:auto!important;flex:0 0 auto!important;}
      #importPage .unified-summary-panel .unified-count-grid{grid-template-columns:repeat(4,minmax(120px,1fr))!important;gap:10px!important;}
      #importPage .unified-summary-panel .empty-state,#importPage .unified-summary-panel .empty-state.compact{min-height:120px!important;padding:22px 18px!important;}
      #importPage #v139CarryManualPanel .unified-count-grid{grid-template-columns:repeat(4,minmax(150px,1fr))!important;gap:10px!important;}
      #importPage #v139CarryManualPanel .preview-table-wrap{max-height:260px!important;overflow:auto!important;}
      #importPage #v142HistoryAudit{margin-top:14px!important;}
      #v143WhppRetryStrip{
        flex:1 1 auto!important;min-height:138px!important;margin:12px 14px 14px!important;padding:14px 16px!important;
        border:1px solid #d8e5f5;border-radius:10px;background:#f7faff;display:grid;grid-template-columns:minmax(0,1fr) auto;
        grid-template-areas:"title actions" "meta meta" "auth auth";gap:8px 14px;align-content:start;
      }
      #v143WhppRetryStrip .v143-title{grid-area:title;font-weight:800;color:#173b68;font-size:15px;}
      #v143WhppRetryStrip .v143-meta{grid-area:meta;color:#58708e;line-height:1.7;min-width:0;overflow-wrap:anywhere;}
      #v143WhppRetryStrip .v143-actions{grid-area:actions;display:flex;gap:8px;align-items:start;justify-content:flex-end;}
      #v143WhppRetryStrip .v144-auth{grid-area:auth;margin-top:4px;padding:12px;border:1px solid #f0c8c8;border-radius:8px;background:#fff8f8;}
      #v143WhppRetryStrip .v144-auth-title{font-weight:800;color:#b53232;margin-bottom:8px;}
      #v143WhppRetryStrip .v144-auth-grid{display:grid;grid-template-columns:120px minmax(160px,1fr) minmax(180px,1fr) auto;gap:8px;align-items:center;}
      #v143WhppRetryStrip .v144-auth-grid input{height:36px;border:1px solid #cdd9e8;border-radius:6px;padding:0 10px;background:#fff;color:#17375d;min-width:0;}
      #v143WhppRetryStrip .v144-auth-note{margin-top:7px;color:#7c5a5a;font-size:11px;}
      @media(max-width:1280px){
        #importPage .operations-dashboard{grid-template-columns:1fr!important;grid-template-areas:"import" "summary" "run" "carry"!important;}
        #importPage .unified-summary-panel{height:auto!important;}
        #importPage .unified-summary-panel .unified-count-grid,#importPage #v139CarryManualPanel .unified-count-grid{grid-template-columns:repeat(2,minmax(140px,1fr))!important;}
        #v143WhppRetryStrip{grid-template-columns:1fr;grid-template-areas:"title" "meta" "actions" "auth";}
        #v143WhppRetryStrip .v143-actions{justify-content:flex-start;}
        #v143WhppRetryStrip .v144-auth-grid{grid-template-columns:1fr;}
      }
    `;document.head.appendChild(style);
  }

  function retryStrip(){
    installLayout();const panel=summaryPanel();if(!panel)return null;let strip=document.getElementById('v143WhppRetryStrip');
    if(!strip){
      strip=document.createElement('div');strip.id='v143WhppRetryStrip';
      strip.innerHTML='<span class="v143-title">WHPP接口待重试</span><span class="v143-meta">正在读取…</span><div class="v143-actions"><button id="v143WhppRetryBtn" class="btn primary compact" type="button">独立重试下一批200票</button></div><div id="v144CeRelogin" class="v144-auth" hidden></div>';
      strip.querySelector('#v143WhppRetryBtn')?.addEventListener('click',runRetry);
    }
    if(strip.parentElement!==panel)panel.appendChild(strip);
    return strip;
  }

  function showAuthLogin(message='CE接口授权已失效'){
    const strip=retryStrip();if(!strip)return;const auth=strip.querySelector('#v144CeRelogin');if(!auth)return;
    auth.hidden=false;auth.innerHTML=`<div class="v144-auth-title">CE接口需要重新登录</div><div class="v144-auth-grid"><input id="v144CeTenant" value="000000" aria-label="tenantId"><input id="v144CeUser" placeholder="CE账号" autocomplete="username"><input id="v144CePassword" type="password" placeholder="CE密码" autocomplete="current-password"><button id="v144CeLoginBtn" class="btn primary" type="button">重新登录CE并继续重试</button></div><div id="v144CeLoginMsg" class="v144-auth-note">${esc(message)}。密码只用于本次CE登录请求，不会写入WHPP历史数据。</div>`;
    auth.querySelector('#v144CeLoginBtn')?.addEventListener('click',loginCeAndRetry);
  }
  function hideAuthLogin(){const auth=document.getElementById('v144CeRelogin');if(auth)auth.hidden=true;}

  async function loginCeAndRetry(){
    const auth=document.getElementById('v144CeRelogin');if(!auth)return;const button=auth.querySelector('#v144CeLoginBtn');const msg=auth.querySelector('#v144CeLoginMsg');
    const tenantId=auth.querySelector('#v144CeTenant')?.value?.trim()||'000000';const username=auth.querySelector('#v144CeUser')?.value?.trim()||'';const password=auth.querySelector('#v144CePassword')?.value||'';
    if(!username||!password){msg.textContent='请输入CE账号和密码。';return;}
    button.disabled=true;button.textContent='正在登录CE…';msg.textContent='正在更新CE接口授权…';
    try{
      const r=await fetch('/api/ce-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId,username,password}),credentials:'same-origin'});const p=await r.json();if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);
      msg.textContent='CE重新登录成功，正在继续WHPP失败票重试…';hideAuthLogin();await runRetry();
    }catch(error){msg.textContent=`CE重新登录失败：${error.message}`;button.disabled=false;button.textContent='重新登录CE并继续重试';}
  }

  function renderPartial(dayRetry,historyRetry){
    const day=Math.max(0,Number(dayRetry||0));const history=Math.max(0,Number(historyRetry||0));if(!day&&!history)return;const node=statusNode();
    if(node)node.innerHTML=`<span class="status-pill warning">WHPP尚未完全结束</span><p>当日待重试 <b>${fmt(day)}</b> 票 · 历史WHPP待重试总量 <b>${fmt(history)}</b> 票。</p><p class="muted">失败票在右上“WHPP接口待重试”工作区独立处理，不需要重新跑整份日报，也不会阻塞后续日期上传。</p>`;
  }
  function schedulePoll(){clearTimeout(pollTimer);pollTimer=setTimeout(()=>queue({poll:true}),1200);}

  async function queue({poll=false}={}){
    if(!visible())return null;const strip=retryStrip();if(!strip)return null;const meta=strip.querySelector('.v143-meta');const btn=strip.querySelector('#v143WhppRetryBtn');
    try{
      const r=await fetch('/api/v143/whpp-retry-queue?limit=200',{cache:'no-store',credentials:'same-origin'});const p=await r.json();if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);
      const total=Number(p.summary?.total||0);const dates=(p.summary?.byDate||[]).map(x=>`${esc(x.reportDate)} ${fmt(x.count)}票`).join(' · ');const job=p.job||{};
      if(job.running){
        hideAuthLogin();const resolved=Math.max(0,Number(job.resolved||0));const jobTotal=Math.max(0,Number(job.total||0));
        meta.innerHTML=`<b style="color:#a66a00">后台重试处理中</b> · ${esc(job.phase||'处理中')} · 进度 <b>${fmt(resolved)}/${fmt(jobTotal)}</b> · 当前历史待重试 <b>${fmt(total)}</b> 票${dates?`<br><span class="muted">${dates}</span>`:''}`;
        if(btn){btn.disabled=true;btn.textContent='后台重试处理中…';}schedulePoll();
      }else if(job.error){
        meta.innerHTML=`<b style="color:#c23a3a">上一次重试失败：</b>${esc(job.error)}<br><span class="muted">失败票仍保留在SQLite；当前待重试 ${fmt(total)} 票。</span>`;
        if(btn){btn.disabled=total===0||authLike(job.error);btn.textContent=authLike(job.error)?'请先重新登录CE':(total?`重新尝试下一批${Math.min(200,total)}票`:'WHPP待重试已清零');}
        if(authLike(job.error))showAuthLogin(job.error);else hideAuthLogin();
      }else if(job.completedAt&&job.id){
        hideAuthLogin();meta.innerHTML=`上一批处理 <b>${fmt(job.total)}</b> · 恢复有效结果 <b>${fmt(job.recovered)}</b> · 本批闭环 <b>${fmt(job.closed)}</b> · 本批仍待重试 <b>${fmt(job.stillRetry)}</b> · 当前历史队列 <b>${fmt(total)}</b> 票${dates?`<br><span class="muted">${dates}</span>`:''}`;
        if(btn){btn.disabled=total===0;btn.textContent=total?`独立重试下一批${Math.min(200,total)}票`:'WHPP待重试已清零';}
      }else{
        hideAuthLogin();meta.innerHTML=total?`历史待重试 <b>${fmt(total)}</b> 票。${dates?`<br><span class="muted">${dates}</span>`:''}<br>只处理失败票，成功票不会重查。`:'<span style="color:#15965a;font-weight:700">WHPP待重试 0票</span>';
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
      hideAuthLogin();meta.innerHTML='<span style="color:#a66a00">后台任务已启动，正在读取实时进度…</span>';await queue({poll:true});
    }catch(error){
      meta.innerHTML=`<span style="color:#c23a3a">无法启动WHPP独立重试：${esc(error.message)}</span><br><span class="muted">失败票没有被删除。</span>`;
      if(authLike(error.message)){if(btn){btn.disabled=true;btn.textContent='请先重新登录CE';}showAuthLogin(error.message);}else if(btn){btn.disabled=false;btn.textContent='重新尝试启动';}
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
  console.info('[CE-QC][V144_WHPP_RETRY_WORKSPACE_AUTH]',VERSION);
})(window);
