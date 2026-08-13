(function installV94BusinessSourceTruthUi(global) {
  if (global.__CE_QC_V94_BUSINESS_SOURCE_TRUTH_UI__) return;
  const VERSION = '2026-08-13-v94-business-source-truth-ui-v1';
  let syncing = false;

  function currentDate() {
    try {
      const value = String(global.unifiedImportState?.reportDate || document.getElementById('topRangeTo')?.value || '').slice(0, 10);
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
      const state = global.unifiedImportState;
      if (!state || !payload?.counts || state.reportDate !== payload.reportDate) return false;
      state.classificationCounts = { ...(state.classificationCounts || {}), ...(payload.counts || {}) };
      state.classificationDisplaySource = 'V94_CANONICAL_POST_CLASSIFICATION';
      if (state.summary && Number(payload.total || 0) > 0) state.summary.validUniqueWaybills = Number(payload.total || state.summary.validUniqueWaybills || 0);
      if (typeof global.renderUnifiedImportResult === 'function') global.renderUnifiedImportResult();
      const badge = document.getElementById('unifiedSnapshotStatus');
      if (badge) {
        badge.textContent = '当前有效分类已同步';
        badge.className = 'status-pill success';
      }
      return true;
    } catch { return false; }
  }

  async function syncCanonicalCounts() {
    if (syncing) return;
    const date = currentDate();
    if (!date) return;
    syncing = true;
    try {
      const payload = await fetch(`/api/v89/instant-dashboard?date=${encodeURIComponent(date)}`, {
        cache: 'no-store', credentials: 'same-origin'
      }).then(readJson);
      applyCanonicalCounts(payload);
    } catch (error) {
      console.warn('[CE-QC][V94_SOURCE_TRUTH_UI] classification sync skipped', error);
    } finally {
      syncing = false;
    }
  }

  function schedule(delay = 60) { setTimeout(() => void syncCanonicalCounts(), Math.max(0, delay)); }

  const originalImport = global.importUnifiedExcel;
  if (typeof originalImport === 'function' && !originalImport.__v94Wrapped) {
    const wrapped = async function v94ImportUnifiedExcel() {
      const result = await originalImport.apply(this, arguments);
      await syncCanonicalCounts();
      return result;
    };
    wrapped.__v94Wrapped = true;
    global.importUnifiedExcel = wrapped;
  }

  document.addEventListener('click', event => {
    if (event.target?.closest?.('[data-page="import"],#topRangeQuery,#dashboardRangeQuery')) schedule(120);
  }, true);
  global.addEventListener('popstate', () => schedule(120));
  global.addEventListener('ce-qc-startup-truth-ready', () => schedule(80));
  schedule(200);

  global.__CE_QC_V94_BUSINESS_SOURCE_TRUTH_UI__ = { version: VERSION, sync: syncCanonicalCounts };
  console.info('[CE-QC][V94_BUSINESS_SOURCE_TRUTH_UI]', VERSION);
})(window);
