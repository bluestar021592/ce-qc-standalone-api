(function installV461WhppSurvivorDiagnostic(global){
  if(global.__CE_QC_V461_WHPP_SURVIVOR_DIAGNOSTIC__)return;
  const VERSION='2026-09-08-v468-v462-survivor-lazy-v464-ui-v1';
  const V464_UI_SRC='/v464-whpp-offline-history-recovery.js?v=20260908-v468-1';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  let lastAuditAt=0,busy=false,timer=null,pollTimer=null,lastPayload=null,lastDate='',v464UiPromise=null;

  function host(){
    const panel=document.getElementById('v142HistoryAudit');if(!panel)return null;
    let box=document.getElementById('v461WhppSurvivorEvidence');
    if(!box){box=document.createElement('div');box.id='v461WhppSurvivorEvidence';box.className='operation-status';box.style.marginTop='8px';panel.querySelector('.button-row')?.before(box);}
    return box;
  }
  function incompleteWhppDate(){
    const text=document.getElementById('v142AuditBody')?.textContent||'';
    const area=text.match(/待核对日期[：:]([\s\S]*?)(?:导出执行|$)/)?.[1]||'';
    const matches=[...area.matchAll(/(20\d{2}-\d{2}-\d{2})[^；\n]*WHPP_SNAPSHOT_MISSING/g)];
    return matches[0]?.[1]||'';
  }
  function archiveResult(job={}){return job?.state==='COMPLETED'?(job.result||{}):{};}
  function ensureV464Ui(){
    if(global.__CE_QC_V464_WHPP_OFFLINE_RECOVERY__){void global.__CE_QC_V464_WHPP_OFFLINE_RECOVERY__.preflight?.();return Promise.resolve(true);}
    if(v464UiPromise)return v464UiPromise;
    v464UiPromise=new Promise((resolve,reject)=>{
      let script=document.querySelector('script[data-ce-qc-v464-lazy="1"]');
      const loaded=()=>{void global.__CE_QC_V464_WHPP_OFFLINE_RECOVERY__?.preflight?.();resolve(Boolean(global.__CE_QC_V464_WHPP_OFFLINE_RECOVERY__));};
      if(script){if(global.__CE_QC_V464_WHPP_OFFLINE_RECOVERY__)loaded();else{script.addEventListener('load',loaded,{once:true});script.addEventListener('error',()=>reject(new Error('V464_UI_LOAD_FAILED')),{once:true});}return;}
      script=document.createElement('script');script.src=V464_UI_SRC;script.async=true;script.dataset.ceQcV464Lazy='1';
      script.addEventListener('load',loaded,{once:true});script.addEventListener('error',()=>reject(new Error('V464_UI_LOAD_FAILED')),{once:true});document.head.appendChild(script);
    }).catch(error=>{v464UiPromise=null;const box=host();if(box)box.insertAdjacentHTML('beforeend',`<p class="danger-text">V464离线恢复预检界面加载失败：${esc(error?.message||error)}。未修改任何业务数据。</p>`);return false;});
    return v464UiPromise;
  }
  function render(payload,job){
    const box=host();if(!box||!payload)return;
    const current=payload.current||{},carry=payload.carry||{},ledger=payload.ledger||{},state=payload.persistedState||{},check=payload.checkpoints||{},archive=archiveResult(job);
    const confirm=archive.endpoints?.confirm||{},track=archive.endpoints?.track||{},exception=archive.endpoints?.exception||{};
    const archiveCandidate=archive.archiveDailyEvidenceCandidate===true,survivorCandidate=payload.survivorCoverageCandidate===true,candidate=archiveCandidate||survivorCandidate;
    const cls=candidate?'muted':'danger-text';
    let result='';
    if(archiveCandidate)result='V266原始API归档已找到覆盖当日日报成员的离线证据候选；下一步可以继续做离线重建验证，不需要重新调用CE接口。';
    else if(survivorCandidate)result='V246幸存账本已形成逐票完整当前证据候选；V266归档仍在独立核对或证据不足，不能直接判历史完成。';
    else result='SQLite幸存事实不足以直接恢复；继续由V266离线归档核对，不能强行判完成。';
    const runText=(payload.runLocks||[]).length?(payload.runLocks||[]).map(x=>`${esc(x.runId||'无runId')}[${esc(x.status||'无状态')}/${esc(x.currentStage||'无阶段')}${x.hasError?'/有错误':''}]`).join('、'):'无';
    let archiveStatus='尚未启动';
    if(job?.state==='RUNNING')archiveStatus=`独立子进程核对中：已处理 ${fmt(job.processedFiles)}/${fmt(job.totalFiles||0)} 个gzip，读取异常 ${fmt(job.readErrors)}，已用 ${fmt(Math.round(Number(job.elapsedMs||0)/1000))} 秒；主站和SQLite不等待它。`;
    else if(job?.state==='COMPLETED')archiveStatus=`独立子进程已完成：扫描 ${fmt(archive.filesConsidered)} 个gzip${archive.truncated?'（达到安全上限，不能作为完整证明）':''}，读取异常 ${fmt(archive.readErrors)}，耗时 ${fmt(Math.round(Number(archive.elapsedMs||0)/1000))} 秒。`;
    else if(job?.state==='FAILED')archiveStatus=`独立归档核对失败：${esc(job.error||'未知错误')}；未修改任何业务数据。`;
    box.innerHTML=`<p class="${cls}"><b>V462 ${esc(payload.reportDate||lastDate)} WHPP幸存证据：</b>${esc(result)}</p>`+
      `<p class="muted">成员 <b>${fmt(payload.members)}</b> · 当前状态行 ${fmt(current.rows)}（终态 ${fmt(current.terminal)} / 已检查非终态 ${fmt(current.checkedNonterminal)} / PENDING_SCAN ${fmt(current.pendingScan)} / 未知 ${fmt(current.unknown)}）</p>`+
      `<p class="muted">V246账本 ${fmt(ledger.rows)}（TERMINAL ${fmt(ledger.terminal)} / OPEN且有真实检查 ${fmt(ledger.checkedOpen)} / 占位或未验证 ${fmt(ledger.placeholderOrUnverified)} / 首次日报=当日 ${fmt(ledger.firstDateMatch)}） · POD锁 ${fmt(payload.podLocks)}</p>`+
      `<p class="muted">carry ${fmt(carry.rows)}（OPEN ${fmt(carry.open)} / 已闭环终态 ${fmt(carry.closedTerminal)}） · 旧run：${runText} · checkpoints ${fmt(check.rows)}（saved ${fmt(check.saved)} / failed ${fmt(check.failed)}，最后阶段 ${esc(check.lastStage||'无')}）</p>`+
      `<p class="muted"><b>V266原始API归档：</b>${archiveStatus}${job?.state==='COMPLETED'?` confirm请求覆盖 <b>${fmt(confirm.requestedDaily)}/${fmt(payload.members)}</b>（响应识别 ${fmt(confirm.responseDaily)}）；track覆盖 ${fmt(track.requestedDaily)}/${fmt(payload.members)}；exception覆盖 ${fmt(exception.requestedDaily)}/${fmt(payload.members)}。`:''}</p>`+
      `<p class="muted">当前WHPP state：日期 ${esc(state.reportDate||'无')} · runId ${esc(state.runId||'无')} · 阶段 ${esc(state.phase||'无')} · 保存finalRows ${fmt(state.finalRows)}。V462只读盘点；不恢复快照、不生成最终明细、不调用CE接口、不修改数据库。</p>`+
      `${(payload.readErrors||[]).length?`<p class="danger-text">SQLite读取异常：${(payload.readErrors||[]).map(esc).join('；')}</p>`:''}`;
  }
  function stopPoll(){if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}}
  async function pollArchive(date){
    stopPoll();if(!date||date!==lastDate)return;
    try{
      const r=await fetch(`/api/v462/whpp-history-archive-status?reportDate=${encodeURIComponent(date)}`,{cache:'no-store',credentials:'same-origin'});
      const p=await r.json();if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);
      render(lastPayload,p.archiveJob||{});
      if(p.archiveJob?.state==='RUNNING')pollTimer=setTimeout(()=>void pollArchive(date),2000);
      else if(p.archiveJob?.state==='COMPLETED')void ensureV464Ui();
    }catch(error){const box=host();if(box)box.insertAdjacentHTML('beforeend',`<p class="danger-text">V266后台证据状态读取失败：${esc(error?.message||error)}。业务数据未修改。</p>`);}
  }
  async function load(date){
    if(!date||busy)return;const box=host();if(!box)return;busy=true;lastDate=date;stopPoll();
    box.innerHTML=`<p class="muted"><b>V462 ${esc(date)} WHPP幸存证据：</b>正在快速读取精确日报成员的SQLite幸存事实；V266 gzip会在隔离子进程核对，不占用本请求。</p>`;
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort('V462_FAST_TIMEOUT'),15000);
    try{
      const r=await fetch(`/api/v462/whpp-history-survivor?reportDate=${encodeURIComponent(date)}`,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
      const p=await r.json();if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);
      lastPayload=p;render(p,p.archiveJob||{});
      if(p.archiveJob?.state==='RUNNING')pollTimer=setTimeout(()=>void pollArchive(date),1000);
      else if(p.archiveJob?.state==='COMPLETED')void ensureV464Ui();
    }catch(error){const timedOut=error?.name==='AbortError';box.innerHTML=`<p class="danger-text"><b>V462 WHPP幸存证据读取失败：</b>${timedOut?'SQLite快速读取超过15秒，已停止等待':esc(error?.message||error)}。未修改任何数据。</p>`;}
    finally{clearTimeout(timeout);busy=false;}
  }
  function tick(){
    const audit=global.__CE_QC_V142_HISTORY_AUDIT__;if(!audit||audit.running)return;
    const stamp=Number(audit.lastLoadedAt||0);if(!stamp||stamp===lastAuditAt)return;lastAuditAt=stamp;
    const date=incompleteWhppDate();if(date)void load(date);else{stopPoll();lastPayload=null;lastDate='';const box=host();if(box)box.innerHTML='';}
  }
  function start(){if(timer)return;timer=setInterval(tick,500);timer.unref?.();tick();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  global.__CE_QC_V461_WHPP_SURVIVOR_DIAGNOSTIC__={version:VERSION,refresh:()=>{const date=incompleteWhppDate();return date?load(date):Promise.resolve();},loadV464Ui:ensureV464Ui};
  console.info('[CE-QC][V462_WHPP_SURVIVOR_DIAGNOSTIC]',VERSION,'SQLite survivor returns fast; V266 gzip evidence is isolated in a child process; V464 UI is lazy-loaded only after archive completion and never on normal page startup.');
})(window);