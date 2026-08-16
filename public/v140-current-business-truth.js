(function installV140CurrentBusinessTruth(global) {
  if (global.__CE_QC_V140_CURRENT_BUSINESS_TRUTH__) return;
  global.__CE_QC_V140_CURRENT_BUSINESS_TRUTH__ = true;
  const VERSION = '2026-08-16-v140-current-business-truth-v1';
  const PAGE_TYPE = Object.freeze({ ce:'CE', ceaf:'CEAF', tbkh:'TBKH', ali1688:'ALI1688', shopeecn:'SHOPEECN', shopeevn:'SHOPEEVN' });
  let inFlight = null;

  function countState(state = {}) {
    const values = [
      state.pnhBills?.length,
      state.dailyParseSummary?.totalRecognized,
      state.dashboard?.pnh,
      state.dashboard?.totalMonitored,
      state.v55Summary?.total
    ].map(value => Number(value || 0));
    return Math.max(0, ...values.filter(Number.isFinite));
  }

  async function readJson(url) {
    const response = await fetch(url, { cache:'no-store', credentials:'same-origin' });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    return payload;
  }

  async function ensureCurrentBusinessTruth(page = '') {
    const normalizedPage = String(page || (typeof currentPage !== 'undefined' ? currentPage : '')).toLowerCase();
    const type = PAGE_TYPE[normalizedPage];
    if (!type || typeof businessStates === 'undefined') return;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const latest = await readJson('/api/import/unified-latest?compact=1');
        const imported = latest?.import || null;
        const reportDate = String(imported?.reportDate || '').trim();
        const snapshotId = String(imported?.snapshotId || '').trim();
        if (!reportDate || !snapshotId) return;

        // Home/source truth is intentionally lightweight. It is only used as a
        // mismatch detector; the detailed board still comes from the canonical
        // /api/business-state endpoint and never fabricates KPI rows in the browser.
        let sourceTotal = 0;
        try {
          const source = await readJson(`/api/v89/instant-dashboard?date=${encodeURIComponent(reportDate)}`);
          sourceTotal = Number(source?.counts?.[type] || 0);
        } catch {}

        const current = businessStates[type] || {};
        const currentTotal = countState(current);
        const sameSnapshot = String(current.snapshotId || '') === snapshotId;
        const sameDate = String(current.reportDate || '') === reportDate;
        if (sameSnapshot && sameDate && (currentTotal > 0 || sourceTotal <= 0)) return;

        // Deliberately omit compact=1. The compact route may use the latest formal
        // COMPLETED range snapshot; while today's seven-business run is still in
        // progress we need current SQLite membership + already-produced results.
        const result = await readJson(`/api/business-state/${encodeURIComponent(type)}?snapshotId=${encodeURIComponent(snapshotId)}`);
        const live = result?.state || {};
        businessStates[type] = live;
        if (typeof renderAll === 'function') renderAll();

        const liveTotal = countState(live);
        if (sourceTotal > 0 && liveTotal === 0) {
          console.error(`[CE-QC][V140_CURRENT_BUSINESS_TRUTH] ${type} source=${sourceTotal} but canonical live state=0; source membership requires server-side repair.`);
        }
      } catch (error) {
        console.warn('[CE-QC][V140_CURRENT_BUSINESS_TRUTH]', error?.message || error);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  if (typeof hydratePageData === 'function') {
    const originalHydratePageData = hydratePageData;
    hydratePageData = async function v140HydratePageData(page) {
      await originalHydratePageData(page);
      await ensureCurrentBusinessTruth(page);
    };
  }

  document.addEventListener('ce-qc-run-complete', () => setTimeout(() => ensureCurrentBusinessTruth(), 200));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(() => ensureCurrentBusinessTruth(), 150), { once:true });
  else setTimeout(() => ensureCurrentBusinessTruth(), 150);
  console.info('[CE-QC][V140_CURRENT_BUSINESS_TRUTH]', VERSION);
})(window);
