(function installStartupSourceTruthV81(global) {
  if (global.__CE_QC_V81_STARTUP_SOURCE_TRUTH__) return;

  const VERSION = '2026-08-13-v89-startup-single-flight-v3';
  const PRIMARY_GRACE_MS = 1800;
  const RETRY_DELAYS = [250, 750, 1500, 3000, 5000, 8000];
  let attempt = 0;
  let timer = null;
  let fallbackRunning = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function setStartupStatus(text, force = false) {
    const status = document.getElementById('topRangeStatus');
    if (!status) return;
    const current = String(status.textContent || '').trim();
    if (force || !current || /正在读取最新日报|正在加载看板指标|最新日报读取失败|后台恢复/.test(current)) status.textContent = text || '';
  }

  function primaryReady() {
    try {
      return Boolean(unifiedImportState?.snapshotId && unifiedImportState?.reportDate && appState?.reportDate && shopeeState?.reportDate);
    } catch { return false; }
  }

  function dispatchReady(source = 'PRIMARY') {
    if (!primaryReady()) return false;
    setStartupStatus('', true);
    let reportDate = '';
    let snapshotId = '';
    try {
      reportDate = unifiedImportState?.reportDate || appState?.reportDate || '';
      snapshotId = unifiedImportState?.snapshotId || '';
    } catch {}
    global.dispatchEvent(new CustomEvent('ce-qc-startup-truth-ready', {
      detail: { version: VERSION, source, reportDate, snapshotId }
    }));
    console.info('[CE-QC][V89_STARTUP_SINGLE_FLIGHT]', VERSION, source, reportDate);
    return true;
  }

  async function fetchJson(url, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        const error = new Error(payload?.error || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  function applyFallback(latest, session, ccsl, shopee) {
    let changed = false;
    try {
      if (session?.user) { accessSession = session; changed = true; }
      const imported = latest?.import;
      if (imported?.snapshotId && imported?.reportDate) {
        unifiedImportState = imported;
        if (!historyCatalog || typeof historyCatalog !== 'object') historyCatalog = {};
        const currentRows = Array.isArray(historyCatalog.UNIFIED) ? historyCatalog.UNIFIED : [];
        historyCatalog.UNIFIED = [imported, ...currentRows.filter(row => row?.reportDate !== imported.reportDate && row?.snapshotId !== imported.snapshotId)];
        if (!historyModeDate && !dashboardPeriodMode && !dashboardPeriodRange?.fromDate) historyModeDate = imported.reportDate;
        changed = true;
      }
      if (ccsl?.state) { appState = ccsl.state; changed = true; }
      if (shopee?.state) { shopeeState = shopee.state; changed = true; }
      if (changed && typeof global.renderAll === 'function') global.renderAll();
    } catch (error) {
      console.warn('[CE-QC][V89_STARTUP] fallback binding skipped', error);
    }
  }

  function requestRelogin() {
    try { sessionStorage.setItem('ce_resume_after_login', '1'); } catch {}
    global.location.reload();
  }

  async function fallbackRecover() {
    if (fallbackRunning || dispatchReady('PRIMARY_LATE')) return;
    fallbackRunning = true;
    setStartupStatus('主启动数据仍未就绪，正在进行轻量后台恢复…', true);
    try {
      const results = await Promise.allSettled([
        fetchJson('/api/import/unified-latest?compact=1'),
        fetchJson('/api/session'),
        fetchJson('/api/state?compact=1'),
        fetchJson('/api/shopee/state?compact=1')
      ]);
      const authFailure = results.find(result => result.status === 'rejected' && Number(result.reason?.status || 0) === 401);
      if (authFailure) return requestRelogin();
      const value = index => results[index].status === 'fulfilled' ? results[index].value : null;
      applyFallback(value(0), value(1), value(2), value(3));
      if (dispatchReady('FALLBACK')) return;
    } finally {
      fallbackRunning = false;
    }

    if (attempt < RETRY_DELAYS.length) {
      const delay = RETRY_DELAYS[attempt++];
      clearTimeout(timer);
      timer = setTimeout(() => void fallbackRecover(), delay);
    } else {
      attempt = 0;
      setStartupStatus('最新日报或看板指标仍在后台恢复…', true);
      timer = setTimeout(() => void fallbackRecover(), 10000);
    }
  }

  async function coordinateStartup() {
    // app.js already starts refresh() immediately. Older V81 simultaneously made
    // four more API calls and then started a second refresh, tripling cold-start
    // work. Wait for that primary single-flight first; only recover if it truly
    // failed or exceeded the grace window.
    try {
      let active = null;
      try { active = typeof refreshPromise !== 'undefined' ? refreshPromise : null; } catch {}
      if (active && typeof active.then === 'function') {
        await Promise.race([Promise.resolve(active).catch(() => null), sleep(PRIMARY_GRACE_MS)]);
      } else {
        await sleep(PRIMARY_GRACE_MS);
      }
    } catch {}
    if (dispatchReady('PRIMARY')) return;
    void fallbackRecover();
  }

  global.__CE_QC_V81_STARTUP_SOURCE_TRUTH__ = { version: VERSION };
  void coordinateStartup();
})(window);
