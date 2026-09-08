(function installV461WhppSurvivorDiagnostic(global){
  if(global.__CE_QC_V461_WHPP_SURVIVOR_DIAGNOSTIC__)return;
  const VERSION='2026-09-08-v461-whpp-historical-survivor-evidence-ui-v2';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  let lastAuditAt=0,busy=false,timer=null;

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
  async function load(date){
    if(!date||busy)return;const box=host();if(!box)return;busy=true;
    box.innerHTML=`<p class="muted"><b>V461 ${esc(date)} WHPP幸存证据：</b>正在只读核对精确${date}日报成员和V266原始API归档；不调用CE接口，不扫描轨迹大表，不修改数据库。</p>`;
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort('V461_TIMEOUT'),60000);
    try{
      const r=await fetch(`/api/v461/whpp-history-survivor?reportDate=${encodeURIComponent(date)}`,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
      const p=await r.json();if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);
      const current=p.current||{},carry=p.carry||{},ledger=p.ledger||{},state=p.persistedState||{},check=p.checkpoints||{},archive=p.archive||{};
      const confirm=archive.endpoints?.confirm||{},track=archive.endpoints?.track||{},exception=archive.endpoints?.exception||{};
      const candidate=p.survivorCoverageCandidate||archive.archiveDailyEvidenceCandidate;
      const cls=candidate?'muted':'danger-text';
      let result='';
      if(archive.archiveDailyEvidenceCandidate)result='V266原始API归档已找到覆盖当日日报成员的离线证据候选；下一步可以直接做离线重建验证，不需要重新调用CE接口。';
      else if(p.survivorCoverageCandidate)result='V246幸存账本已形成逐票完整当前证据候选，但V266原始API覆盖仍不足；只能继续做离线证据核验，不能直接判历史完成。';
      else result='SQLite幸存事实与V266原始API归档目前都不足以直接恢复；不能强行判完成。';
      const runText=(p.runLocks||[]).length?(p.runLocks||[]).map(x=>`${esc(x.runId||'无runId')}[${esc(x.status||'无状态')}/${esc(x.currentStage||'无阶段')}${x.hasError?'/有错误':''}]`).join('、'):'无';
      const archiveStatus=archive.error?`归档读取失败：${esc(archive.error)}`:`扫描归档文件 ${fmt(archive.filesConsidered)} 个${archive.truncated?'（达到安全上限，未作为完整证明）':''}；读取异常 ${fmt(archive.readErrors)}`;
      box.innerHTML=`<p class="${cls}"><b>V461 ${esc(date)} WHPP幸存证据：</b>${esc(result)}</p>`+
        `<p class="muted">成员 <b>${fmt(p.members)}</b> · 当前状态行 ${fmt(current.rows)}（终态 ${fmt(current.terminal)} / 已检查非终态 ${fmt(current.checkedNonterminal)} / PENDING_SCAN ${fmt(current.pendingScan)} / 未知 ${fmt(current.unknown)}）</p>`+
        `<p class="muted">V246账本 ${fmt(ledger.rows)}（TERMINAL ${fmt(ledger.terminal)} / OPEN且有真实检查 ${fmt(ledger.checkedOpen)} / 占位或未验证 ${fmt(ledger.placeholderOrUnverified)} / 首次日报=当日 ${fmt(ledger.firstDateMatch)}） · POD锁 ${fmt(p.podLocks)}</p>`+
        `<p class="muted">carry ${fmt(carry.rows)}（OPEN ${fmt(carry.open)} / 已闭环终态 ${fmt(carry.closedTerminal)}） · 旧run：${runText} · checkpoints ${fmt(check.rows)}（saved ${fmt(check.saved)} / failed ${fmt(check.failed)}，最后阶段 ${esc(check.lastStage||'无')}）</p>`+
        `<p class="muted"><b>V266原始API归档：</b>${archiveStatus}。confirm请求覆盖当日成员 <b>${fmt(confirm.requestedDaily)}/${fmt(p.members)}</b>（响应中识别 ${fmt(confirm.responseDaily)}）；track请求覆盖 ${fmt(track.requestedDaily)}/${fmt(p.members)}；exception请求覆盖 ${fmt(exception.requestedDaily)}/${fmt(p.members)}。相关请求可能包含当时carry，因此这里只作为原始证据盘点，不会自动判定WHPP完成。</p>`+
        `<p class="muted">当前WHPP state：日期 ${esc(state.reportDate||'无')} · runId ${esc(state.runId||'无')} · 阶段 ${esc(state.phase||'无')} · 保存finalRows ${fmt(state.finalRows)}。V461仅盘点证据，不恢复快照、不生成最终明细、不改变导出安全状态。</p>`+
        `${(p.readErrors||[]).length?`<p class="danger-text">SQLite读取异常：${(p.readErrors||[]).map(esc).join('；')}</p>`:''}`;
    }catch(error){const timedOut=error?.name==='AbortError';box.innerHTML=`<p class="danger-text"><b>V461 WHPP幸存证据读取失败：</b>${timedOut?'只读归档核对超过60秒，已停止等待':esc(error?.message||error)}。未修改任何数据。</p>`;}
    finally{clearTimeout(timeout);busy=false;}
  }
  function tick(){
    const audit=global.__CE_QC_V142_HISTORY_AUDIT__;if(!audit||audit.running)return;
    const stamp=Number(audit.lastLoadedAt||0);if(!stamp||stamp===lastAuditAt)return;lastAuditAt=stamp;
    const date=incompleteWhppDate();if(date)void load(date);else{const box=host();if(box)box.innerHTML='';}
  }
  function start(){if(timer)return;timer=setInterval(tick,500);timer.unref?.();tick();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  global.__CE_QC_V461_WHPP_SURVIVOR_DIAGNOSTIC__={version:VERSION,refresh:()=>{const date=incompleteWhppDate();return date?load(date):Promise.resolve();}};
  console.info('[CE-QC][V461_WHPP_SURVIVOR_DIAGNOSTIC]',VERSION,'follows manual V142 audit only; exact-member SQLite survivor + bounded V266 archive census is read-only and never starts business processing.');
})(window);
