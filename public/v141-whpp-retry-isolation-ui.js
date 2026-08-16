(function installV145SevenBusinessRetryCenter(global){
  if(global.__CE_QC_V145_SEVEN_BUSINESS_RETRY_CENTER__)return;
  global.__CE_QC_V145_SEVEN_BUSINESS_RETRY_CENTER__=true;
  const VERSION='2026-08-16-v145-seven-business-retry-center-v1';
  const TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
  const LABELS={ALL:'全部业务',CE:'CE',CEAF:'CEAF',TBKH:'TBKH',ALI1688:'ALI1688',SHOPEECN:'SHOPEE CN',SHOPEEVN:'SHOPEE VN',WHPP:'WHPP本土'};
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  let selectedBusiness='ALL';
  let lastPayload=null;
  let pollTimer=null;
  let lastRetryTarget='';

  function visible(){return location.pathname==='/import'||document.getElementById('importPage')?.classList?.contains('active')||document.getElementById('importPage')?.hidden===false;}
  function importPanel(){return document.getElementById('unifiedImport');}
  function authLike(message=''){return /未授权|unauthorized|重新登录CE|需要重新登录CE|token|登录.*过期|授权.*失效/i.test(String(message||''));}

  function installLayout(){
    document.getElementById('v143ImportWorkspaceStyle')?.remove();
    document.getElementById('v144ImportWorkspaceStyle')?.remove();
    if(document.getElementById('v145ImportWorkspaceStyle'))return;
    const style=document.createElement('style');style.id='v145ImportWorkspaceStyle';style.textContent=`
      #importPage .operations-dashboard{
        display:grid!important;grid-template-columns:minmax(430px,.88fr) minmax(590px,1.12fr)!important;
        grid-template-areas:"import summary" "run run" "carry carry"!important;gap:14px!important;align-items:stretch!important;
      }
      #importPage #unifiedImport{grid-area:import!important;margin:0!important;align-self:stretch!important;height:100%!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;}
      #importPage .unified-summary-panel{grid-area:summary!important;margin:0!important;align-self:stretch!important;height:100%!important;min-height:0!important;overflow:hidden!important;}
      #importPage #runPanel{grid-area:run!important;width:100%!important;margin:0!important;}
      #importPage #v139CarryManualPanel{grid-area:carry!important;width:100%!important;margin:0!important;}
      #importPage .unified-summary-panel #unifiedClassificationSummary{min-height:0!important;height:auto!important;}
      #importPage .unified-summary-panel .unified-count-grid{grid-template-columns:repeat(4,minmax(120px,1fr))!important;gap:10px!important;}
      #importPage #v139CarryManualPanel .unified-count-grid{grid-template-columns:repeat(4,minmax(150px,1fr))!important;gap:10px!important;}
      #importPage #v139CarryManualPanel .preview-table-wrap{max-height:260px!important;overflow:auto!important;}
      #importPage #v142HistoryAudit{margin-top:14px!important;}
      #v145RetryCenter{margin-top:14px;border-top:1px solid #e1eaf5;background:#f8fbff;padding:14px 16px 16px;min-height:255px;}
      #v145RetryCenter .v145-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;}
      #v145RetryCenter .v145-title{font-size:15px;font-weight:800;color:#173b68;}
      #v145RetryCenter .v145-total{padding:4px 9px;border-radius:999px;background:#eaf3ff;color:#1768e5;font-weight:800;font-size:11px;white-space:nowrap;}
      #v145RetryCenter .v145-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-bottom:10px;}
      #v145RetryCenter .v145-kpi{border:1px solid #dbe6f4;border-radius:7px;background:#fff;padding:7px 8px;min-width:0;}
      #v145RetryCenter .v145-kpi span{display:block;color:#75869c;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      #v145RetryCenter .v145-kpi b{display:block;margin-top:2px;color:#173b68;font-size:18px;line-height:1.15;}
      #v145RetryCenter .v145-toolbar{display:grid;grid-template-columns:minmax(150px,1fr) auto auto;gap:8px;align-items:center;margin-bottom:9px;}
      #v145RetryCenter select{height:35px;border:1px solid #cbd8e8;border-radius:6px;background:#fff;color:#234361;padding:0 9px;min-width:0;}
      #v145RetryCenter .v145-meta{min-height:38px;color:#5f728a;line-height:1.55;font-size:11px;overflow-wrap:anywhere;}
      #v145RetryCenter .v145-preview{margin-top:8px;border:1px solid #e0e8f2;border-radius:7px;background:#fff;overflow:hidden;}
      #v145RetryCenter .v145-row{display:grid;grid-template-columns:82px 90px 88px minmax(0,1fr);gap:8px;padding:6px 9px;border-top:1px solid #edf2f7;font-size:10px;align-items:center;}
      #v145RetryCenter .v145-row:first-child{border-top:0;background:#f4f8fd;color:#60738b;font-weight:700;}
      #v145RetryCenter .v145-row span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      #v145RetryCenter .v145-auth{margin-top:9px;padding:10px;border:1px solid #efc9c9;border-radius:7px;background:#fff7f7;}
      #v145RetryCenter .v145-auth-title{font-weight:800;color:#b53232;margin-bottom:7px;}
      #v145RetryCenter .v145-auth-grid{display:grid;grid-template-columns:90px minmax(120px,1fr) minmax(140px,1fr);gap:7px;}
      #v145RetryCenter .v145-auth-grid input{height:34px;border:1px solid #cdd9e8;border-radius:6px;padding:0 8px;min-width:0;}
      #v145RetryCenter .v145-auth .btn{margin-top:7px;width:100%;}
      #v145RetryCenter .v145-note{margin-top:6px;color:#7b6262;font-size:10px;}
      @media(max-width:1280px){
        #importPage .operations-dashboard{grid-template-columns:1fr!important;grid-template-areas:"import" "summary" "run" "carry"!important;}
        #importPage #unifiedImport,#importPage .unified-summary-panel{height:auto!important;}
        #importPage .unified-summary-panel .unified-count-grid,#importPage #v139CarryManualPanel .unified-count-grid{grid-template-columns:repeat(2,minmax(140px,1fr))!important;}
        #v145RetryCenter .v145-kpis{grid-template-columns:repeat(2,minmax(0,1fr));}
        #v145RetryCenter .v145-toolbar,#v145RetryCenter .v145-auth-grid{grid-template-columns:1fr;}
      }
    `;document.head.appendChild(style);
  }

  function center(){
    installLayout();const host=importPanel();if(!host)return null;
    document.getElementById('v143WhppRetryStrip')?.remove();
    let node=document.getElementById('v145RetryCenter');
    if(!node){
      node=document.createElement('div');node.id='v145RetryCenter';node.innerHTML=`
        <div class="v145-head"><span class="v145-title">七业务接口失败 / 失效重试中心</span><span id="v145Total" class="v145-total">正在读取</span></div>
        <div id="v145Kpis" class="v145-kpis"></div>
        <div class="v145-toolbar"><select id="v145Business"><option value="ALL">全部业务</option>${TYPES.map(type=>`<option value="${type}">${LABELS[type]}</option>`).join('')}</select><button id="v145Refresh" class="btn ghost compact" type="button">刷新失败池</button><button id="v145Retry" class="btn primary compact" type="button">重试下一批200票</button></div>
        <div id="v145Meta" class="v145-meta">正在读取接口失败记录…</div>
        <div id="v145Preview" class="v145-preview"></div>
        <div id="v145Auth" class="v145-auth" hidden></div>`;
      node.querySelector('#v145Business')?.addEventListener('change',event=>{selectedBusiness=String(event.target.value||'ALL');queue();});
      node.querySelector('#v145Refresh')?.addEventListener('click',()=>queue());
      node.querySelector('#v145Retry')?.addEventListener('click',runRetry);
      host.appendChild(node);
    }else if(node.parentElement!==host)host.appendChild(node);
    return node;
  }

  function renderKpis(summary={}){
    const target=document.getElementById('v145Kpis');if(!target)return;const counts=summary.byBusiness||{};
    target.innerHTML=[['ALL','全部失败',summary.total||0],...TYPES.map(type=>[type,LABELS[type],counts[type]||0])].map(([type,label,count])=>`<div class="v145-kpi" data-business="${type}"><span>${esc(label)}</span><b>${fmt(count)}</b></div>`).join('');
  }
  function renderPreview(rows=[]){
    const target=document.getElementById('v145Preview');if(!target)return;
    if(!rows.length){target.innerHTML='<div style="padding:12px;color:#15965a;font-weight:700;text-align:center">当前筛选范围没有接口失败票</div>';return;}
    const items=rows.slice(0,6);target.innerHTML='<div class="v145-row"><span>来源日期</span><span>业务</span><span>失败阶段</span><span>运单号</span></div>'+items.map(row=>`<div class="v145-row"><span>${esc(row.sourceReportDate||'—')}</span><span>${esc(LABELS[row.businessType]||row.businessType||'—')}</span><span>${esc(row.stage||row.apiStatus||'待重试')}</span><span>${esc(row.shipmentCode||'')}</span></div>`).join('');
  }
  function showAuth(message='CE接口授权已失效'){
    const node=center();const auth=node?.querySelector('#v145Auth');if(!auth)return;auth.hidden=false;auth.innerHTML=`<div class="v145-auth-title">CE接口需要重新登录</div><div class="v145-auth-grid"><input id="v145Tenant" value="000000" aria-label="tenantId"><input id="v145User" placeholder="CE账号" autocomplete="username"><input id="v145Password" type="password" placeholder="CE密码" autocomplete="current-password"></div><button id="v145Login" class="btn primary" type="button">重新登录CE并继续重试</button><div id="v145LoginMsg" class="v145-note">${esc(message)}。密码只用于本次CE登录，不写入业务数据。</div>`;auth.querySelector('#v145Login')?.addEventListener('click',loginAndRetry);
  }
  function hideAuth(){const auth=document.getElementById('v145Auth');if(auth)auth.hidden=true;}
  async function loginAndRetry(){
    const auth=document.getElementById('v145Auth');if(!auth)return;const button=auth.querySelector('#v145Login');const msg=auth.querySelector('#v145LoginMsg');const tenantId=auth.querySelector('#v145Tenant')?.value?.trim()||'000000';const username=auth.querySelector('#v145User')?.value?.trim()||'';const password=auth.querySelector('#v145Password')?.value||'';
    if(!username||!password){msg.textContent='请输入CE账号和密码。';return;}button.disabled=true;button.textContent='正在登录CE…';
    try{const r=await fetch('/api/ce-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId,username,password}),credentials:'same-origin'});const p=await r.json();if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);hideAuth();await runRetry();}
    catch(error){msg.textContent=`CE重新登录失败：${error.message}`;button.disabled=false;button.textContent='重新登录CE并继续重试';}
  }

  function schedulePoll(){clearTimeout(pollTimer);pollTimer=setTimeout(()=>queue({poll:true}),1200);}
  async function queue({poll=false}={}){
    if(!visible())return null;const node=center();if(!node)return null;const meta=node.querySelector('#v145Meta');const button=node.querySelector('#v145Retry');const totalBadge=node.querySelector('#v145Total');
    try{
      const [centerRes,whppRes]=await Promise.all([
        fetch(`/api/v145/retry-center?businessType=${encodeURIComponent(selectedBusiness)}&limit=200`,{cache:'no-store',credentials:'same-origin'}),
        fetch('/api/v143/whpp-retry-queue?limit=200',{cache:'no-store',credentials:'same-origin'})
      ]);
      const payload=await centerRes.json();const whpp=await whppRes.json();if(!centerRes.ok||payload.ok===false)throw new Error(payload.error||`HTTP ${centerRes.status}`);lastPayload=payload;
      const summary=payload.summary||{};const total=Number(summary.total||0);const selectedTotal=Number(summary.selectedTotal||0);const target=selectedBusiness==='ALL'?String(summary.nextBusiness||''):selectedBusiness;lastRetryTarget=target;
      renderKpis(summary);renderPreview(payload.rows||[]);if(totalBadge)totalBadge.textContent=`失败待重试 ${fmt(total)}`;
      const centerJob=payload.job||{};const whppJob=whpp?.job||{};const active=whppJob.running?{...whppJob,engine:'WHPP'}:(centerJob.running?{...centerJob,engine:'SEVEN'}:null);
      if(active){hideAuth();meta.innerHTML=`<b style="color:#a66a00">后台重试处理中</b> · ${esc(LABELS[active.businessType]||active.engine||'')} · ${esc(active.phase||'处理中')} · 进度 <b>${fmt(active.resolved)}/${fmt(active.total)}</b> · 全部失败池 <b>${fmt(total)}</b> 票`;button.disabled=true;button.textContent='后台重试处理中…';schedulePoll();return payload;}
      const lastError=String(centerJob.error||whppJob.error||'');
      if(lastError){meta.innerHTML=`<b style="color:#c23a3a">上一次重试失败：</b>${esc(lastError)}<br>失败票仍保留在SQLite，不会被删除。`;if(authLike(lastError)){showAuth(lastError);button.disabled=true;button.textContent='请先重新登录CE';}else{hideAuth();button.disabled=selectedTotal===0;button.textContent='重新尝试下一批';}return payload;}
      hideAuth();
      const dates=(summary.byDate||[]).slice(0,12).map(item=>`${esc(item.reportDate)} ${fmt(item.count)}票`).join(' · ');
      if(total===0){meta.innerHTML='<b style="color:#15965a">七业务接口失败池已清零。</b><br>以后任一业务出现扫描/轨迹/异常接口失败，会自动在这里汇总。';button.disabled=true;button.textContent='当前无失败票';}
      else if(selectedTotal===0){meta.innerHTML=`全部七业务仍有 <b>${fmt(total)}</b> 票失败，但当前筛选“${esc(LABELS[selectedBusiness]||selectedBusiness)}”为0票。`;button.disabled=true;button.textContent='当前业务无失败票';}
      else{meta.innerHTML=`当前筛选 <b>${esc(LABELS[selectedBusiness]||selectedBusiness)}</b>：<b>${fmt(selectedTotal)}</b> 票待重试${dates?`<br>${dates}`:''}<br><span style="color:#7a899c">只处理明确失败票；成功票、普通未POD和普通跨日遗留不会进入这里。</span>`;button.disabled=false;const targetCount=Number(summary.byBusiness?.[target]||selectedTotal);button.textContent=`重试下一批${Math.min(200,targetCount||selectedTotal)}票${target?` · ${LABELS[target]||target}`:''}`;}
      return payload;
    }catch(error){meta.innerHTML=`<span style="color:#c23a3a">七业务接口失败池读取失败：${esc(error.message)}</span>`;button.disabled=true;if(poll)schedulePoll();return null;}
  }

  async function runRetry(){
    const node=center();if(!node)return;const meta=node.querySelector('#v145Meta');const button=node.querySelector('#v145Retry');const payload=lastPayload||await queue();if(!payload)return;const summary=payload.summary||{};const target=selectedBusiness==='ALL'?String(summary.nextBusiness||''):selectedBusiness;if(!target)return;lastRetryTarget=target;button.disabled=true;button.textContent='正在启动后台重试…';meta.innerHTML=`<span style="color:#a66a00">正在启动 ${esc(LABELS[target]||target)} 失败票补偿重试…</span>`;
    try{
      const url=target==='WHPP'?'/api/v143/whpp-retry-queue/recheck':'/api/v145/retry-center/recheck';const body=target==='WHPP'?{limit:200}:{businessType:target,limit:200};const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'same-origin'});const p=await r.json();if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);hideAuth();meta.innerHTML='<span style="color:#a66a00">后台任务已启动，正在读取实时进度…</span>';schedulePoll();
    }catch(error){meta.innerHTML=`<span style="color:#c23a3a">无法启动接口恢复：${esc(error.message)}</span><br>失败票没有被删除。`;if(authLike(error.message)){showAuth(error.message);button.disabled=true;button.textContent='请先重新登录CE';}else{button.disabled=false;button.textContent='重新尝试启动';}}
  }

  async function reconcile(){if(!visible())return;installLayout();center();await queue();}
  document.addEventListener('ce-qc-run-complete',()=>setTimeout(reconcile,180));
  document.addEventListener('click',event=>{if(event.target?.closest?.('[data-page="import"],.side-link[data-path="/import"]'))setTimeout(reconcile,150);},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(reconcile,180),{once:true});else setTimeout(reconcile,180);
  global.__CE_QC_V145_SEVEN_BUSINESS_RETRY_CENTER__={version:VERSION,refresh:reconcile,retry:runRetry};
  console.info('[CE-QC][V145_SEVEN_BUSINESS_RETRY_CENTER]',VERSION);
})(window);
