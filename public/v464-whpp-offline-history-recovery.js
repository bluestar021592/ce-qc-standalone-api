(function installV464WhppOfflineRecovery(global){
  if(global.__CE_QC_V464_WHPP_OFFLINE_RECOVERY__)return;
  const VERSION='2026-09-08-v464-explicit-proof-gated-offline-whpp-recovery-ui-v1';
  const CONFIRMATION='V464_OFFLINE_RECOVERY';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  let timer=null,pollTimer=null,busy=false,repairing=false,lastAuditAt=0,lastDate='';

  const labels={
    headerExact:'日报表头/成员数量未闭合',stateReportExact:'WHPP state日期不是目标日',stateMembershipExact:'WHPP state成员与日报不一致',
    stateDailyFinalCoverageExact:'保存的finalRows未覆盖全部日报成员',stateWorksetExact:'保存的finalRows与当日成员+历史carry工作集不一致',
    survivorExact:'V246逐票真实检查未覆盖全部成员',carryLedgerConsistent:'carry与V246终态/OPEN不一致',archiveConfirmExact:'V266 confirm 141/141原始证据尚未闭合',
    noCurrentHistoricalRows:'目标日已存在历史final_rows，拒绝覆盖',noViableSnapshot:'目标日已有可用快照，拒绝另造快照',noHistoryAttestation:'目标日已有历史snapshot证明，拒绝覆盖',
    dailyUnfinalized:'日报已经存在正式完成凭证，不需要恢复',stateIdle:'WHPP当前仍在运行，禁止恢复',dashboardExact:'恢复前dashboard对账未闭合'
  };
  function host(){
    const panel=document.getElementById('v142HistoryAudit');if(!panel)return null;
    let box=document.getElementById('v464WhppOfflineRecovery');
    if(!box){box=document.createElement('div');box.id='v464WhppOfflineRecovery';box.className='operation-status';box.style.marginTop='8px';panel.querySelector('.button-row')?.before(box);}
    return box;
  }
  function incompleteWhppDate(){
    const text=document.getElementById('v142AuditBody')?.textContent||'';
    const area=text.match(/待核对日期[：:]([\s\S]*?)(?:导出执行|$)/)?.[1]||'';
    const match=area.match(/(20\d{2}-\d{2}-\d{2})[^；\n]*WHPP_SNAPSHOT_MISSING/);
    return match?.[1]||'';
  }
  function stopPoll(){if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}}
  function render(p={}){
    const box=host();if(!box)return;
    if(p.recoveredAlready){box.innerHTML=`<p class="success"><b>V464 ${esc(p.reportDate)}：</b>该日期已经存在正式WHPP完成凭证，不需要再次恢复。</p>`;return;}
    const archive=p.archive||{},survivor=p.survivor||{};
    const proof=`日报 ${fmt(p.reported)} / 成员 ${fmt(p.members)} · state成员 ${fmt(p.stateMembers)} · state finalRows ${fmt(p.stateFinalRows)}（日报覆盖 ${fmt(p.stateDailyFinalCoverage)} / 工作集 ${fmt(p.expectedWorkset)}） · V246已验证 ${fmt(survivor.ledgerKnown)}/${fmt(p.members)}（终态 ${fmt(survivor.ledgerTerminal)} / OPEN ${fmt(survivor.ledgerCheckedOpen)}） · V266 confirm ${fmt(archive.confirmRequestedDaily)}/${fmt(p.members)}（响应 ${fmt(archive.confirmResponseDaily)}）`;
    if(p.repairable){
      box.innerHTML=`<p class="success"><b>V464 ${esc(p.reportDate)} 离线恢复证明已闭合：</b>${proof}</p><p class="muted">只恢复该日历史完成凭证和141个日报成员的历史final_rows；保留当前135终态+6 OPEN、carry和V246账本，不调用CE，也不重新扫描/轨迹。</p><div class="button-row"><button id="v464WhppOfflineRepair" class="btn primary compact" type="button">离线恢复 ${esc(p.reportDate)} WHPP历史凭证</button></div>`;
      box.querySelector('#v464WhppOfflineRepair')?.addEventListener('click',()=>void repair(p.reportDate),{once:true});
      return;
    }
    const failed=(p.failedChecks||[]).map(key=>labels[key]||key);
    const waiting=(p.failedChecks||[]).length===1&&p.failedChecks[0]==='archiveConfirmExact'&&['RUNNING','NOT_STARTED'].includes(String(archive.state||''));
    box.innerHTML=`<p class="${waiting?'muted':'danger-text'}"><b>V464 ${esc(p.reportDate)}：</b>${waiting?'正在等待V462独立归档任务完成；其它离线恢复条件已经核对。':'当前不能执行离线恢复。'}</p><p class="muted">${proof}</p>${failed.length?`<p class="${waiting?'muted':'danger-text'}">${waiting?'等待项':'未通过'}：${failed.map(esc).join('；')}</p>`:''}<p class="muted">V464不会自动修复，也不会因为证据不足放宽导出安全判断。</p>`;
  }
  async function preflight(date){
    if(!date||busy||repairing)return;busy=true;lastDate=date;
    try{
      const r=await fetch(`/api/v464/whpp-history-offline-recovery?reportDate=${encodeURIComponent(date)}`,{cache:'no-store',credentials:'same-origin'});
      const p=await r.json();if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);
      render(p);
      if(!p.repairable&&!p.recoveredAlready&&(p.failedChecks||[]).includes('archiveConfirmExact'))pollTimer=setTimeout(()=>void preflight(date),2000);
    }catch(error){const box=host();if(box)box.innerHTML=`<p class="danger-text"><b>V464恢复预检失败：</b>${esc(error?.message||error)}。未修改任何数据。</p>`;}
    finally{busy=false;}
  }
  async function repair(date){
    if(repairing||!date)return;repairing=true;stopPoll();
    const box=host();if(box)box.innerHTML=`<p class="muted"><b>V464 ${esc(date)}：</b>正在事务内重新验证全部证明并重建历史完成凭证；不会调用CE。</p>`;
    try{
      const r=await fetch('/api/v464/whpp-history-offline-recovery',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CE-QC-History-Recovery':CONFIRMATION},body:JSON.stringify({reportDate:date,confirmation:CONFIRMATION})});
      const p=await r.json();if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);
      if(box)box.innerHTML=`<p class="success"><b>V464离线恢复完成：</b>${esc(date)} · 成员 ${fmt(p.members)} · 已重建历史final_rows ${fmt(p.historicalFinalRowsWritten)} · 新快照 ${esc(p.snapshotId||'')}</p><p class="muted">当前运单状态、carry、V246账本和CE原始证据均未改写。正在重新执行历史导出安全检查。</p>`;
      await global.__CE_QC_V142_HISTORY_AUDIT__?.refresh?.();
    }catch(error){if(box)box.innerHTML=`<p class="danger-text"><b>V464离线恢复被拒绝：</b>${esc(error?.message||error)}。事务已回滚，未强行标记完成。</p>`;}
    finally{repairing=false;}
  }
  function tick(){
    const audit=global.__CE_QC_V142_HISTORY_AUDIT__;if(!audit||audit.running)return;
    const stamp=Number(audit.lastLoadedAt||0);if(!stamp||stamp===lastAuditAt)return;lastAuditAt=stamp;
    const date=incompleteWhppDate();
    if(!date){stopPoll();lastDate='';const box=host();if(box)box.innerHTML='';return;}
    stopPoll();void preflight(date);
  }
  function start(){if(timer)return;timer=setInterval(tick,500);timer.unref?.();tick();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  global.__CE_QC_V464_WHPP_OFFLINE_RECOVERY__={version:VERSION,preflight:()=>{const date=incompleteWhppDate();return date?preflight(date):Promise.resolve();}};
  console.info('[CE-QC][V464_WHPP_OFFLINE_RECOVERY_UI]',VERSION,'proof-gated explicit one-click offline recovery only; no automatic POST, no CE call, no scan/track rerun.');
})(window);