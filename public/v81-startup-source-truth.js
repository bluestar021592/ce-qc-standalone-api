(function installStartupSourceTruthV81(global) {
  if (global.__CE_QC_V81_STARTUP_SOURCE_TRUTH__) return;

  const VERSION = '2026-09-20-v555-startup-shell-nonblocking-v1';
  const PRIMARY_GRACE_MS = 1800;
  const FALLBACK_TIMEOUT_MS = 2500;
  let fallbackRunning = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function setStartupStatus(text, force = false) {
    const status = document.getElementById('topRangeStatus');
    if (!status) return;
    const current = String(status.textContent || '').trim();
    if (force || !current || /正在读取最新日报|正在加载看板指标|最新日报读取失败|后台恢复|主启动数据仍未就绪/.test(current)) {
      status.textContent = text || '';
    }
  }

  function dataReady() {
    try {
      return Boolean(unifiedImportState?.snapshotId && unifiedImportState?.reportDate && appState?.reportDate && shopeeState?.reportDate);
    } catch { return false; }
  }

  function shellReady() {
    try { return Boolean(accessSession?.user); } catch { return false; }
  }

  function dispatchReady(source = 'PRIMARY', allowShell = false) {
    if (!dataReady() && !(allowShell && shellReady())) return false;
    setStartupStatus('', true);
    let reportDate = '';
    let snapshotId = '';
    try {
      reportDate = unifiedImportState?.reportDate || appState?.reportDate || shopeeState?.reportDate || '';
      snapshotId = unifiedImportState?.snapshotId || '';
    } catch {}
    global.dispatchEvent(new CustomEvent('ce-qc-startup-truth-ready', {
      detail: { version: VERSION, source, reportDate, snapshotId, shellReady: true, dataReady: dataReady() }
    }));
    console.info('[CE-QC][V555_STARTUP_SHELL_READY]', VERSION, source, reportDate || 'EMPTY');
    return true;
  }

  async function fetchJson(url, timeoutMs = FALLBACK_TIMEOUT_MS) {
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

  function applyFallback(latest, session) {
    let changed = false;
    try {
      if (session?.user) { accessSession = session; changed = true; try { sessionStorage.removeItem('ce_startup_auth_redirect_inflight'); } catch {} }
      const imported = latest?.import;
      if (imported?.snapshotId && imported?.reportDate) {
        unifiedImportState = imported;
        if (!historyCatalog || typeof historyCatalog !== 'object') historyCatalog = {};
        const currentRows = Array.isArray(historyCatalog.UNIFIED) ? historyCatalog.UNIFIED : [];
        historyCatalog.UNIFIED = [imported, ...currentRows.filter(row => row?.reportDate !== imported.reportDate && row?.snapshotId !== imported.snapshotId)];
        if (!historyModeDate && !dashboardPeriodMode && !dashboardPeriodRange?.fromDate) historyModeDate = imported.reportDate;
        changed = true;
      }
      if (changed && typeof global.renderAll === 'function') global.renderAll();
    } catch (error) {
      console.warn('[CE-QC][V555_STARTUP] lightweight fallback binding skipped', error);
    }
  }

  function requestRelogin() {
    try {
      if (sessionStorage.getItem('ce_startup_auth_redirect_inflight') === '1') return;
      sessionStorage.setItem('ce_startup_auth_redirect_inflight', '1');
      sessionStorage.setItem('ce_resume_after_login', '1');
    } catch {}
    const returnTo = `${global.location?.pathname || '/'}${global.location?.search || ''}`;
    global.location.replace('/?returnTo=' + encodeURIComponent(returnTo));
  }

  async function fallbackRecover() {
    if (fallbackRunning || dispatchReady('PRIMARY_LATE', true)) return;
    fallbackRunning = true;
    setStartupStatus('', true);
    try {
      // Never request aggregate CCSL/SHOPEE state from startup recovery.
      // On a multi-GB production DB those compatibility reads can monopolize the
      // single local SQLite service and make every click appear frozen.
      const results = await Promise.allSettled([
        fetchJson('/api/import/unified-latest?compact=1'),
        fetchJson('/api/session')
      ]);
      const authFailure = results.find(result => result.status === 'rejected' && Number(result.reason?.status || 0) === 401);
      if (authFailure) return requestRelogin();
      const value = index => results[index].status === 'fulfilled' ? results[index].value : null;
      applyFallback(value(0), value(1));
      if (dispatchReady('LIGHTWEIGHT_FALLBACK', true)) return;
      setStartupStatus('', true);
      console.info('[CE-QC][V555_STARTUP_SHELL_READY]', VERSION, 'NO_DATA_YET', 'EMPTY');
    } finally {
      fallbackRunning = false;
    }
  }

  async function coordinateStartup() {
    try {
      let active = null;
      try { active = typeof refreshPromise !== 'undefined' ? refreshPromise : null; } catch {}
      if (active && typeof active.then === 'function') {
        await Promise.race([Promise.resolve(active).catch(() => null), sleep(PRIMARY_GRACE_MS)]);
      } else {
        await sleep(PRIMARY_GRACE_MS);
      }
    } catch {}
    if (dispatchReady('PRIMARY', true)) return;
    void fallbackRecover();
  }

  global.__CE_QC_V81_STARTUP_SOURCE_TRUTH__ = { version: VERSION, policy: 'SHELL_FIRST_NO_AGGREGATE_STATE_RECOVERY' };
  void coordinateStartup();
})(window);
