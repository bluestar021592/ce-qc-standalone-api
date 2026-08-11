(function installWhppUnifiedIntegrationV54(global) {
  const VERSION = '2026-08-11-v54-whpp-unified-integration-v3';
  let busy = false;
  let whppSummaryCache = null;
  let whppSummaryAt = 0;
  let decorating = false;

  async function readJson(response) {
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || data.message || `HTTP ${response.status}`);
      error.code = data.code || `HTTP_${response.status}`;
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function api(url, options = {}) {
    return readJson(await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      ...options
    }));
  }

  function statusNode() { return document.getElementById('ccslRunStatus'); }
  function runButton() { return document.querySelector('[data-testid="global-auto-process"]'); }

  function setStatus(kind, text) {
    const node = statusNode();
    if (node) node.innerHTML = `<span class="status-pill ${kind}">${String(text || '')}</span>`;
  }

  function setBusy(value, text = '') {
    busy = Boolean(value);
    const button = runButton();
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? (text || '正在处理…') : '开始全自动';
  }

  function stateFinished(payload = {}) {
    const state = payload.state || payload;
    const phase = String(state?.processing?.phase || '').trim();
    const error = String(state?.processing?.error || '').trim();
    const retry = Number(state?.lastRunSummary?.refreshFailed || state?.lastRunSummary?.retry || 0);
    return Boolean(state?.reportDate) && phase === '完成' && !error && retry === 0;
  }

  function whppNeedsRun(payload = {}) {
    const state = payload?.state || {};
    const total = Number(payload?.dashboard?.metrics?.total || state?.pnhBills?.length || 0);
    const unresolved = Number(payload?.dashboard?.metrics?.unresolved || 0);
    const status = String(payload?.snapshotStatus || state?.snapshotStatus || '').toUpperCase();
    if (!state?.dailyReportReady || total <= 0) return false;
    return !(status === 'COMPLETED' && unresolved === 0);
  }

  async function readRunStates() {
    const [ccsl, shopee, whpp] = await Promise.all([
      api('/api/state?compact=1').catch(() => ({})),
      api('/api/shopee/state?compact=1').catch(() => ({})),
      api('/api/v51/whpp-state').catch(() => ({}))
    ]);
    return { ccsl, shopee, whpp };
  }

  async function runStage(label, url) {
    setBusy(true, `正在处理${label}…`);
    setStatus('warning', `正在处理 ${label}，请勿关闭页面；完成后自动进入下一业务。`);
    return api(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
  }

  async function executeUnified(mode = 'start') {
    if (busy) return;
    setBusy(true, '正在检查处理状态…');
    try {
      const states = await readRunStates();
      const stages = [];

      if (!stateFinished(states.ccsl)) stages.push(['CCSL（CE/CEAF/TBKH/ALI1688）', mode === 'resume' ? '/api/resume' : '/api/run']);
      if (!stateFinished(states.shopee)) stages.push(['SHOPEE CN/VN', mode === 'resume' ? '/api/shopee/run/resume' : '/api/shopee/run/start']);
      if (whppNeedsRun(states.whpp)) stages.push(['WHPP本土', mode === 'resume' ? '/api/whpp/run/resume' : '/api/whpp/run/start']);

      if (!stages.length) {
        setStatus('success', '七业务均已完成，无需重复处理。');
        return;
      }

      const completed = [];
      for (const [label, url] of stages) {
        await runStage(label, url);
        completed.push(label);
      }

      setStatus('success', `综合日报处理完成：${completed.join('；')}处理完成。`);
      whppSummaryCache = null;
      whppSummaryAt = 0;
      if (typeof global.refresh === 'function') await global.refresh();
      else global.location.reload();
    } catch (error) {
      console.error('[CE-QC][V54_UNIFIED_RUN]', error);
      setStatus('danger', `全自动处理失败：${String(error.message || error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function pauseUnifiedV54() {
    if (busy) return;
    setBusy(true, '正在暂停…');
    try {
      await Promise.allSettled([
        api('/api/pause', { method: 'POST' }),
        api('/api/shopee/run/pause', { method: 'POST' }),
        api('/api/whpp/run/pause', { method: 'POST' })
      ]);
      setStatus('warning', 'CCSL、SHOPEE、WHPP本土处理均已发送暂停指令。');
      if (typeof global.refresh === 'function') await global.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function getWhppSummary() {
    if (whppSummaryCache && Date.now() - whppSummaryAt < 3000) return whppSummaryCache;
    try {
      whppSummaryCache = await api('/api/v51/whpp-state');
      whppSummaryAt = Date.now();
      return whppSummaryCache;
    } catch {
      return null;
    }
  }

  function numberOf(node) {
    return Number(String(node?.textContent || '').replace(/[^0-9.-]/g, '')) || 0;
  }

  function setTextIfChanged(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function patchImportedUniqueTotal(grid) {
    const validNode = grid.querySelector('[data-testid="classification-valid-unique"]');
    const businessKeys = ['ce','ceaf','tbkh','ali1688','shopeecn','shopeevn','whpp'];
    const reconciled = businessKeys.reduce((sum, key) => sum + numberOf(grid.querySelector(`[data-testid="classification-${key}"]`)), 0);
    const reconciledText = reconciled.toLocaleString('zh-CN');
    if (validNode && reconciled > 0) setTextIfChanged(validNode, reconciledText);

    const status = document.getElementById('fileStatus');
    if (status && reconciled > 0) {
      status.querySelectorAll('p').forEach(p => {
        if (!/有效唯一单号/.test(p.textContent || '')) return;
        const next = p.innerHTML.replace(/有效唯一单号\s*[\d,]+/, `有效唯一单号 ${reconciledText}`);
        if (next !== p.innerHTML) p.innerHTML = next;
      });
    }
  }

  async function decorateUnifiedImport() {
    if (decorating) return;
    const grid = document.querySelector('#unifiedClassificationSummary .unified-count-grid');
    if (!grid) return;
    decorating = true;
    try {
      const payload = await getWhppSummary();
      const whppTotal = Number(payload?.dashboard?.metrics?.total || payload?.state?.pnhBills?.length || 0);
      let card = grid.querySelector('[data-v54-business="WHPP"]');
      if (!card) {
        card = document.createElement('div');
        card.dataset.v54Business = 'WHPP';
        card.innerHTML = '<span>WHPP本土</span><b data-testid="classification-whpp">0</b>';
        grid.appendChild(card);
      }
      const value = card.querySelector('b');
      setTextIfChanged(value, Number(whppTotal || 0).toLocaleString('zh-CN'));
      patchImportedUniqueTotal(grid);

      const empty = document.querySelector('#unifiedClassificationSummary .unified-empty-state span');
      if (empty && /六业务/.test(empty.textContent || '')) setTextIfChanged(empty, (empty.textContent || '').replace('六业务', '七业务'));
    } finally {
      decorating = false;
    }
  }

  function install() {
    // The base app dispatches only CCSL + SHOPEE. V54 is intentionally loaded
    // last and owns all three unified buttons so one click covers all seven
    // classified business boards, including the separately persisted WHPP state.
    global.runUnified = () => executeUnified('start');
    global.resumeUnified = () => executeUnified('resume');
    global.pauseUnified = pauseUnifiedV54;

    void decorateUnifiedImport();
    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void decorateUnifiedImport(), 60);
    });
    observer.observe(document.querySelector('.app-shell') || document.body, { subtree: true, childList: true });
    console.info('[CE-QC][WHPP_UNIFIED_V54]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);
