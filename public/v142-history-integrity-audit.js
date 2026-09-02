(function installV142HistoryAudit(global){
  if(global.__CE_QC_V142_HISTORY_AUDIT__)return;global.__CE_QC_V142_HISTORY_AUDIT__=true;
  const VERSION='2026-09-02-v419-low-priority-history-audit-no-open-mutation-v1';
  // V388 compatibility wording gate:
  // 当前处理队列 = 当日OPEN + 当前日前历史OPEN
  // 它不是当前日报“当前处理队列”
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const fmt=v=>Number(v||0).toLocaleString('zh-CN');
  let auditTimer=0;
  let auditRunning=false;
  let lastLoadedAt=0;

  function visible(){return location.pathname==='/import'||document.getElementById('importPage')?.classList?.contains('active');}
  function statusPriorityBusy(){
    const truth=global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__?.lastTruth;
    if(!truth)return false;
    if(truth.statusFresh===false)return true;
    return Array.isArray(truth.stages)&&truth.stages.some(stage=>stage?.running===true||String(stage?.state||'').toLowerCase()==='running');
  }
  function host(){
    const page=document.getElementById('importPage');if(!page)return null;
    let panel=document.getElementById('v142HistoryAudit');if(panel)return panel;
    panel=document.createElement('section');panel.id='v142HistoryAudit';panel.className='panel operation-panel';
    panel.innerHTML=`<div class="panel-title"><div><h3>历史数据完整性 / 导出安全检查</h3><p>只读检查SQLite，不修改、不删除任何历史数据；前台日报状态确认优先。</p></div><span class="status-pill muted">7业务</span></div><div id="v142AuditBody" class="operation-status">历史检查将在前台状态确认完成后的空闲时段执行…</div><div class="button-row" style="margin-top:10px"><button id="v142AuditRefresh" class="btn ghost compact" type="button">立即重新检查</button></div>`;
    page.appendChild(panel);
    panel.querySelector('#v142AuditRefresh')?.addEventListener('click',()=>void load({manual:true}));
    return panel;
  }
  function schedule(delay=2500){
    if(auditTimer)clearTimeout(auditTimer);
    auditTimer=setTimeout(()=>{
      auditTimer=0;
      if(!visible())return;
      const run=()=>{
        if(statusPriorityBusy()){schedule(2500);return;}
        void load();
      };
      if(typeof global.requestIdleCallback==='function')global.requestIdleCallback(run,{timeout:4000});
      else run();
    },Math.max(500,Number(delay)||2500));
  }
  async function load({manual=false}={}){
    if(!visible())return;
    const panel=host();if(!panel)return;
    if(auditRunning){if(manual)schedule(800);return;}
    if(!manual&&statusPriorityBusy()){schedule(2500);return;}
    auditRunning=true;
    const body=panel.querySelector('#v142AuditBody');
    body.innerHTML='<span class="status-pill warning">正在低优先级只读核对历史日报、快照、OPEN对账和7业务导出覆盖…</span>';
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
    finally{auditRunning=false;}
  }
  function ensure(){if(!visible())return;host();schedule(2500);}
  document.addEventListener('click',e=>{if(e.target?.closest?.('[data-page="import"],.side-link[data-path="/import"]'))setTimeout(ensure,500);},true);
  document.addEventListener('ce-qc-run-complete',()=>schedule(3000));
  document.addEventListener('change',e=>{if(e.target&&e.target.id==='reportDate')schedule(1800);},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(ensure,1200),{once:true});else setTimeout(ensure,1200);
  global.__CE_QC_V142_HISTORY_AUDIT__={version:VERSION,refresh:()=>load({manual:true}),schedule,get running(){return auditRunning;},get lastLoadedAt(){return lastLoadedAt;}};
  console.info('[CE-QC][V142_HISTORY_AUDIT]',VERSION,'history audit is low priority and never mutates the primary current OPEN display.');
})(window);