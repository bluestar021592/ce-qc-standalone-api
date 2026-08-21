(function installV166CurrentBusinessTruth(global) {
  if (global.__CE_QC_V166_CURRENT_BUSINESS_TRUTH__) return;
  global.__CE_QC_V166_CURRENT_BUSINESS_TRUTH__ = true;
  const VERSION = '2026-08-21-v203-ceaf-instant-first-paint-background-truth-v1';
  const GOLIVE_COMPAT_VERSION = '2026-08-21-v201-current-business-truth-per-business-inflight-v1';
  const PAGE_TYPE = Object.freeze({ ce:'CE', ceaf:'CEAF', tbkh:'TBKH', ali1688:'ALI1688', shopeecn:'SHOPEECN', shopeevn:'SHOPEEVN' });
  const verifiedAt = new Map();
  const inFlightByType = new Map();

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
    state.v55Summary = { ...(state.v55Summary || {}), total, __source: 'V203_EXACT_CURRENT_COMPACT_SNAPSHOT' };
    state.__v150BlocksLegacyV55RangeFallback = true;
    state.__v166DashboardCompactTruth = true;
    return state;
  }

  function applyExpectedCeafSourceTotal(state = {}, expected, reportDate, snapshotId) {
    if (!Number.isFinite(expected) || expected < 0) return state;
    const actual = membershipCount(state);
    if (actual === expected && String(state.reportDate || '') === String(reportDate || '')) return state;
    state.reportDate = String(reportDate || state.reportDate || '');
    state.snapshotId = String(snapshotId || state.snapshotId || '');
    state.dailyReportReady = expected > 0 || Boolean(state.dailyReportReady);
    state.dailyParseSummary = { ...(state.dailyParseSummary || {}), totalRecognized: expected };
    state.total = expected;
    state.dashboard = { ...(state.dashboard || {}) };
    state.dashboard.pnh = expected;
    state.dashboard.totalMonitored = expected;
    if (state.dashboard.metrics && typeof state.dashboard.metrics === 'object') {
      state.dashboard.metrics = { ...state.dashboard.metrics, total: expected };
    }
    state.__v202CeafSourceTotalRecovered = true;
    state.__v203CeafInstantSourceSeed = true;
    return installV55CurrentGuard(state);
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
    const onPage = String(location.pathname || '').toLowerCase() === `/${String(type || '').toLowerCase()}`;
    if (!onPage || !Number.isFinite(expected) || expected === actual) {
      node.hidden = true;
      return;
    }
    node.hidden = false;
    node.innerHTML = `<span><strong>${type} 当前日报数据对账失败</strong> · 日报分类 ${expected.toLocaleString('zh-CN')}票 · 当前业务快照 ${actual.toLocaleString('zh-CN')}票。系统不会用旧历史代替当前日报。</span>`;
  }

  function currentSourceBanner(type, reportDate, total) {
    let node = document.getElementById('v150CurrentSourceTruth');
    const onPage = String(location.pathname || '').toLowerCase() === `/${String(type || '').toLowerCase()}`;
    if (!onPage || !Number.isFinite(Number(total)) || Number(total) <= 0) {
      if (node) node.hidden = true;
      return;
    }
    if (!node) {
      node = document.createElement('div');
      node.id = 'v150CurrentSourceTruth';
      node.style.cssText = 'font-size:12px;color:#5f789b;margin:4px 0 8px;';
      const host = document.querySelector('.v18-dashboard-page') || document.querySelector('.main-content');
      host?.prepend(node);
    }
    if (node) {
      node.hidden = false;
      node.textContent = `当前日报 ${reportDate} · ${type} 精确快照 ${Number(total || 0).toLocaleString('zh-CN')}票`;
    }
  }

  function sameSnapshot(state, reportDate, snapshotId) {
    return Boolean(state?.dashboard)
      && String(state?.snapshotId || '') === snapshotId
      && String(state?.reportDate || '') === reportDate;
  }

  function cleanWhppBackgroundStatus() {
    if (String(location.pathname || '').toLowerCase() !== '/whpp') return;
    document.querySelectorAll('.processing-notice,.global-processing-notice').forEach(node => {
      const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.includes('正在后台校验最新WHPP摘要')) node.remove();
    });
  }

  function seedCeafImmediately(page = '') {
    if (String(page || '').toLowerCase() !== 'ceaf' || typeof businessStates === 'undefined') return false;
    const imported = importedStateFromMemory();
    const reportDate = String(imported?.reportDate || '').trim();
    const snapshotId = String(imported?.snapshotId || '').trim();
    const expected = Number(imported?.classificationCounts?.CEAF);
    if (!reportDate || !snapshotId || !Number.isFinite(expected) || expected < 0) return false;
    const current = businessStates.CEAF || {};
    if (sameSnapshot(current, reportDate, snapshotId) && membershipCount(current) === expected) return false;
    const seeded = applyExpectedCeafSourceTotal({ ...current }, expected, reportDate, snapshotId);
    seeded.__v149CanonicalCurrent = true;
    seeded.__v149ExpectedSourceTotal = expected;
    businessStates.CEAF = seeded;
    sourceMismatchBanner('CEAF', expected, expected);
    return true;
  }

  async function ensureCurrentBusinessTruth(page = '', force = false) {
    const normalizedPage = String(page || (typeof currentPage !== 'undefined' ? currentPage : '')).toLowerCase();
    const type = PAGE_TYPE[normalizedPage];
    if (!type || typeof businessStates === 'undefined') return;
    const existing = inFlightByType.get(type);
    if (existing) return existing;

    const task = (async () => {
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
          let canonical = installV55CurrentGuard(current);
          canonical.__v149CanonicalCurrent = true;
          canonical.__v149ExpectedSourceTotal = Number.isFinite(expected) ? expected : undefined;
          const actual = membershipCount(canonical);
          if (!Number.isFinite(expected) || actual === expected) {
            businessStates[type] = canonical;
            sourceMismatchBanner(type, expected, actual);
            currentSourceBanner(type, reportDate, actual);
            verifiedAt.set(verifyKey, Date.now());
            return;
          }
        }

        if (!force && Date.now() - Number(verifiedAt.get(verifyKey) || 0) < 60_000) return;

        const result = await readJson(`/api/business-state/${encodeURIComponent(type)}?snapshotId=${encodeURIComponent(snapshotId)}&compact=1`);
        let live = installV55CurrentGuard(result?.state || {});
        if (type === 'CEAF' && Number.isFinite(expected) && membershipCount(live) !== expected) {
          live = applyExpectedCeafSourceTotal(live, expected, reportDate, snapshotId);
        }
        live.__v149CanonicalCurrent = true;
        live.__v149ExpectedSourceTotal = Number.isFinite(expected) ? expected : undefined;
        businessStates[type] = live;
        verifiedAt.set(verifyKey, Date.now());
        const actual = membershipCount(live);
        sourceMismatchBanner(type, expected, actual);
        currentSourceBanner(type, reportDate, actual);
        if (String(typeof currentPage !== 'undefined' ? currentPage : '').toLowerCase() === normalizedPage && typeof renderAll === 'function') renderAll();
      } catch (error) {
        console.warn('[CE-QC][V203_CURRENT_BUSINESS_TRUTH]', type, error?.message || error);
      } finally {
        inFlightByType.delete(type);
      }
    })();
    inFlightByType.set(type, task);
    return task;
  }

  if (typeof hydratePageData === 'function') {
    const originalHydratePageData = hydratePageData;
    hydratePageData = async function v203HydratePageData(page) {
      const seeded = seedCeafImmediately(page);
      if (seeded && String(typeof currentPage !== 'undefined' ? currentPage : '').toLowerCase() === 'ceaf' && typeof renderAll === 'function') {
        renderAll();
      }
      const result = await originalHydratePageData(page);
      // Exact reconciliation is intentionally non-blocking. The V109 summary-first
      // navigation path must remain instant; the 22 GiB SQLite read may finish later.
      void ensureCurrentBusinessTruth(page, false);
      return result;
    };
  }

  document.addEventListener('ce-qc-run-complete', () => setTimeout(() => ensureCurrentBusinessTruth('', true), 250));
  document.addEventListener('click', () => setTimeout(cleanWhppBackgroundStatus, 0), true);
  global.addEventListener('popstate', () => setTimeout(cleanWhppBackgroundStatus, 0));
  const observer = new MutationObserver(() => cleanWhppBackgroundStatus());
  const observe = () => {
    if (document.body) observer.observe(document.body, { childList:true, subtree:true });
    cleanWhppBackgroundStatus();
  };

  const start = () => {
    const run = () => void ensureCurrentBusinessTruth();
    if ('requestIdleCallback' in global) global.requestIdleCallback(run, { timeout: 1500 });
    else setTimeout(run, 500);
    observe();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();

  global.__CE_QC_V166_CURRENT_BUSINESS_TRUTH__ = { version: VERSION, compatVersion:GOLIVE_COMPAT_VERSION, ensure: ensureCurrentBusinessTruth, verifiedAt, pending: () => inFlightByType.size, cleanWhppBackgroundStatus, seedCeafImmediately };
  console.info('[CE-QC][V203_CURRENT_BUSINESS_TRUTH]', VERSION);
})(window);