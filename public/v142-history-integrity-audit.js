(function installV142HistoryAudit(global){
  if(global.__CE_QC_V142_HISTORY_AUDIT__)return;global.__CE_QC_V142_HISTORY_AUDIT__=true;
  const VERSION='2026-09-02-v419-manual-only-history-audit-no-open-mutation-v4';
  const V451_UI_ID='2026-09-07-v451-snapshot-indexed-history-audit-ui-v1';
  const V456_UI_ID='2026-09-08-v456-whpp-authority-diagnostic-ui-v1';
  const AUDIT_TIMEOUT_MS=60000;
  // Compatibility wording gate: when an older backend still returns OPEN evidence,
  // preserve its display. V451 deliberately skips those mega-table diagnostics.
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=v=>Number(v||0).toLocaleString('zh-CN');
  const whppReasonLabel=reason=>({
    WHPP_DAILY_REPORT_MISSING:'WHPP日报不存在',
    WHPP_ZERO_TICKET_DAILY:'WHPP当日0票',
    WHPP_DAILY_NOT_COMPLETED:'WHPP日报未形成正式完成标记',
    WHPP_FINALIZED_SNAPSHOT_ID_MISSING:'WHPP日报显示完成但缺少 finalizedSnapshotId',
    WHPP_FINALIZED_SNAPSHOT_ROW_MISSING:'WHPP日报已有 finalizedSnapshotId，但对应实体快照不存在',
    WHPP_FINALIZED_SNAPSHOT_INVALID_OR_FAILED:'WHPP最终快照已被标记为 INVALID/FAILED',
    WHPP_VALID_COMPLETED_SNAPSHOT:'WHPP存在 VALID+COMPLETED 最终快照',
    WHPP_LEGACY_FINALIZED_SNAPSHOT_ATTESTED:'WHPP旧版最终快照已由日报精确证明'
  }[String(reason||'')]||String(reason||'未知'));
  function whppDiagnostic(item={}){
    const w=item.whpp;if(!w)return '';
    const finalId=w.finalizedSnapshotId?esc(w.finalizedSnapshotId):'无';
    const status=w.dailySnapshotStatus?esc(w.dailySnapshotStatus):'无';
    return `；WHPP诊断：${esc(whppReasonLabel(w.authorityReason))}；日报 ${fmt(w.reported)} / 成员 ${fmt(w.dailyRows)} / 最终明细 ${fmt(w.finalRows)}；日报完成=${w.completedFlag?'是':'否'}，状态=${status}，finalizedSnapshotId=${finalId}，同日快照候选=${fmt(w.snapshotCandidateCount)}`;
  }
  let auditRunning=false;
  let lastLoadedAt=0;

  function visible(){return location.pathname==='/import'||document.getElementById('importPage')?.classList?.contains('active');}
  function host(){
    const page=document.getElementById('importPage');if(!page)return null;
    let panel=document.getElementById('v142HistoryAudit');if(panel)return panel;
    panel=document.createElement('section');panel.id='v142HistoryAudit';panel.className='panel operation-panel';
    panel.innerHTML=`<div class="panel-title"><div><h3>历史数据完整性 / 导出安全检查</h3><p>27GB大库使用只读索引核对；不重跑日报、不重跑扫描/轨迹，也不修改现有业务数据。</p></div><span class="status-pill muted">手动检查</span></div><div id="v142AuditBody" class="operation-status"><span class="status-pill muted">未执行历史完整性检查</span><p class="muted">正常日报上传、七业务状态确认、统一处理、扫描和轨迹查询不会自动触发本检查。</p></div><div class="button-row" style="margin-top:10px"><button id="v142AuditRefresh" class="btn ghost compact" type="button">立即重新检查</button></div>`;
    page.appendChild(panel);
    panel.querySelector('#v142AuditRefresh')?.addEventListener('click',()=>void load());
    return panel;
  }
  async function load(){
    if(!visible())return;
    const panel=host();if(!panel||auditRunning)return;
    auditRunning=true;
    const body=panel.querySelector('#v142AuditBody');
    const button=panel.querySelector('#v142AuditRefresh');
    if(button)button.disabled=true;
    body.innerHTML='<span class="status-pill warning">正在只读核对历史日报、快照和7业务导出覆盖…</span><p class="muted">V451 先读取每日有效 snapshotId，再按 snapshotId 索引读取明细；V456 仅追加WHPP最终快照权威元数据核对；不会执行会锁住27GB SQLite 的轨迹/扫描/OPEN大表统计。</p>';
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort('V451_HISTORY_AUDIT_TIMEOUT'),AUDIT_TIMEOUT_MS);
    try{
      const r=await fetch('/api/v142/history-integrity?fromDate=2026-07-01',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
      const raw=await r.text();
      let p=null;try{p=raw?JSON.parse(raw):{};}catch{throw new Error(`HTTP ${r.status} 返回了非JSON响应`);}
      if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);
      const missing=p.missingDates||[],incomplete=p.incompleteDates||[],evidence=p.currentEvidence||{};
      const diagnosticsSkipped=evidence.heavyDiagnosticCountsSkipped===true;
      const latestProcessingIssues=new Set(['CORE_SNAPSHOT_NOT_COMPLETED','WHPP_SNAPSHOT_MISSING','WHPP_FINAL_ROWS_INCOMPLETE']);
      const latestDayPending=missing.length===0&&incomplete.length>0&&incomplete.every(x=>String(x.reportDate||'')===String(p.toDate||'')&&(x.issues||[]).length>0&&(x.issues||[]).every(issue=>latestProcessingIssues.has(String(issue||''))));
      const clsName=p.exportReady?'success':(latestDayPending?'warning':'danger');
      const title=p.exportReady?(p.totalRetryPending>0?'历史覆盖完整，可导出（仍有接口待重试）':'历史覆盖完整，可安全导出'):(latestDayPending?'当前最新日报尚未处理完成，区间导出暂不可用':'历史完整性未通过，已禁止静默缺数据导出');
      const timing=p.timing?.totalMs!==undefined?` · 只读检查耗时 ${fmt(p.timing.totalMs)}ms`:'';
      const snapshots=evidence.selectedCoreSnapshots!==undefined?` · 已核对快照 ${fmt(evidence.selectedCoreSnapshots)} 个`:'';
      let evidenceHtml='';
      if(diagnosticsSkipped){
        evidenceHtml=`<p class="muted"><b>安全读取模式：</b>已跳过 OPEN/扫描/轨迹的大表统计，避免它们阻塞主SQLite；这些项目是“未执行统计”，不是0票，也不会被拿来放宽导出安全判断。</p><p class="muted">当前安全判定仍严格依据：每日有效导入、核心快照/最终明细覆盖、WHPP日报与最终明细、CEAF来源归属。V456 对非零WHPP还要求日报完成标记与 exact finalizedSnapshotId 实体快照一致；任一必要读取失败或必要数据不完整都会阻止导出。</p>`;
      }else{
        const open=evidence.carryOpen||0,cls=evidence.carryClosed||0;
        const scopeFrom=evidence.carryOpenFromDate||p.fromDate,scopeTo=evidence.carryOpenToDate||p.toDate;
        const openBeforeRange=evidence.carryOpenBeforeRange||0,openInsideRangeBeforeTo=evidence.carryOpenInsideRangeBeforeTo||0,openOnToDate=evidence.carryOpenOnToDate||0,openThroughToDate=evidence.carryOpenThroughToDate||0;
        const historicalBeforeTo=openBeforeRange+openInsideRangeBeforeTo;
        const openReconciled=evidence.carryOpenRangeReconciled!==false&&evidence.carryOpenThroughToReconciled!==false;
        evidenceHtml=`<p>选定导出区间仍OPEN <b>${fmt(open)}</b> · 区间已闭环 <b>${fmt(cls)}</b> · WHPP待重试 <b>${fmt(p.totalRetryPending)}</b></p><p><b>OPEN精准对账：</b>区间起日前仍OPEN <b>${fmt(openBeforeRange)}</b> · 区间内历史OPEN（不含截止日） <b>${fmt(openInsideRangeBeforeTo)}</b> · 截止日当日OPEN <b>${fmt(openOnToDate)}</b> · 截至截止日全部OPEN <b>${fmt(openThroughToDate)}</b></p><p class="muted">当前日报口径仅用于核对：历史跨日未完结 = 区间起日前OPEN + 区间内历史OPEN = <b>${fmt(historicalBeforeTo)}</b>；当日未完结 = 截止日当日OPEN = <b>${fmt(openOnToDate)}</b>；当前OPEN总量 = 当日OPEN + 当前日前历史OPEN = 截至截止日全部OPEN = <b>${fmt(openThroughToDate)}</b>。历史审计不会回写或覆盖主页面OPEN数字。</p>${openReconciled?'':`<p class="danger-text">OPEN对账未闭合：SQLite分段统计与总数不一致，已保留原始值，请勿用该区间数字做导出判断。</p>`}${open?`<p class="muted">这里统计 sourceReportDate 位于 <b>${esc(scopeFrom)} 至 ${esc(scopeTo)}</b> 的 carryover OPEN；它不是当前日报“当前处理队列”。</p>`:''}`;
      }
      body.innerHTML=`<span class="status-pill ${clsName}">${esc(title)}</span><p><b>${esc(p.fromDate)} 至 ${esc(p.toDate)}</b> · 应有 ${fmt(p.expectedDays)} 天 · 已找到 ${fmt(p.daysPresent)} 天 · 总导入 ${fmt(p.totalImported)} 票${snapshots}${timing}</p><p>WHPP待重试 <b>${fmt(p.totalRetryPending)}</b></p>${evidenceHtml}${missing.length?`<p class="danger-text">缺少日期：${missing.map(esc).join('、')}</p>`:''}${incomplete.length?`<p class="${latestDayPending?'muted':'danger-text'}">待核对日期：${incomplete.slice(0,8).map(x=>`${esc(x.reportDate)}（${esc((x.issues||[]).join('/'))}${whppDiagnostic(x)}）`).join('；')}${incomplete.length>8?'…':''}</p>`:''}<p class="muted">导出执行严格7业务覆盖检查：CE、CEAF、TBKH、ALI1688、SHOPEE CN、SHOPEE VN、WHPP。当前最新日报未处理完成时只暂缓导出，不代表历史数据被删除。</p>`;
      lastLoadedAt=Date.now();
    }catch(error){
      const timedOut=error?.name==='AbortError';
      body.innerHTML=`<span class="status-pill danger">${timedOut?'历史完整性检查超过60秒，已停止等待；未修改任何数据':'历史完整性检查失败：'+esc(error.message)}</span>${timedOut?'<p class="muted">超时保护已释放按钮；不会因一个只读检查把页面永久锁在“正在读取”。不需要重新跑业务数据。</p>':''}`;
    }
    finally{clearTimeout(timer);auditRunning=false;if(button)button.disabled=false;}
  }
  function ensure(){if(visible())host();}
  document.addEventListener('click',e=>{if(e.target?.closest?.('[data-page="import"],.side-link[data-path="/import"]'))setTimeout(ensure,300);},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(ensure,800),{once:true});else setTimeout(ensure,800);
  global.__CE_QC_V142_HISTORY_AUDIT__={version:VERSION,v451UiId:V451_UI_ID,v456UiId:V456_UI_ID,refresh:load,get running(){return auditRunning;},get lastLoadedAt(){return lastLoadedAt;},automatic:false};
  console.info('[CE-QC][V142_HISTORY_AUDIT]',VERSION,V451_UI_ID,V456_UI_ID,'manual audit uses snapshot-indexed readonly reads and never mutates primary business data.');
})(window);
