(function installV142HistoryAudit(global){
  if(global.__CE_QC_V142_HISTORY_AUDIT__)return;global.__CE_QC_V142_HISTORY_AUDIT__=true;
  const VERSION='2026-09-15-v543-isolated-history-audit-ui-v1';
  const V451_UI_ID='2026-09-07-v451-snapshot-indexed-history-audit-ui-v1';
  const V456_UI_ID='2026-09-08-v456-whpp-authority-diagnostic-ui-v1';
  const V457_UI_ID='2026-09-08-v457-whpp-legacy-completion-attestation-ui-v1';
  const V460_UI_ID='2026-09-08-v460-whpp-history-snapshot-disambiguation-ui-v1';
  const V470_UI_ID='2026-09-08-v470-whpp-current-vs-retained-retry-display-v1';
  const V543_UI_ID='2026-09-15-v543-background-readonly-history-audit-poll-v1';
  const REQUEST_TIMEOUT_MS=15000;
  const OVERALL_WAIT_MS=16*60*1000;
  const POLL_MS=1500;
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=v=>Number(v||0).toLocaleString('zh-CN');
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const whppReasonLabel=reason=>({
    WHPP_DAILY_REPORT_MISSING:'WHPP日报不存在',WHPP_ZERO_TICKET_DAILY:'WHPP当日0票',WHPP_DAILY_NOT_COMPLETED:'WHPP日报未形成正式完成标记',
    WHPP_FINALIZED_SNAPSHOT_ID_MISSING:'WHPP日报显示完成但缺少 finalizedSnapshotId',WHPP_FINALIZED_SNAPSHOT_ROW_MISSING:'WHPP日报已有 finalizedSnapshotId，但对应实体快照不存在',
    WHPP_FINALIZED_SNAPSHOT_INVALID_OR_FAILED:'WHPP最终快照已被标记为 INVALID/FAILED',WHPP_VALID_COMPLETED_SNAPSHOT:'WHPP存在 VALID+COMPLETED 最终快照',
    WHPP_LEGACY_FINALIZED_SNAPSHOT_ATTESTED:'WHPP旧版最终快照已由日报精确证明',WHPP_LEGACY_COMPLETION_METADATA_LOST_ATTESTED:'WHPP旧版完成元数据曾被覆盖，现有历史事实已只读精确证明完成',
    WHPP_LEGACY_DAILY_MEMBERSHIP_INCOMPLETE:'WHPP旧版日报成员不完整，不能恢复完成态',WHPP_LEGACY_FINAL_COVERAGE_INCOMPLETE:'WHPP旧版日报成员最终明细覆盖不完整，不能恢复完成态',
    WHPP_LEGACY_SNAPSHOT_AMBIGUOUS:'WHPP历史证明snapshotId对应多个可用快照，不能确定唯一实体',WHPP_LEGACY_SNAPSHOT_MISSING:'WHPP旧版完成快照不存在',
    WHPP_LEGACY_HISTORY_ATTESTATION_MISSING:'WHPP历史汇总缺少完成快照证明',WHPP_LEGACY_HISTORY_SNAPSHOT_MISMATCH:'WHPP历史汇总snapshotId未命中同日可用快照'
  }[String(reason||'')]||String(reason||'未知'));
  function whppDiagnostic(item={}){
    const w=item.whpp;if(!w)return '';
    const finalId=w.finalizedSnapshotId?esc(w.finalizedSnapshotId):'无',status=w.dailySnapshotStatus?esc(w.dailySnapshotStatus):'无',historyId=w.historySnapshotId?esc(w.historySnapshotId):'无';
    return `；WHPP诊断：${esc(whppReasonLabel(w.authorityReason))}；日报 ${fmt(w.reported)} / 成员 ${fmt(w.dailyRows)} / 成员最终覆盖 ${fmt(w.coveredDailyRows)} / 最终明细 ${fmt(w.finalRows)}；日报完成=${w.completedFlag?'是':'否'}，状态=${status}，finalizedSnapshotId=${finalId}，历史证明snapshotId=${historyId}，同日快照候选=${fmt(w.snapshotCandidateCount)}，可用候选=${fmt(w.viableSnapshotCandidateCount)}，历史精确命中=${fmt(w.attestedSnapshotCandidateCount)}`;
  }
  function retryDisplayTruth(payload={}){
    const raw=Math.max(0,Number(payload.totalRetryPending||0));let retained=0;
    for(const day of payload.days||[]){const w=day?.whpp||{},snapshotId=String(w.snapshotId||w.finalizedSnapshotId||'');if(/-V464-/i.test(snapshotId))retained+=Math.max(0,Number(w.retryPending||0));}
    retained=Math.min(raw,retained);return{raw,current:Math.max(0,raw-retained),retained};
  }
  async function requestJson(url){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort('V543_HISTORY_AUDIT_HTTP_TIMEOUT'),REQUEST_TIMEOUT_MS);
    try{
      const r=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
      const raw=await r.text();let p=null;try{p=raw?JSON.parse(raw):{};}catch{throw new Error(`HTTP ${r.status} 返回了非JSON响应`);}
      return{r,p};
    }finally{clearTimeout(timer);}
  }
  async function runBackgroundAudit(body){
    const startedAt=Date.now();
    const first=await requestJson('/api/v142/history-integrity?fromDate=2026-07-01');
    if(!first.r.ok&&first.r.status!==202)throw new Error(first.p?.error||`HTTP ${first.r.status}`);
    if(first.r.status!==202||!first.p?.pending)return first.p;
    const jobId=String(first.p.jobId||'');if(!jobId)throw new Error('后台历史检查未返回任务编号。');
    const statusUrl=String(first.p.statusUrl||`/api/v142/history-integrity-job/${encodeURIComponent(jobId)}`);
    while(Date.now()-startedAt<OVERALL_WAIT_MS){
      await sleep(POLL_MS);
      const elapsed=Math.max(1,Math.round((Date.now()-startedAt)/1000));
      body.innerHTML=`<span class="status-pill warning">后台只读核对进行中… ${elapsed}秒</span><p class="muted">V543 已把27GB历史审计移出5177主进程；页面、看板和接口不会再被同步SQLite扫描卡住。不会重跑日报、扫描或轨迹，也不会修改业务数据。</p>`;
      const state=await requestJson(statusUrl);
      if(state.r.status===202&&state.p?.pending)continue;
      if(!state.r.ok||state.p?.ok===false)throw new Error(state.p?.error||`HTTP ${state.r.status}`);
      return state.p;
    }
    throw new Error('后台历史完整性检查超过16分钟等待上限；只读任务会按服务端安全上限停止，未修改任何业务数据。');
  }
  let auditRunning=false,lastLoadedAt=0;
  function visible(){return location.pathname==='/import'||document.getElementById('importPage')?.classList?.contains('active');}
  function host(){
    const page=document.getElementById('importPage');if(!page)return null;let panel=document.getElementById('v142HistoryAudit');if(panel)return panel;
    panel=document.createElement('section');panel.id='v142HistoryAudit';panel.className='panel operation-panel';
    panel.innerHTML=`<div class="panel-title"><div><h3>历史数据完整性 / 导出安全检查</h3><p>27GB大库使用后台只读索引核对；不重跑日报、不重跑扫描/轨迹，也不修改现有业务数据。</p></div><span class="status-pill muted">手动检查</span></div><div id="v142AuditBody" class="operation-status"><span class="status-pill muted">未执行历史完整性检查</span><p class="muted">正常日报上传、七业务状态确认、统一处理、扫描和轨迹查询不会自动触发本检查。</p></div><div class="button-row" style="margin-top:10px"><button id="v142AuditRefresh" class="btn ghost compact" type="button">立即重新检查</button></div>`;
    page.appendChild(panel);panel.querySelector('#v142AuditRefresh')?.addEventListener('click',()=>void load());return panel;
  }
  async function load(){
    if(!visible())return;const panel=host();if(!panel||auditRunning)return;auditRunning=true;
    const body=panel.querySelector('#v142AuditBody'),button=panel.querySelector('#v142AuditRefresh');if(button)button.disabled=true;
    body.innerHTML='<span class="status-pill warning">正在启动后台只读历史检查…</span><p class="muted">V543 将历史SQLite核对放到独立只读进程，5177主页面不再执行长时间同步扫描。</p>';
    try{
      const p=await runBackgroundAudit(body);if(!p||p.ok===false)throw new Error(p?.error||'历史完整性检查失败');
      const missing=p.missingDates||[],incomplete=p.incompleteDates||[],evidence=p.currentEvidence||{};
      const diagnosticsSkipped=evidence.heavyDiagnosticCountsSkipped===true,recoveredDays=Number(evidence.whppLegacyMetadataRecoveredDays||0),retryTruth=retryDisplayTruth(p);
      const latestProcessingIssues=new Set(['CORE_SNAPSHOT_NOT_COMPLETED','WHPP_SNAPSHOT_MISSING','WHPP_FINAL_ROWS_INCOMPLETE']);
      const latestDayPending=missing.length===0&&incomplete.length>0&&incomplete.every(x=>String(x.reportDate||'')===String(p.toDate||'')&&(x.issues||[]).length>0&&(x.issues||[]).every(issue=>latestProcessingIssues.has(String(issue||''))));
      const clsName=p.exportReady?'success':(latestDayPending?'warning':'danger');
      const title=p.exportReady?(retryTruth.current>0?'历史覆盖完整，可导出（仍有当前接口待重试）':'历史覆盖完整，可安全导出'):(latestDayPending?'当前最新日报尚未处理完成，区间导出暂不可用':'历史完整性未通过，已禁止静默缺数据导出');
      const timing=p.timing?.totalMs!==undefined?` · 只读检查耗时 ${fmt(p.timing.totalMs)}ms`:'';
      const snapshots=evidence.selectedCoreSnapshots!==undefined?` · 已核对快照 ${fmt(evidence.selectedCoreSnapshots)} 个`:'';
      const recoveredHtml=recoveredDays?`<p class="muted"><b>旧版WHPP完成态只读恢复：</b>已有 <b>${fmt(recoveredDays)}</b> 天通过严格历史证明。恢复条件同时要求：完成字段确实缺失、日报成员精确完整、每个成员具有同日最终明细、历史汇总 snapshotId 在同日未作废快照中精确且唯一命中。其它同日旧快照只保留为审计历史，不会覆盖该精确证明。仅恢复导出资格，不回写数据库。</p>`:'';
      const retryHtml=`<p>当前接口待重试 <b>${fmt(retryTruth.current)}</b>${retryTruth.retained>0?` · 历史retry标记保留 <b>${fmt(retryTruth.retained)}</b> <span class="muted">（V464离线恢复审计事实，不需重跑）</span>`:''}</p>`;
      let evidenceHtml='';
      if(diagnosticsSkipped){
        evidenceHtml=`<p class="muted"><b>安全读取模式：</b>已跳过 OPEN/扫描/轨迹的大表统计；这些项目是“未执行统计”，不是0票，也不会被拿来放宽导出安全判断。</p><p class="muted">当前安全判定仍严格依据：每日有效导入、核心快照/最终明细覆盖、WHPP日报与最终明细、CEAF来源归属。现代WHPP要求日报完成标记与 exact finalizedSnapshotId 实体快照一致；旧版日期只能由严格历史证明只读恢复。任一必要读取失败或数据不完整都会阻止导出。</p>`;
      }else{
        const open=evidence.carryOpen||0,cls=evidence.carryClosed||0,scopeFrom=evidence.carryOpenFromDate||p.fromDate,scopeTo=evidence.carryOpenToDate||p.toDate;
        const openBeforeRange=evidence.carryOpenBeforeRange||0,openInsideRangeBeforeTo=evidence.carryOpenInsideRangeBeforeTo||0,openOnToDate=evidence.carryOpenOnToDate||0,openThroughToDate=evidence.carryOpenThroughToDate||0;
        const historicalBeforeTo=openBeforeRange+openInsideRangeBeforeTo,openReconciled=evidence.carryOpenRangeReconciled!==false&&evidence.carryOpenThroughToReconciled!==false;
        evidenceHtml=`<p>选定导出区间仍OPEN <b>${fmt(open)}</b> · 区间已闭环 <b>${fmt(cls)}</b></p><p><b>OPEN精准对账：</b>区间起日前仍OPEN <b>${fmt(openBeforeRange)}</b> · 区间内历史OPEN（不含截止日） <b>${fmt(openInsideRangeBeforeTo)}</b> · 截止日当日OPEN <b>${fmt(openOnToDate)}</b> · 截至截止日全部OPEN <b>${fmt(openThroughToDate)}</b></p><p class="muted">历史跨日未完结 = <b>${fmt(historicalBeforeTo)}</b>；当日未完结 = <b>${fmt(openOnToDate)}</b>；截至截止日全部OPEN = <b>${fmt(openThroughToDate)}</b>。历史审计不会回写主页面数字。</p>${openReconciled?'':`<p class="danger-text">OPEN对账未闭合，已保留原始值，请勿用该区间数字做导出判断。</p>`}${open?`<p class="muted">这里统计 sourceReportDate 位于 <b>${esc(scopeFrom)} 至 ${esc(scopeTo)}</b> 的 carryover OPEN。</p>`:''}`;
      }
      body.innerHTML=`<span class="status-pill ${clsName}">${esc(title)}</span><p><b>${esc(p.fromDate)} 至 ${esc(p.toDate)}</b> · 应有 ${fmt(p.expectedDays)} 天 · 已找到 ${fmt(p.daysPresent)} 天 · 总导入 ${fmt(p.totalImported)} 票${snapshots}${timing}</p>${retryHtml}${evidenceHtml}${recoveredHtml}${missing.length?`<p class="danger-text">缺少日期：${missing.map(esc).join('、')}</p>`:''}${incomplete.length?`<p class="${latestDayPending?'muted':'danger-text'}">待核对日期：${incomplete.slice(0,8).map(x=>`${esc(x.reportDate)}（${esc((x.issues||[]).join('/'))}${whppDiagnostic(x)}）`).join('；')}${incomplete.length>8?'…':''}</p>`:''}<p class="muted">导出执行严格7业务覆盖检查：CE、CEAF、TBKH、ALI1688、SHOPEE CN、SHOPEE VN、WHPP。当前最新日报未处理完成时只暂缓导出，不代表历史数据被删除。</p>`;
      lastLoadedAt=Date.now();
    }catch(error){
      const message=error?.name==='AbortError'?'历史检查状态请求超时，请稍后重新点击；后台只读任务不会修改数据。':String(error?.message||error);
      body.innerHTML=`<span class="status-pill danger">历史完整性检查失败：${esc(message)}</span><p class="muted">不需要重新跑日报、扫描、轨迹或历史业务数据。</p>`;
    }finally{auditRunning=false;if(button)button.disabled=false;}
  }
  function ensure(){if(visible())host();}
  document.addEventListener('click',e=>{if(e.target?.closest?.('[data-page="import"],.side-link[data-path="/import"]'))setTimeout(ensure,300);},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(ensure,800),{once:true});else setTimeout(ensure,800);
  global.__CE_QC_V142_HISTORY_AUDIT__={version:VERSION,v451UiId:V451_UI_ID,v456UiId:V456_UI_ID,v457UiId:V457_UI_ID,v460UiId:V460_UI_ID,v470UiId:V470_UI_ID,v543UiId:V543_UI_ID,refresh:load,get running(){return auditRunning;},get lastLoadedAt(){return lastLoadedAt;},automatic:false};
  console.info('[CE-QC][V142_HISTORY_AUDIT]',VERSION,V543_UI_ID,'manual audit runs in an isolated read-only child and polls durable in-process job state; no business-data mutation or CE network call.');
})(window);