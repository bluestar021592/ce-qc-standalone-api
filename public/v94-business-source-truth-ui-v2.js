(function installV94BusinessSourceTruthUi(global) {
  if (global.__CE_QC_V94_BUSINESS_SOURCE_TRUTH_UI__) return;
  const VERSION = '2026-09-04-v426-unified-import-truth-priority-v1';
  const TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
  let syncing = false;

  const num = value => {
    const parsed = Number(String(value ?? '').replace(/[,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  function importState() {
    try {
      if (typeof unifiedImportState !== 'undefined') return unifiedImportState;
    } catch {}
    return global.unifiedImportState || null;
  }

  function authoritativeUnifiedImport(state = importState()) {
    const counts = state?.classificationCounts || null;
    const reconciliation = state?.sourceReconciliation || null;
    if (!counts || !reconciliation || reconciliation.balanced !== true) return null;
    if (!TYPES.every(type => Object.prototype.hasOwnProperty.call(counts, type))) return null;
    const declaredTypes = new Set((Array.isArray(reconciliation.businessTypes) ? reconciliation.businessTypes : []).map(type => String(type || '').toUpperCase()));
    if (!TYPES.every(type => declaredTypes.has(type))) return null;
    const normalized = Object.fromEntries(TYPES.map(type => [type, Math.max(0, num(counts[type]))]));
    const total = TYPES.reduce((sum, type) => sum + normalized[type], 0);
    if (num(reconciliation.validUniqueWaybills) !== total || num(reconciliation.classifiedWaybills) !== total) return null;
    return { counts: normalized, total, reportDate: String(state?.reportDate || '').slice(0, 10) };
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

  function markProtectedTruth(state, truth) {
    if (!state || !truth) return false;
    state.classificationDisplaySource = 'V426_UNIFIED_IMPORT_SEVEN_BUSINESS_TRUTH';
    state.sevenBusinessValidUniqueWaybills = truth.total;
    if (state.summary) {
      state.summary.validUniqueWaybills = truth.total;
      state.summary.totalUnique = truth.total;
      state.summary.sevenBusinessValidUniqueWaybills = truth.total;
    }
    return true;
  }

  function applyCanonicalCounts(payload) {
    try {
      const state = importState();
      if (!state || !payload?.counts || state.reportDate !== payload.reportDate) return false;
      const protectedTruth = authoritativeUnifiedImport(state);
      if (protectedTruth) {
        markProtectedTruth(state, protectedTruth);
        return true;
      }
      state.classificationCounts = { ...(state.classificationCounts || {}), ...(payload.counts || {}) };
      state.classificationDisplaySource = 'V94_CANONICAL_POST_CLASSIFICATION_LEGACY_COMPAT';
      if (state.summary && Number(payload.total || 0) > 0) state.summary.validUniqueWaybills = Number(payload.total || state.summary.validUniqueWaybills || 0);
      if (typeof global.renderUnifiedImportResult === 'function') global.renderUnifiedImportResult();
      else {
        try { if (typeof renderUnifiedImportResult === 'function') renderUnifiedImportResult(); } catch {}
      }
      const badge = document.getElementById('unifiedSnapshotStatus');
      if (badge) {
        badge.textContent = '当前有效分类已同步';
        badge.className = 'status-pill success';
      }
      return true;
    } catch { return false; }
  }

  async function syncCanonicalCounts() {
    if (syncing) return null;
    const date = currentDate();
    if (!date) return null;
    const state = importState();
    const protectedTruth = authoritativeUnifiedImport(state);
    if (protectedTruth && protectedTruth.reportDate === date) {
      markProtectedTruth(state, protectedTruth);
      return { skipped: true, reason: 'AUTHORITATIVE_UNIFIED_IMPORT_TRUTH', total: protectedTruth.total };
    }
    syncing = true;
    try {
      const payload = await fetch(`/api/v89/instant-dashboard?date=${encodeURIComponent(date)}`, {
        cache: 'no-store', credentials: 'same-origin'
      }).then(readJson);
      const current = importState();
      const nowProtected = authoritativeUnifiedImport(current);
      if (nowProtected && nowProtected.reportDate === date) {
        markProtectedTruth(current, nowProtected);
        return { skipped: true, reason: 'AUTHORITATIVE_IMPORT_BECAME_READY', total: nowProtected.total };
      }
      applyCanonicalCounts(payload);
      return payload;
    } catch (error) {
      console.warn('[CE-QC][V94_SOURCE_TRUTH_UI] classification sync skipped', error);
      return null;
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

  global.__CE_QC_V94_BUSINESS_SOURCE_TRUTH_UI__ = {
    version: VERSION,
    sync: syncCanonicalCounts,
    applyCanonicalCounts,
    authoritativeUnifiedImport
  };
  console.info('[CE-QC][V94_BUSINESS_SOURCE_TRUTH_UI]', VERSION, 'balanced seven-business unified import is protected from later dashboard-summary overwrite; legacy states keep canonical fallback.');
})(window);
