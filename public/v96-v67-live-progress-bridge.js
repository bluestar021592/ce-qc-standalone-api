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
      const response = await fetch(`/api/v33/run-progress?businessType=${encodeURIComponent(type)}`, { cache:'no-store', credentials:'same-origin' });
      if (!response.ok) return null;
      return await response.json();
    } catch { return null; }
  }

  function safePair(done, total) {
    const t = Math.max(0, Number(total || 0));
    const d = Math.max(0, Math.min(t, Number(done || 0)));
    return [d, t];
  }
  function phaseOf(progress) {
    const raw = String(progress?.phase || '').trim();
    const label = String(progress?.phaseLabel || '').trim();
    let done = Number(progress?.done || 0), total = Number(progress?.total || 0);
    if (/扫描|scan|order/i.test(raw) && !/exception-item|异常|取消/i.test(raw)) {
      done = Number(progress?.scanDone || 0); total = Number(progress?.scanTotal || 0);
    } else if (/exception-item|异常|取消/i.test(raw)) {
      done = Number(progress?.exceptionDone || 0); total = Number(progress?.exceptionTotal || progress?.trackTotal || 0);
    } else if (/轨迹|track|shipment-event/i.test(raw)) {
      done = Number(progress?.trackDone || 0); total = Number(progress?.trackTotal || 0);
    }
    [done,total] = safePair(done,total);
    return { label: label || raw || '准备处理', done, total };
  }
  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function render(ui, progress) {
    const phase = phaseOf(progress);
    const batch = Number(progress.batchIndex || 0), batches = Number(progress.totalBatches || 0);
    const batchText = batches > 0 ? ` · 当前批次 ${Math.min(Math.max(1,batch||1),batches)}/${batches}` : '';
    const last = String(progress.lastMessage || '').trim();
    const display = progress.displayBusinessType || (progress.businessType === 'SHOPEE' ? 'SHOPEE CN + SHOPEE VN' : progress.businessType);
    const today = Number(progress.foregroundToday || 0);
    const historical = Number(progress.historicalCarryStored || 0);
    ui.status.innerHTML = `<span class="status-pill warning">${escapeHtml(display)} 正在处理 · ${escapeHtml(phase.label)}</span>`
      + `<p>${escapeHtml(phase.label)}进度：${phase.done} / ${phase.total}${batchText}</p>`
      + (today ? `<p class="muted">本次前台日报：${today.toLocaleString('zh-CN')}票。历史OPEN遗留${historical.toLocaleString('zh-CN')}票由后台独立刷新，不应重复塞入当前批次。</p>` : '')
      + '<p class="muted">进度按运单成功状态计算，不再使用轨迹事件条数，因此不会出现分子大于分母。</p>'
      + (last ? `<p class="muted">${escapeHtml(last)}</p>` : '');
    ui.button.textContent = `${display} ${phase.label} ${phase.done}/${phase.total}`;
  }

  async function tick() {
    if (polling) return;
    const ui = activeUi(); if (!ui) return;
    polling = true;
    try {
      const [ccsl, shopee] = await Promise.all([readProgress('CCSL'), readProgress('SHOPEE')]);
      const active = [ccsl, shopee].find(item => item?.running === true);
      if (active && activeUi()) render(ui, active);
    } finally { polling = false; }
  }

  setInterval(tick, POLL_MS);
  setTimeout(tick, 250);
})(window);