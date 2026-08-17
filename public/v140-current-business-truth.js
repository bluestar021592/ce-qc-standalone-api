(function installV166CurrentBusinessTruth(global) {
  if (global.__CE_QC_V166_CURRENT_BUSINESS_TRUTH__) return;
  global.__CE_QC_V166_CURRENT_BUSINESS_TRUTH__ = true;
  const VERSION = '2026-08-17-v166-current-business-truth-compact-v1';
  const PAGE_TYPE = Object.freeze({ ce:'CE', ceaf:'CEAF', tbkh:'TBKH', ali1688:'ALI1688', shopeecn:'SHOPEECN', shopeevn:'SHOPEEVN' });
  const verifiedAt = new Map();
  let inFlight = null;

  function finiteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function membershipCount(state = {}) {
    const candidates = [
      state.dailyParseSummary?.totalRecognized,
      state.dashboard?.recipientGroups?.ALL?.metrics?.total,
      state.dashboard?.metrics?.total,
      state.total,
      state.dashboard?.totalMonitored,
      state.dashboard?.pnh
    ];
    for (const value of candidates) {
      const parsed = finiteNumber(value);
      if (parsed !== null) return parsed;
    }
    if (Array.isArray(state.pnhBills) && state.pnhBills.length) return state.pnhBills.length;
    return 0;
  }

  function installV55CurrentGuard(state = {}) {
    const total = membershipCount(state);
    state.v55Summary = { total, __source: 'V166_EXACT_CURRENT_COMPACT_SNAPSHOT' };
    state.__v150BlocksLegacyV55RangeFallback = true;
    state.__v166DashboardCompactTruth = true;
    return state;
  }

  async function readJson(url) {
    const response = await fetch(url, { cache:'no-store', credentials:'same-origin' });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    return payload;
  }

  function importedStateFromMemory() {
    try {
      const value = typeof unifiedImportState !== 'undefined' ? unifiedImportState : null;
      if (value?.reportDate && value?.snapshotId) return value;
    } catch {}
    return null;
  }

  function sourceMismatchBanner(type, expected, actual) {
    let node = document.getElementById('v149CurrentSourceMismatch');
    if (!node) {
      node = document.createElement('div');
      node.id = 'v149CurrentSourceMismatch';
      node.className = 'global-processing-notice danger';
      document.querySelector('.main-content')?.prepend(node);
    }
    if (!Number.isFinite(expected) || expected === actual) {
      node.hidden = true;
      return;
    }
    node.hidden = false;
    node.innerHTML = `<span><strong>${type} 当前日报数据对账失败</strong> · 日报分类 ${expected.toLocaleString('zh-CN')}票 · 当前业务快照 ${actual.toLocaleString('zh-CN')}票。系统不会用旧历史代替当前日报。</span>`;
  }

  function currentSourceBanner(type, reportDate, total) {
    let node = document.getElementById('v150CurrentSourceTruth');
    if (!node) {
      node = document.createElement('div');
      node.id = 'v150CurrentSourceTruth';
      node.style.cssText = 'font-size:12px;color:#5f789b;margin:4px 0 8px;';
      const host = document.querySelector('.v18-dashboard-page') || document.querySelector('.main-content');
      host?.prepend(node);
    }
    if (node) node.textContent = `当前日报 ${reportDate} · ${type} 精确快照 ${Number(total || 0).toLocaleString('zh-CN')}票`;
  }

  function sameSnapshot(state, reportDate, snapshotId) {
    return Boolean(state?.dashboard)
      && String(state?.snapshotId || '') === snapshotId
      && String(state?.reportDate || '') === reportDate;
  }

  async function ensureCurrentBusinessTruth(page = '', force = false) {
    const normalizedPage = String(page || (typeof currentPage !== 'undefined' ? currentPage : '')).toLowerCase();
    const type = PAGE_TYPE[normalizedPage];
    if (!type || typeof businessStates === 'undefined') return;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        let imported = importedStateFromMemory();
        if (!imported) imported = (await readJson('/api/import/unified-latest?compact=1'))?.import || null;
        const reportDate = String(imported?.reportDate || '').trim();
        const snapshotId = String(imported?.snapshotId || '').trim();
        if (!reportDate || !snapshotId) return;
        const expectedRaw = imported?.classificationCounts?.[type];
        const expected = expectedRaw === undefined ? NaN : Number(expectedRaw);
        const verifyKey = `${type}|${snapshotId}`;

        const current = businessStates[type] || {};
        if (sameSnapshot(current, reportDate, snapshotId)) {
          const canonical = installV55CurrentGuard(current);
          canonical.__v149CanonicalCurrent = true;
          canonical.__v149ExpectedSourceTotal = Number.isFinite(expected) ? expected : undefined;
          businessStates[type] = canonical;
          const actual = membershipCount(canonical);
          sourceMismatchBanner(type, expected, actual);
          currentSourceBanner(type, reportDate, actual);
          verifiedAt.set(verifyKey, Date.now());
          return;
        }

        if (!force && Date.now() - Number(verifiedAt.get(verifyKey) || 0) < 60_000) return;

        // V166: dashboard truth is exact by snapshotId but intentionally compact.
        // Full scanResults/trackEvents/finalRows are detail data and are fetched only
        // when the user drills into a metric; loading them on every board visit made
        // the browser stall as the SQLite history grew.
        const result = await readJson(`/api/business-state/${encodeURIComponent(type)}?snapshotId=${encodeURIComponent(snapshotId)}&compact=1`);
        const live = installV55CurrentGuard(result?.state || {});
        live.__v149CanonicalCurrent = true;
        live.__v149ExpectedSourceTotal = Number.isFinite(expected) ? expected : undefined;
        businessStates[type] = live;
        verifiedAt.set(verifyKey, Date.now());
        const actual = membershipCount(live);
        sourceMismatchBanner(type, expected, actual);
        currentSourceBanner(type, reportDate, actual);
        if (String(typeof currentPage !== 'undefined' ? currentPage : '').toLowerCase() === normalizedPage && typeof renderAll === 'function') renderAll();
      } catch (error) {
        console.warn('[CE-QC][V166_CURRENT_BUSINESS_TRUTH]', error?.message || error);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  if (typeof hydratePageData === 'function') {
    const originalHydratePageData = hydratePageData;
    hydratePageData = async function v166HydratePageData(page) {
      await originalHydratePageData(page);
      await ensureCurrentBusinessTruth(page, false);
    };
  }

  document.addEventListener('ce-qc-run-complete', () => setTimeout(() => ensureCurrentBusinessTruth('', true), 250));
  const start = () => {
    const run = () => void ensureCurrentBusinessTruth();
    if ('requestIdleCallback' in global) global.requestIdleCallback(run, { timeout: 1500 });
    else setTimeout(run, 500);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();

  global.__CE_QC_V166_CURRENT_BUSINESS_TRUTH__ = { version: VERSION, ensure: ensureCurrentBusinessTruth, verifiedAt };
  console.info('[CE-QC][V166_CURRENT_BUSINESS_TRUTH]', VERSION);
})(window);
