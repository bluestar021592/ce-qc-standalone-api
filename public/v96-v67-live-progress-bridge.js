(function installV96V67LiveProgressBridge(global) {
  if (global.__CE_QC_V96_V67_LIVE_PROGRESS_BRIDGE__) return;
  global.__CE_QC_V96_V67_LIVE_PROGRESS_BRIDGE__ = true;

  const POLL_MS = 1200;
  let polling = false;

  function activeUi() {
    const button = document.querySelector('[data-testid="global-auto-process"]');
    const status = document.getElementById('ccslRunStatus');
    if (!button || !status || !button.disabled) return null;
    const text = `${button.textContent || ''} ${status.textContent || ''}`;
    if (!/处理中|正在检查|正在启动|七业务|CCSL|SHOPEE/i.test(text)) return null;
    return { button, status };
  }

  async function readProgress(type) {
    try {
      const response = await fetch(`/api/v33/run-progress?businessType=${encodeURIComponent(type)}`, {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  function phaseOf(progress) {
    const raw = String(progress?.phase || '').trim();
    if (/扫描|scan|order/i.test(raw)) {
      return { label: '订单扫描', done: Number(progress.scanDone || 0), total: Number(progress.scanTotal || 0) };
    }
    if (/轨迹|track/i.test(raw)) {
      return { label: '轨迹查询', done: Number(progress.trackDone || 0), total: Number(progress.trackTotal || 0) };
    }
    return { label: raw || '准备处理', done: Number(progress.done || 0), total: Number(progress.total || 0) };
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function render(ui, progress) {
    const phase = phaseOf(progress);
    const batch = Number(progress.batchIndex || 0);
    const batches = Number(progress.totalBatches || 0);
    const batchText = batches > 0 ? ` · 当前批次 ${batch || 1}/${batches}` : '';
    const last = String(progress.lastMessage || '').trim();
    ui.status.innerHTML = `<span class="status-pill warning">${escapeHtml(progress.businessType)} 正在处理 · ${escapeHtml(phase.label)}</span>`
      + `<p>${escapeHtml(phase.label)}进度：${phase.done} / ${phase.total}${batchText}</p>`
      + '<p class="muted">后台正在持续处理；每个批次完成后数字会自动更新，不需要重复点击。</p>'
      + (last ? `<p class="muted">${escapeHtml(last)}</p>` : '');
    ui.button.textContent = `${progress.businessType} ${phase.label} ${phase.done}/${phase.total}`;
  }

  async function tick() {
    if (polling) return;
    const ui = activeUi();
    if (!ui) return;
    polling = true;
    try {
      const [ccsl, shopee] = await Promise.all([readProgress('CCSL'), readProgress('SHOPEE')]);
      const active = [ccsl, shopee].find(item => item?.running === true);
      if (active && activeUi()) render(ui, active);
    } finally {
      polling = false;
    }
  }

  setInterval(tick, POLL_MS);
  setTimeout(tick, 250);
})(window);
