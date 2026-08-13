(function installStartupSourceTruthV81(global) {
  if (global.__CE_QC_V81_STARTUP_SOURCE_TRUTH__) return;

  const VERSION = '2026-08-13-v82-startup-dashboard-recovery-v2';
  const RETRY_DELAYS = [0, 250, 750, 1500, 3000, 5000, 8000];
  let attempt = 0;
  let timer = null;
  let sourceBound = false;
  let dashboardHydrated = false;

  function setStartupStatus(text, force = false) {
    const status = document.getElementById('topRangeStatus');
    if (!status) return;
    const current = String(status.textContent || '').trim();
    if (force || !current || /正在读取最新日报|正在加载看板指标|最新日报读取失败/.test(current)) status.textContent = text || '';
  }

  async function fetchJson(url, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        const error = new Error(payload?.error || `HTTP ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  function applySession(session) {
    if (!session?.user) return false;
    try {
      accessSession = session;
      return true;
    } catch (error) {
      console.warn('[CE-QC][V82_STARTUP] session binding skipped', error);
      return false;
    }
  }

  function applyLatestImport(payload) {
    const imported = payload?.import;
    if (!imported?.snapshotId || !imported?.reportDate) return false;
    try {
      unifiedImportState = imported;
      if (!historyCatalog || typeof historyCatalog !== 'object') historyCatalog = {};
      const currentRows = Array.isArray(historyCatalog.UNIFIED) ? historyCatalog.UNIFIED : [];
      historyCatalog.UNIFIED = [
        imported,
        ...currentRows.filter(row => row?.reportDate !== imported.reportDate && row?.snapshotId !== imported.snapshotId)
      ];
      if (!historyModeDate && !dashboardPeriodMode && !dashboardPeriodRange?.fromDate) {
        historyModeDate = imported.reportDate;
        dashboardPeriodRange = null;
      }
      sourceBound = true;
      return true;
    } catch (error) {
      console.error('[CE-QC][V82_STARTUP] latest import binding failed', error);
      return false;
    }
  }

  function applyCompactStates(ccslPayload, shopeePayload) {
    let changed = false;
    try {
      if (ccslPayload?.state) {
        appState = ccslPayload.state;
        changed = true;
      }
      if (shopeePayload?.state) {
        shopeeState = shopeePayload.state;
        changed = true;
      }
      dashboardHydrated = Boolean(appState?.reportDate && shopeeState?.reportDate);
    } catch (error) {
      console.warn('[CE-QC][V82_STARTUP] compact state binding skipped', error);
    }
    return changed;
  }

  function renderBoundTruth() {
    try {
      if (typeof global.renderAll === 'function') global.renderAll();
    } catch (error) {
      console.warn('[CE-QC][V82_STARTUP] render skipped', error);
    }
  }

  function requestRelogin() {
    try { sessionStorage.setItem('ce_resume_after_login', '1'); } catch {}
    global.location.reload();
  }

  function scheduleNormalRefresh() {
    setTimeout(() => {
      try {
        if (typeof global.refresh === 'function') {
          Promise.resolve(global.refresh()).catch(error => {
            console.warn('[CE-QC][V82_STARTUP] normal background refresh skipped', error);
          });
        }
      } catch (error) {
        console.warn('[CE-QC][V82_STARTUP] refresh scheduling skipped', error);
      }
    }, 100);
  }

  async function recoverSourceTruth() {
    if (sourceBound && dashboardHydrated) return;
    setStartupStatus(sourceBound ? '正在加载看板指标…' : '正在读取最新日报…');

    const requests = [
      fetchJson('/api/import/unified-latest?compact=1'),
      fetchJson('/api/session'),
      fetchJson('/api/state?compact=1'),
      fetchJson('/api/shopee/state?compact=1')
    ];
    const [latestResult, sessionResult, ccslResult, shopeeResult] = await Promise.allSettled(requests);

    const results = [latestResult, sessionResult, ccslResult, shopeeResult];
    const authFailure = results.find(result => result.status === 'rejected' && Number(result.reason?.status || 0) === 401);
    if (authFailure) {
      requestRelogin();
      return;
    }

    const latest = latestResult.status === 'fulfilled' ? latestResult.value : null;
    const session = sessionResult.status === 'fulfilled' ? sessionResult.value : null;
    const ccsl = ccslResult.status === 'fulfilled' ? ccslResult.value : null;
    const shopee = shopeeResult.status === 'fulfilled' ? shopeeResult.value : null;

    const sessionBound = applySession(session);
    const importBound = applyLatestImport(latest);
    const stateBound = applyCompactStates(ccsl, shopee);
    if (sessionBound || importBound || stateBound) renderBoundTruth();

    if (sourceBound && dashboardHydrated) {
      setStartupStatus('', true);
      global.dispatchEvent(new CustomEvent('ce-qc-startup-truth-ready', {
        detail: {
          version: VERSION,
          reportDate: unifiedImportState?.reportDate || appState?.reportDate || '',
          snapshotId: unifiedImportState?.snapshotId || ''
        }
      }));
      scheduleNormalRefresh();
      console.info('[CE-QC][V82_STARTUP_DASHBOARD_RECOVERY]', VERSION, unifiedImportState?.reportDate || appState?.reportDate || '');
      return;
    }

    if (sourceBound) setStartupStatus('正在加载看板指标…', true);
    if (attempt < RETRY_DELAYS.length - 1) {
      attempt += 1;
      clearTimeout(timer);
      timer = setTimeout(() => void recoverSourceTruth(), RETRY_DELAYS[attempt]);
      return;
    }

    // Keep the already verified source cards/date visible even if a compact metric
    // endpoint is temporarily slow, and continue retrying instead of freezing at 0.
    setStartupStatus(sourceBound ? '看板指标正在后台恢复…' : '最新日报读取失败，正在自动重试', true);
    timer = setTimeout(() => {
      attempt = 0;
      void recoverSourceTruth();
    }, 10000);
  }

  global.__CE_QC_V81_STARTUP_SOURCE_TRUTH__ = { version: VERSION };
  void recoverSourceTruth();
})(window);
