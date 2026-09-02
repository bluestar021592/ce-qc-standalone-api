(function installV142HistoryAudit(global){
  if(global.__CE_QC_V142_HISTORY_AUDIT__)return;global.__CE_QC_V142_HISTORY_AUDIT__=true;
  const VERSION='2026-09-02-v419-manual-only-history-audit-no-open-mutation-v4';
  // V388 compatibility wording gate:
  // 当前处理队列 = 当日OPEN + 当前日前历史OPEN
  // 它不是当前日报“当前处理队列”
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const fmt=v=>Number(v||0).toLocaleString('zh-CN');
  let auditRunning=false;
  let lastLoadedAt=0;

  function visible(){return location.pathname==='/import'||document.getElementById('importPage')?.classList?.contains('active');}
  function host(){
    const page=document.getElementById('importPage');if(!page)return null;
    let panel=document.getElementById('v142HistoryAudit');if(panel)return panel;
    panel=document.createElement('section');panel.id='v142HistoryAudit';panel.className='panel operation-panel';
    panel.innerHTML=`<div class="panel-title"><div><h3>历史数据完整性 / 导出安全检查</h3><p>27GB大库下关闭自动历史全量扫描；仅在你需要导出/核对历史时手动执行，只读、不修改数据。</p></div><span class="status-pill muted">手动检查</span></div><div id="v142AuditBody" class="operation-status"><span class="status-pill muted">未执行历史全量检查</span><p class="muted">正常日报上传、七业务状态确认、统一处理、扫描和轨迹查询不会自动触发本检查，避免历史重查询占用主SQLite。</p></div><div class="button-row" style="margin-top:10px"><button id="v142AuditRefresh" class="btn ghost compact" type="button">立即重新检查</button></div>`;
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
    body.innerHTML='<span class="status-pill warning">正在手动只读核对历史日报、快照、OPEN对账和7业务导出覆盖…</span><p class="muted">检查期间请不要重复点击；检查完成后不会改写当前日报OPEN或七业务处理状态。</p>';
    try{
      const r=await fetch('/api/v142/history-integrity?fromDate=2026-07-01',{cache:'no-store',credentials:'same-origin'});
      const p=await r.json();if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);
      const missing=p.missingDates||[],incomplete=p.incompleteDates||[],evidence=p.currentEvidence||{};
      const open=evidence.carryOpen||0,cls=evidence.carryClosed||0;
      const scopeFrom=evidence.carryOpenFromDate||p.fromDate,scopeTo=evidence.carryOpenToDate||p.toDate;
      const openBeforeRange=evidence.carryOpenBeforeRange||0,openInsideRangeBeforeTo=evidence.carryOpenInsideRangeBeforeTo||0,openOnToDate=evidence.carryOpenOnToDate||0,openThroughToDate=evidence.carryOpenThroughToDate||0;
      const historicalBeforeTo=openBeforeRange+openInsideRangeBeforeTo;
      const openReconciled=evidence.carryOpenRangeReconciled!==false&&evidence.carryOpenThroughToReconciled!==false;
      const latestProcessingIssues=new Set(['CORE_SNAPSHOT_NOT_COMPLETED','WHPP_SNAPSHOT_MISSING','WHPP_FINAL_ROWS_INCOMPLETE']);
      const latestDayPending=missing.length===0&&incomplete.length>0&&incomplete.every(x=>String(x.reportDate||'')===String(p.toDate||'')&&(x.issues||[]).length>0&&(x.issues||[]).every(issue=>latestProcessingIssues.has(String(issue||''))));
      const clsName=p.exportReady?'success':(latestDayPending?'warning':'danger');
      const title=p.exportReady?(p.totalRetryPending>0?'历史覆盖完整，可导出（仍有接口待重试）':'历史覆盖完整，可安全导出'):(latestDayPending?'当前最新日报尚未处理完成，区间导出暂不可用':'历史完整性未通过，已禁止静默缺数据导出');
      body.innerHTML=`<span class="status-pill ${clsName}">${esc(title)}</span><p><b>${esc(p.fromDate)} 至 ${esc(p.toDate)}</b> · 应有 ${fmt(p.expectedDays)} 天 · 已找到 ${fmt(p.daysPresent)} 天 · 总导入 ${fmt(p.totalImported)} 票</p><p>选定导出区间仍OPEN <b>${fmt(open)}</b> · 区间已闭环 <b>${fmt(cls)}</b> · WHPP待重试 <b>${fmt(p.totalRetryPending)}</b></p><p><b>OPEN精准对账：</b>区间起日前仍OPEN <b>${fmt(openBeforeRange)}</b> · 区间内历史OPEN（不含截止日） <b>${fmt(openInsideRangeBeforeTo)}</b> · 截止日当日OPEN <b>${fmt(openOnToDate)}</b> · 截至截止日全部OPEN <b>${fmt(openThroughToDate)}</b></p><p class="muted">当前日报口径仅用于核对：历史跨日未完结 = 区间起日前OPEN + 区间内历史OPEN = <b>${fmt(historicalBeforeTo)}</b>；当日未完结 = 截止日当日OPEN = <b>${fmt(openOnToDate)}</b>；当前OPEN总量 = 当日OPEN + 当前日前历史OPEN = 截至截止日全部OPEN = <b>${fmt(openThroughToDate)}</b>。历史审计不会回写或覆盖主页面OPEN数字。</p>${openReconciled?'':`<p class="danger-text">OPEN对账未闭合：SQLite分段统计与总数不一致，已保留原始值，请勿用该区间数字做导出判断。</p>`}${open?`<p class="muted">这里统计 sourceReportDate 位于 <b>${esc(scopeFrom)} 至 ${esc(scopeTo)}</b> 的 carryover OPEN；它不是当前日报“当前处理队列”。所有数字均为SQLite实时只读统计。</p>`:''}${missing.length?`<p class="danger-text">缺少日期：${missing.map(esc).join('、')}</p>`:''}${incomplete.length?`<p class="${latestDayPending?'muted':'danger-text'}">待核对日期：${incomplete.slice(0,8).map(x=>`${esc(x.reportDate)}（${esc((x.issues||[]).join('/'))}）`).join('；')}${incomplete.length>8?'…':''}</p>`:''}<p class="muted">导出执行严格7业务覆盖检查：CE、CEAF、TBKH、ALI1688、SHOPEE CN、SHOPEE VN、WHPP。当前最新日报未处理完成时只暂缓导出，不代表历史数据被删除或本次导入多出了异常票。</p>`;
      lastLoadedAt=Date.now();
    }catch(error){body.innerHTML=`<span class="status-pill danger">历史完整性检查失败：${esc(error.message)}</span>`;}
    finally{auditRunning=false;if(button)button.disabled=false;}
  }
  function ensure(){if(visible())host();}
  document.addEventListener('click',e=>{if(e.target?.closest?.('[data-page="import"],.side-link[data-path="/import"]'))setTimeout(ensure,300);},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(ensure,800),{once:true});else setTimeout(ensure,800);
  global.__CE_QC_V142_HISTORY_AUDIT__={version:VERSION,refresh:load,get running(){return auditRunning;},get lastLoadedAt(){return lastLoadedAt;},automatic:false};
  console.info('[CE-QC][V142_HISTORY_AUDIT]',VERSION,'automatic history audit disabled; manual read-only audit never mutates primary OPEN.');
})(window);