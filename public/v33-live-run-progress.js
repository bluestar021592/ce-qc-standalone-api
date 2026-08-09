(function installV33LiveRunProgress(global) {
  if (new URLSearchParams(location.search).has('visualTest')) return;
  if (typeof runUnified !== 'function' || typeof api !== 'function') return;

  let lastProgress = null;
  let progressStop = false;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function phaseLabel(progress) {
    const phase = String(progress?.phase || '');
    if (/\u626b\u63cf|scan|order/i.test(phase)) return '\u8ba2\u5355\u626b\u63cf';
    if (/\u8f68\u8ff9|track/i.test(phase)) return '\u8f68\u8ff9\u67e5\u8be2';
    return phase || '\u51c6\u5907\u5904\u7406';
  }

  function liveMarkup(progress) {
    const phase = phaseLabel(progress);
    const isScan = /\u626b\u63cf/.test(phase);
    const done = isScan ? Number(progress.scanDone || 0) : Number(progress.trackDone || 0);
    const total = isScan ? Number(progress.scanTotal || 0) : Number(progress.trackTotal || 0);
    const unit = isScan ? '\u626b\u63cf' : '\u8f68\u8ff9';
    const batch = Number(progress.batchIndex || 0);
    const batches = Number(progress.totalBatches || 0);
    const batchText = batches ? ` \u00b7 \u5f53\u524d\u6279\u6b21 ${batch || 1}/${batches}` : '';
    const message = progress.lastMessage ? `<p class="muted">${escapeHtml(String(progress.lastMessage))}</p>` : '';
    return `<span class="status-pill warning">${progress.businessType} \u6b63\u5728\u5904\u7406 \u00b7 ${phase}</span>`
      + `<p>\u5f53\u524d\u9636\u6bb5\uff1a${phase}</p>`
      + `<p>${unit}\u8fdb\u5ea6\uff1a${formatInt(done)} / ${formatInt(total)}${batchText}</p>`
      + `<p class="muted">\u6570\u636e\u4f1a\u5728\u6bcf\u4e2a\u6279\u6b21\u5b8c\u6210\u540e\u81ea\u52a8\u66f4\u65b0\uff1b\u5355\u6279\u7b49\u5f85\u671f\u95f4\u4e0d\u9700\u8981\u91cd\u590d\u70b9\u51fb\u3002</p>${message}`;
  }

  async function fetchProgress(type) {
    try {
      return await api(`/api/v33/run-progress?businessType=${encodeURIComponent(type)}`);
    } catch (error) {
      console.warn('[V33] progress poll failed', type, error);
      return null;
    }
  }

  async function pollLoop() {
    const status = document.getElementById('ccslRunStatus');
    const button = document.querySelector('[data-testid="global-auto-process"]');
    while (!progressStop && typeof runInFlight !== 'undefined' && runInFlight) {
      const [ccsl, shopee] = await Promise.all([fetchProgress('CCSL'), fetchProgress('SHOPEE')]);
      const active = [ccsl, shopee].find(item => item?.running)
        || [ccsl, shopee].find(item => item && (item.batchIndex || item.done || item.total))
        || lastProgress;
      if (active) {
        lastProgress = active;
        if (status) status.innerHTML = liveMarkup(active);
        if (button) {
          const phase = phaseLabel(active);
          const isScan = /\u626b\u63cf/.test(phase);
          const done = isScan ? Number(active.scanDone || 0) : Number(active.trackDone || 0);
          const total = isScan ? Number(active.scanTotal || 0) : Number(active.trackTotal || 0);
          button.textContent = `${active.businessType} ${phase} ${done}/${total}`;
        }
      }
      await sleep(1200);
    }
  }

  runUnified = async function runUnifiedV33() {
    if (!unifiedImportState) return alert('\u8bf7\u5148\u5bfc\u5165\u7efc\u5408\u65e5\u62a5\u5e76\u5b8c\u6210\u81ea\u52a8\u5206\u7c7b');
    if (runInFlight) return;
    runInFlight = true;
    progressStop = false;
    lastProgress = null;
    const runButton = document.querySelector('[data-testid="global-auto-process"]');
    const runStatus = document.getElementById('ccslRunStatus');
    if (runButton) { runButton.disabled = true; runButton.textContent = '\u6b63\u5728\u542f\u52a8\u5904\u7406\u2026'; }
    if (runStatus) runStatus.innerHTML = '<span class="status-pill warning">\u6b63\u5728\u542f\u52a8\u4e94\u4e1a\u52a1\u5904\u7406\uff0c\u8fdb\u5ea6\u5c06\u81ea\u52a8\u66f4\u65b0</span>';

    const polling = pollLoop();
    try {
      const results = [];
      for (const pair of [['CCSL', '/api/run'], ['SHOPEE', '/api/shopee/run/start']]) {
        const type = pair[0];
        const url = pair[1];
        try {
          const result = await api(url, { method: 'POST' });
          if (type === 'CCSL') appState = result.state || appState;
          else shopeeState = result.state || shopeeState;
          results.push(`${type}\u5904\u7406\u5b8c\u6210`);
        } catch (error) {
          if (error.payload?.code === 'RUN_ALREADY_COMPLETED') results.push(`${type}\u5df2\u5b8c\u6210\uff0c\u5df2\u8df3\u8fc7`);
          else throw error;
        }
      }
      await refresh();
      processingNotice = { type: 'UNIFIED', level: 'success', message: `\u7efc\u5408\u65e5\u62a5\u5904\u7406\u5b8c\u6210\uff1a${results.join('\uff1b')}\u3002` };
    } catch (error) {
      const message = error?.message || String(error || '\u5904\u7406\u5931\u8d25');
      processingNotice = { type: 'UNIFIED', level: 'error', message };
      if (runStatus) runStatus.innerHTML = `<span class="status-pill danger">\u5904\u7406\u4e2d\u65ad\uff1a${escapeHtml(message)}</span>`;
      if (typeof renderProcessingNotice === 'function') renderProcessingNotice();
      if (error?.reloginRequired && typeof requestInternalRelogin === 'function') requestInternalRelogin();
    } finally {
      progressStop = true;
      runInFlight = false;
      try { await polling; } catch {}
      if (runButton) { runButton.disabled = false; runButton.textContent = '\u5f00\u59cb\u5168\u81ea\u52a8'; }
      if (typeof renderAll === 'function') renderAll();
    }
  };

  global.__CE_QC_V33_LIVE_RUN_PROGRESS__ = true;
})(window);
