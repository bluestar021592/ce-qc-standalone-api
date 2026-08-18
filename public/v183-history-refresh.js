(function installV183HistoryRefresh(global) {
  if (global.__CE_QC_V183_HISTORY_REFRESH__) return;
  global.__CE_QC_V183_HISTORY_REFRESH__ = true;
  const VERSION = '2026-08-18-v192-history-refresh-ui-manual-read-v1';
  const originalExport = typeof global.exportPeriodReport === 'function' ? global.exportPeriodReport.bind(global) : null;
  let pollTimer = null;
  let activeJob = '';
  let lastSummary = null;

  function apiJson(url, options = {}) {
    return fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options }).then(async response => {
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch {}
      if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
      return payload;
    });
  }
  function dateKey(date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
  function selectedRange() {
    const period = document.querySelector('.period-tab.active')?.dataset?.period || 'daily';
    const baseText = document.getElementById('periodExportDate')?.value || '';
    let fromDate = document.getElementById('periodExportFrom')?.value || '';
    let toDate = document.getElementById('periodExportTo')?.value || '';
    if (period === 'daily') fromDate = toDate = baseText;
    if ((period === 'weekly' || period === 'monthly') && baseText) {
      const base = new Date(`${baseText}T12:00:00+07:00`);
      if (period === 'weekly') {
        const day = (base.getDay() + 6) % 7;
        const from = new Date(base); from.setDate(base.getDate() - day);
        const to = new Date(from); to.setDate(from.getDate() + 6);
        fromDate = dateKey(from); toDate = dateKey(to);
      } else {
        fromDate = dateKey(new Date(base.getFullYear(), base.getMonth(), 1, 12));
        toDate = dateKey(new Date(base.getFullYear(), base.getMonth() + 1, 0, 12));
      }
    }
    return { fromDate, toDate };
  }
  function selection() {
    const businessType = String(document.getElementById('periodExportBusiness')?.value || '').toUpperCase();
    return { businessType, ...selectedRange() };
  }
  function supported(type) { return type === 'SHOPEECN' || type === 'SHOPEEVN'; }
  function fmt(value) { return Number(value || 0).toLocaleString('zh-CN'); }
  function fmtTime(value) {
    if (!value) return '尚未刷新';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Phnom_Penh', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23' }).format(date);
  }
  function ensureStyle() {
    if (document.getElementById('v183HistoryRefreshStyle')) return;
    const style = document.createElement('style');
    style.id = 'v183HistoryRefreshStyle';
    style.textContent = `
      #v183HistoryRefreshPanel{margin-top:16px}
      .v183-title{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
      .v183-title h3{margin:0 0 4px;color:#123a67}.v183-title p{margin:0;color:#6c7f96}
      .v183-actions{display:flex;gap:10px;flex-wrap:wrap}
      .v183-grid{display:grid;grid-template-columns:repeat(7,minmax(120px,1fr));gap:10px;margin-top:14px}
      .v183-card{border:1px solid #d9e6f3;border-radius:8px;background:#fff;padding:12px 14px;min-height:76px}
      .v183-card span{display:block;color:#70849d;font-size:13px}.v183-card b{display:block;color:#0b365f;font-size:24px;margin-top:5px}
      .v183-card small{display:block;color:#7b8da4;margin-top:3px}
      .v183-progress{margin-top:12px;border-top:1px solid #e5edf6;padding-top:12px;color:#46627f}
      .v183-progress-bar{height:8px;background:#edf3fa;border-radius:999px;overflow:hidden;margin:8px 0}.v183-progress-bar i{display:block;height:100%;background:#1f7af8;width:0;transition:width .25s}
      .v183-note{margin-top:10px;padding:10px 12px;border-radius:7px;background:#f5f9ff;color:#49637e}
      .v183-note.warn{background:#fff7e6;color:#946200}.v183-note.ok{background:#ecfbf3;color:#087a45}.v183-note.danger{background:#fff0f0;color:#b42318}
      @media(max-width:1300px){.v183-grid{grid-template-columns:repeat(4,minmax(120px,1fr))}}
    `;
    document.head.appendChild(style);
  }
  function ensurePanel() {
    const reports = document.getElementById('reportsPage');
    const exportPanel = reports?.querySelector('.period-export-panel');
    if (!reports || !exportPanel) return null;
    let panel = document.getElementById('v183HistoryRefreshPanel');
    if (!panel) {
      ensureStyle();
      panel = document.createElement('section');
      panel.id = 'v183HistoryRefreshPanel';
      panel.className = 'panel';
      panel.innerHTML = `
        <div class="v183-title">
          <div><h3>历史状态刷新 / 导出前复核</h3><p>刷新所选区间内仍非POD/退回/取消终态的历史票；终态票不重复请求。为避免大数据库阻塞导出，状态汇总改为手动读取。</p></div>
          <div class="v183-actions">
            <button id="v183ReadBtn" class="btn ghost" type="button">读取当前状态</button>
            <button id="v183RefreshBtn" class="btn ghost" type="button">刷新非终态状态</button>
            <button id="v183RefreshExportBtn" class="btn primary" type="button">刷新状态后导出</button>
          </div>
        </div>
        <div class="v183-grid">
          <div class="v183-card"><span>区间唯一票数</span><b id="v183Total">—</b><small>按首次日报归属</small></div>
          <div class="v183-card"><span>当前POD</span><b id="v183Pod">—</b><small>最新终态</small></div>
          <div class="v183-card"><span>当前已退回</span><b id="v183Returned">—</b><small>最新终态</small></div>
          <div class="v183-card"><span>当前Pending</span><b id="v183Pending">—</b><small id="v183PendingTimes">累计次数 —</small></div>
          <div class="v183-card"><span>派送中</span><b id="v183Delivering">—</b><small>当前状态</small></div>
          <div class="v183-card"><span>待刷新（非终态）</span><b id="v183Open">—</b><small id="v183Failed">接口待重试 —</small></div>
          <div class="v183-card"><span>最后状态更新时间</span><b id="v183RefreshTime" style="font-size:14px;line-height:1.45">—</b><small>柬埔寨时间</small></div>
        </div>
        <div id="v183Progress" class="v183-progress" hidden><strong id="v183ProgressText">准备中</strong><div class="v183-progress-bar"><i id="v183ProgressFill"></i></div><small id="v183ProgressMeta"></small></div>
        <div id="v183Note" class="v183-note">已关闭自动状态读取。需要复核时点“读取当前状态”；直接导出不会再被历史汇总查询抢占主进程。</div>
      `;
      exportPanel.insertAdjacentElement('afterend', panel);
      panel.querySelector('#v183ReadBtn').addEventListener('click', () => readSummary(true));
      panel.querySelector('#v183RefreshBtn').addEventListener('click', () => startRefresh(false));
      panel.querySelector('#v183RefreshExportBtn').addEventListener('click', () => startRefresh(true));
    }
    return panel;
  }
  function setBusy(busy) {
    for (const id of ['v183ReadBtn','v183RefreshBtn','v183RefreshExportBtn']) {
      const node = document.getElementById(id); if (node) node.disabled = busy;
    }
  }
  function note(text, tone = '') {
    const node = document.getElementById('v183Note');
    if (!node) return;
    node.className = `v183-note ${tone}`.trim(); node.textContent = text;
  }
  function resetSummaryUi() {
    lastSummary = null;
    const values = {
      v183Total:'—', v183Pod:'—', v183Returned:'—', v183Pending:'—', v183PendingTimes:'累计次数 —',
      v183Delivering:'—', v183Open:'—', v183Failed:'接口待重试 —', v183RefreshTime:'—'
    };
    for (const [id, value] of Object.entries(values)) { const node = document.getElementById(id); if (node) node.textContent = value; }
  }
  function showSummary(summary) {
    lastSummary = summary;
    const set = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
    const toRefresh = Number(summary.toRefresh ?? summary.open ?? 0);
    set('v183Total', fmt(summary.total)); set('v183Pod', fmt(summary.pod)); set('v183Returned', fmt(summary.returned));
    set('v183Pending', fmt(summary.pending)); set('v183PendingTimes', `累计Pending次数 ${fmt(summary.pendingTimes)}`);
    set('v183Delivering', fmt(summary.delivering)); set('v183Open', fmt(toRefresh)); set('v183Failed', `接口待重试 ${fmt(summary.failed)}`);
    set('v183RefreshTime', fmtTime(summary.lastRefreshAt));
    if (toRefresh > 0) note(`当前还有 ${fmt(toRefresh)} 票不是POD/退回/取消终态。导出前如需最新状态，可点“刷新状态后导出”。`, 'warn');
    else note('该区间当前全部已进入POD/退回/取消终态，可直接导出。', 'ok');
  }
  function syncSelectionUi({ reset = false } = {}) {
    const panel = ensurePanel(); if (!panel) return;
    const sel = selection();
    const enabled = supported(sel.businessType) && sel.fromDate && sel.toDate;
    panel.querySelectorAll('button').forEach(button => { if (!activeJob) button.disabled = !enabled; });
    if (reset) resetSummaryUi();
    if (!supported(sel.businessType)) {
      note('历史状态刷新中心当前先用于 SHOPEE CN / SHOPEE VN；请选择其中一个完整表。');
      return;
    }
    if (!sel.fromDate || !sel.toDate) {
      note('请先选择有效日期范围。', 'warn');
      return;
    }
    note('已关闭自动状态读取，避免2GB+数据库汇总查询阻塞导出。可直接点上方“一键导出全部报表”；需要复核时再手动点“读取当前状态”。');
  }
  async function readSummary(userAction = false) {
    const panel = ensurePanel(); if (!panel) return null;
    const sel = selection();
    const enabled = supported(sel.businessType) && sel.fromDate && sel.toDate;
    panel.querySelectorAll('button').forEach(button => { if (!activeJob) button.disabled = !enabled; });
    if (!supported(sel.businessType)) {
      note('历史状态刷新中心当前先用于 SHOPEE CN / SHOPEE VN；请选择其中一个完整表。');
      return null;
    }
    if (!sel.fromDate || !sel.toDate) { note('请先选择有效日期范围。', 'warn'); return null; }
    if (userAction) setBusy(true);
    try {
      const q = new URLSearchParams(sel);
      const summary = await apiJson(`/api/v183/history-refresh/summary?${q}`);
      showSummary(summary);
      return summary;
    } catch (error) {
      note(`状态读取失败：${error.message || error}`, 'danger');
      return null;
    } finally { if (userAction && !activeJob) setBusy(false); }
  }
  function progress(job) {
    const wrap = document.getElementById('v183Progress'); if (!wrap) return;
    wrap.hidden = false;
    const pct = Math.max(0, Math.min(100, Number(job.progress || 0)));
    const fill = document.getElementById('v183ProgressFill'); if (fill) fill.style.width = `${pct}%`;
    const text = document.getElementById('v183ProgressText'); if (text) text.textContent = job.message || `处理中 ${pct}%`;
    const meta = document.getElementById('v183ProgressMeta'); if (meta) meta.textContent = `进度 ${pct}% · 已处理 ${fmt(job.completed || 0)}/${fmt(job.total || 0)} · 成功 ${fmt(job.refreshed || 0)} · 待重试 ${fmt(job.failed || 0)}`;
  }
  async function pollJob(jobId, autoExport) {
    activeJob = jobId; setBusy(true);
    let transient = 0;
    while (activeJob === jobId) {
      try {
        const job = await apiJson(`/api/v183/history-refresh/job/${encodeURIComponent(jobId)}`);
        transient = 0; progress(job);
        const status = String(job.status || '').toUpperCase();
        if (status === 'COMPLETED') {
          activeJob = ''; setBusy(false);
          if (job.after) showSummary(job.after); else await readSummary(false);
          note(`${job.message || '刷新完成'}${autoExport ? '，正在生成刷新后的完整Excel…' : ''}`, 'ok');
          if (autoExport && originalExport) setTimeout(() => originalExport(), 200);
          return;
        }
        if (status === 'FAILED' || status === 'CANCELLED') {
          activeJob = ''; setBusy(false); note(`历史状态刷新失败：${job.message || job.error || status}`, 'danger'); return;
        }
      } catch (error) {
        transient += 1;
        if (transient >= 8) { activeJob = ''; setBusy(false); note(`刷新任务连接中断：${error.message || error}`, 'danger'); return; }
        note(`后台仍在刷新，页面连接正在恢复（${transient}/8）…`, 'warn');
      }
      await new Promise(resolve => { pollTimer = setTimeout(resolve, 1500); });
    }
  }
  async function startRefresh(autoExport) {
    const sel = selection();
    if (!supported(sel.businessType)) return note('请先选择“仅SHOPEE CN完整表”或“仅SHOPEE VN完整表”。', 'warn');
    if (!sel.fromDate || !sel.toDate) return note('请先选择有效日期范围。', 'warn');
    setBusy(true); note('正在创建历史非终态状态刷新任务…');
    try {
      const job = await apiJson('/api/v183/history-refresh/start', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(sel) });
      activeJob = job.jobId; progress(job); void pollJob(job.jobId, autoExport);
    } catch (error) {
      activeJob = ''; setBusy(false); note(`无法开始刷新：${error.message || error}`, 'danger');
    }
  }
  function refreshUiSoon(reset = false) { setTimeout(() => syncSelectionUi({ reset }), 0); }
  for (const id of ['periodExportDate','periodExportFrom','periodExportTo','periodExportBusiness']) document.getElementById(id)?.addEventListener('change', () => refreshUiSoon(true));
  document.querySelectorAll('.period-tab').forEach(button => button.addEventListener('click', () => refreshUiSoon(true)));
  if (typeof global.renderReportsPage === 'function') {
    const originalRender = global.renderReportsPage;
    global.renderReportsPage = function v192RenderReportsPage(...args) { const result = originalRender.apply(this, args); refreshUiSoon(false); return result; };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => refreshUiSoon(false), { once:true }); else refreshUiSoon(false);
  console.info('[CE-QC][V192_HISTORY_REFRESH_UI]', VERSION, 'automatic summary reads disabled');
})(window);
