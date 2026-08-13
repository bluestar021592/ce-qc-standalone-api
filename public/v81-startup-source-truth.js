(function installStartupSourceTruthV81(global) {
  if (global.__CE_QC_V81_STARTUP_SOURCE_TRUTH__) return;

  const VERSION = '2026-08-13-v81-startup-source-truth-v1';
  const RETRY_DELAYS = [0, 250, 750, 1500, 3000, 5000, 8000];
  let attempt = 0;
  let timer = null;
  let completed = false;

  function setStartupStatus(text) {
    const status = document.getElementById('topRangeStatus');
    if (status && !String(status.textContent || '').trim()) status.textContent = text || '';
  }

  async function fetchJson(url, timeoutMs = 4000) {
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
      console.warn('[CE-QC][V81_STARTUP] session binding skipped', error);
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

      // A cold browser load must never stay on an empty date while a valid latest
      // unified import exists. Only select the newest day when the user has not
      // already chosen a historical/range view.
      if (!historyModeDate && !dashboardPeriodMode && !dashboardPeriodRange?.fromDate) {
        historyModeDate = imported.reportDate;
        dashboardPeriodRange = null;
      }
      return true;
    } catch (error) {
      console.error('[CE-QC][V81_STARTUP] latest import binding failed', error);
      return false;
    }
  }

  function renderBoundTruth() {
    try {
      if (typeof global.renderAll === 'function') global.renderAll();
    } catch (error) {
      console.warn('[CE-QC][V81_STARTUP] render skipped', error);
    }
  }

  function scheduleHydration() {
    setTimeout(() => {
      try {
        if (typeof global.refresh === 'function') {
          Promise.resolve(global.refresh()).catch(error => {
            console.warn('[CE-QC][V81_STARTUP] background dashboard hydration skipped', error);
          });
        }
      } catch (error) {
        console.warn('[CE-QC][V81_STARTUP] hydration scheduling skipped', error);
      }
    }, 50);
  }

  async function recoverSourceTruth() {
    if (completed) return;
    setStartupStatus('正在读取最新日报…');

    const [latestResult, sessionResult] = await Promise.allSettled([
      fetchJson('/api/import/unified-latest?compact=1'),
      fetchJson('/api/session')
    ]);

    const latest = latestResult.status === 'fulfilled' ? latestResult.value : null;
    const session = sessionResult.status === 'fulfilled' ? sessionResult.value : null;
    const latestError = latestResult.status === 'rejected' ? latestResult.reason : null;
    const sessionError = sessionResult.status === 'rejected' ? sessionResult.reason : null;

    if (Number(latestError?.status || sessionError?.status || 0) === 401) {
      sessionStorage.setItem('ce_resume_after_login', '1');
      global.location.reload();
      return;
    }

    const sessionBound = applySession(session);
    const importBound = applyLatestImport(latest);
    if (sessionBound || importBound) renderBoundTruth();

    if (importBound) {
      completed = true;
      const status = document.getElementById('topRangeStatus');
      if (status && /正在读取最新日报/.test(String(status.textContent || ''))) status.textContent = '';
      global.dispatchEvent(new CustomEvent('ce-qc-startup-truth-ready', {
        detail: { version: VERSION, reportDate: latest.import.reportDate, snapshotId: latest.import.snapshotId }
      }));
      scheduleHydration();
      console.info('[CE-QC][V81_STARTUP_SOURCE_TRUTH]', VERSION, latest.import.reportDate);
      return;
    }

    if (attempt < RETRY_DELAYS.length - 1) {
      attempt += 1;
      clearTimeout(timer);
      timer = setTimeout(() => void recoverSourceTruth(), RETRY_DELAYS[attempt]);
      return;
    }

    setStartupStatus('最新日报读取失败，请稍后自动重试');
    // Keep a slow retry running instead of leaving a permanent all-zero dashboard.
    timer = setTimeout(() => {
      attempt = 0;
      void recoverSourceTruth();
    }, 15000);
  }

  global.__CE_QC_V81_STARTUP_SOURCE_TRUTH__ = { version: VERSION };
  void recoverSourceTruth();
})(window);
