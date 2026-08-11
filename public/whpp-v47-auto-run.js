(function (global) {
  const VERSION = '2026-08-11-v47-whpp-global-auto-run-v1';
  let whppRunInFlight = false;

  async function readJson(response) {
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || data.message || `HTTP ${response.status}`);
      error.code = data.code || `HTTP_${response.status}`;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function getWhppState() {
    return readJson(await fetch('/api/whpp/state', {
      cache: 'no-store',
      credentials: 'same-origin'
    }));
  }

  async function startWhppIfNeeded() {
    if (whppRunInFlight) return { skipped: true, reason: 'already-running' };
    const current = await getWhppState();
    const total = Number(current?.dashboard?.metrics?.total || current?.state?.pnhBills?.length || 0);
    if (!total || !current?.state?.dailyReportReady) return { skipped: true, reason: 'no-whpp-daily' };
    if (String(current?.snapshotStatus || '').toUpperCase() === 'COMPLETED') return { skipped: true, reason: 'completed' };

    whppRunInFlight = true;
    const runButton = document.querySelector('[data-testid="global-auto-process"]');
    const runStatus = document.getElementById('ccslRunStatus');
    if (runButton) {
      runButton.disabled = true;
      runButton.textContent = '正在处理WHPP本土…';
    }
    if (runStatus) runStatus.innerHTML = '<span class="status-pill warning">CCSL / SHOPEE 已完成，正在处理 WHPP 本土扫描、轨迹、退回与订单取消…</span>';

    try {
      const result = await readJson(await fetch('/api/whpp/run/start', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      }));
      if (runStatus) runStatus.innerHTML = '<span class="status-pill success">七业务处理完成，WHPP本土已生成正式快照</span>';
      return { skipped: false, result };
    } finally {
      whppRunInFlight = false;
      if (runButton) {
        runButton.disabled = false;
        runButton.textContent = '开始全自动';
      }
    }
  }

  function install() {
    const original = global.runUnified;
    if (typeof original !== 'function' || original.__whppV47Wrapped) return;

    const wrapped = async function () {
      const result = await original.apply(this, arguments);
      try {
        const whpp = await startWhppIfNeeded();
        if (!whpp?.skipped) {
          if (typeof global.refresh === 'function') await global.refresh();
          if (location.pathname === '/whpp' && typeof global.navigateWhppPage === 'function') {
            const state = await getWhppState();
            await global.navigateWhppPage(state?.state?.reportDate || '');
          }
        }
      } catch (error) {
        console.error('[CE-QC][WHPP_AUTO_RUN]', error);
        const runStatus = document.getElementById('ccslRunStatus');
        if (runStatus) runStatus.innerHTML = `<span class="status-pill danger">WHPP本土处理失败：${String(error.message || error)}</span>`;
      }
      return result;
    };
    wrapped.__whppV47Wrapped = true;
    global.runUnified = wrapped;
    console.info('[CE-QC][WHPP_AUTO_RUN]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);
