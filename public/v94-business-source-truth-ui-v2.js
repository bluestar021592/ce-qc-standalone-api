(function installV94BusinessSourceTruthUi(global) {
  if (global.__CE_QC_V94_BUSINESS_SOURCE_TRUTH_UI__) return;
  const VERSION = '2026-08-15-v140-business-source-truth-ui-v3';
  let syncing = false;
  let pendingSync = false;
  let timer = null;

  function importState() {
    try {
      if (typeof unifiedImportState !== 'undefined') return unifiedImportState;
    } catch {}
    return global.unifiedImportState || null;
  }

  function currentDate() {
    try {
      const state = importState();
      const value = String(state?.reportDate || document.getElementById('topRangeTo')?.value || '').slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
    } catch { return ''; }
  }

  async function readJson(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  }

  function applyCanonicalCounts(payload) {
    try {
      const state = importState();
      if (!state || !payload?.counts || state.reportDate !== payload.reportDate) return false;
      const keys = ['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN', 'WHPP'];
      const counts = Object.fromEntries(keys.map(key => [key, Number(payload.counts?.[key] || 0)]));
      state.classificationCounts = counts;
      state.classificationDisplaySource = 'V140_CANONICAL_DATABASE_CLASSIFICATION';
      if (state.summary && Number(payload.total || 0) >= 0) state.summary.validUniqueWaybills = Number(payload.total || 0);
      global.__CE_QC_CANONICAL_CLASSIFICATION__ = {
        reportDate: payload.reportDate,
        counts,
        total: Number(payload.total || keys.reduce((sum, key) => sum + counts[key], 0)),
        receivedAt: Date.now()
      };
      if (typeof global.renderUnifiedImportResult === 'function') global.renderUnifiedImportResult();
      else {
        try { if (typeof renderUnifiedImportResult === 'function') renderUnifiedImportResult(); } catch {}
      }
      const badge = document.getElementById('unifiedSnapshotStatus');
      if (badge) {
        badge.textContent = '当前有效分类已同步';
        badge.className = 'status-pill success';
      }
      global.dispatchEvent(new CustomEvent('ce-qc-canonical-classification-ready', { detail: global.__CE_QC_CANONICAL_CLASSIFICATION__ }));
      return true;
    } catch { return false; }
  }

  async function syncCanonicalCounts() {
    if (syncing) {
      pendingSync = true;
      return;
    }
    const date = currentDate();
    if (!date) return;
    syncing = true;
    pendingSync = false;
    try {
      const payload = await fetch(`/api/v89/instant-dashboard?date=${encodeURIComponent(date)}&_=${Date.now()}`, {
        cache: 'no-store', credentials: 'same-origin'
      }).then(readJson);
      applyCanonicalCounts(payload);
    } catch (error) {
      console.warn('[CE-QC][V140_SOURCE_TRUTH_UI] classification sync skipped', error);
    } finally {
      syncing = false;
      if (pendingSync) {
        pendingSync = false;
        queueMicrotask(() => void syncCanonicalCounts());
      }
    }
  }

  function schedule(delay = 60) {
    clearTimeout(timer);
    timer = setTimeout(() => void syncCanonicalCounts(), Math.max(0, delay));
  }

  const originalImport = global.importUnifiedExcel;
  if (typeof originalImport === 'function' && !originalImport.__v94Wrapped) {
    const wrapped = async function v140ImportUnifiedExcel() {
      const result = await originalImport.apply(this, arguments);
      pendingSync = true;
      await syncCanonicalCounts();
      return result;
    };
    wrapped.__v94Wrapped = true;
    global.importUnifiedExcel = wrapped;
  }

  document.addEventListener('click', event => {
    if (event.target?.closest?.('[data-page="import"],#topRangeQuery,#dashboardRangeQuery')) schedule(40);
  }, true);
  global.addEventListener('popstate', () => schedule(40));
  global.addEventListener('ce-qc-startup-truth-ready', () => schedule(20));
  global.addEventListener('ce-qc-run-complete', () => schedule(0));
  schedule(80);

  global.__CE_QC_V94_BUSINESS_SOURCE_TRUTH_UI__ = { version: VERSION, sync: syncCanonicalCounts, applyCanonicalCounts };
  console.info('[CE-QC][V140_BUSINESS_SOURCE_TRUTH_UI]', VERSION);
})(window);
