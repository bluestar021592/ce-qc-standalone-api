(function installV149CurrentBusinessTruth(global) {
  if (global.__CE_QC_V149_CURRENT_BUSINESS_TRUTH__) return;
  global.__CE_QC_V149_CURRENT_BUSINESS_TRUTH__ = true;
  const VERSION = '2026-08-16-v149-current-business-truth-v2';
  const PAGE_TYPE = Object.freeze({ ce:'CE', ceaf:'CEAF', tbkh:'TBKH', ali1688:'ALI1688', shopeecn:'SHOPEECN', shopeevn:'SHOPEEVN' });
  let inFlight = null;

  function codeOf(value) {
    if (typeof value === 'string') return value.trim().toUpperCase();
    return String(value?.shipmentCode || value?.运单号 || value?.waybill || value?.billNo || '').trim().toUpperCase();
  }

  function restrictToCurrentMembers(state = {}) {
    const members = new Set((state.pnhBills || []).map(codeOf).filter(Boolean));
    if (!members.size) return state;
    const filterBills = rows => (rows || []).filter(item => members.has(codeOf(item)));
    const filterRows = rows => (rows || []).filter(item => members.has(codeOf(item)));
    return {
      ...state,
      pnhBills: [...members],
      carryBills: filterBills(state.carryBills),
      nextCarryBills: filterBills(state.nextCarryBills),
      podLocks: filterBills(state.podLocks),
      scanPool: filterBills(state.scanPool),
      scanRetryBills: filterBills(state.scanRetryBills),
      needTrackBills: filterBills(state.needTrackBills),
      dailyParseRows: filterRows(state.dailyParseRows),
      scanResults: filterRows(state.scanResults),
      trackResults: filterRows(state.trackResults),
      trackEvents: filterRows(state.trackEvents),
      finalRows: filterRows(state.finalRows),
      priorCarryRows: filterRows(state.priorCarryRows),
      finalDiversionRows: filterRows(state.finalDiversionRows),
      __v149CurrentMemberCount: members.size
    };
  }

  function membershipCount(state = {}) {
    const direct = Number(state.pnhBills?.length);
    if (Number.isFinite(direct) && direct >= 0 && Array.isArray(state.pnhBills)) return direct;
    const parsed = Number(state.dailyParseSummary?.totalRecognized);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  async function readJson(url) {
    const response = await fetch(url, { cache:'no-store', credentials:'same-origin' });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    return payload;
  }

  function sourceMismatchBanner(type, expected, actual) {
    let node = document.getElementById('v149CurrentSourceMismatch');
    if (!node) {
      node = document.createElement('div');
      node.id = 'v149CurrentSourceMismatch';
      node.className = 'global-processing-notice danger';
      document.querySelector('.main-content')?.prepend(node);
    }
    if (expected === actual) {
      node.hidden = true;
      return;
    }
    node.hidden = false;
    node.innerHTML = `<span><strong>${type} 当前日报数据对账失败</strong> · 日报分类 ${expected.toLocaleString('zh-CN')}票 · 当前业务成员 ${actual.toLocaleString('zh-CN')}票。系统已停止把旧缓存或历史遗留当作当前数据。</span>`;
  }

  async function ensureCurrentBusinessTruth(page = '') {
    const normalizedPage = String(page || (typeof currentPage !== 'undefined' ? currentPage : '')).toLowerCase();
    const type = PAGE_TYPE[normalizedPage];
    if (!type || typeof businessStates === 'undefined') return;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const latest = await readJson('/api/import/unified-latest');
        const imported = latest?.import || null;
        const reportDate = String(imported?.reportDate || '').trim();
        const snapshotId = String(imported?.snapshotId || '').trim();
        if (!reportDate || !snapshotId) return;
        const expected = Number(imported?.classificationCounts?.[type] || 0);

        const current = businessStates[type] || {};
        const alreadyCanonical = current.__v149CanonicalCurrent === true
          && String(current.snapshotId || '') === snapshotId
          && String(current.reportDate || '') === reportDate
          && !current._fastSqlSummary
          && !current._compact;
        if (alreadyCanonical) {
          const canonical = restrictToCurrentMembers(current);
          businessStates[type] = canonical;
          sourceMismatchBanner(type, expected, membershipCount(canonical));
          return;
        }

        // Current-day business pages must never use range/fast snapshot state as
        // their source of truth. Fetch exact membership by this import snapshotId.
        const result = await readJson(`/api/business-state/${encodeURIComponent(type)}?snapshotId=${encodeURIComponent(snapshotId)}`);
        const live = restrictToCurrentMembers(result?.state || {});
        live.__v149CanonicalCurrent = true;
        live.__v149ExpectedSourceTotal = expected;
        businessStates[type] = live;
        sourceMismatchBanner(type, expected, membershipCount(live));
        if (typeof renderAll === 'function') renderAll();
      } catch (error) {
        console.warn('[CE-QC][V149_CURRENT_BUSINESS_TRUTH]', error?.message || error);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  if (typeof hydratePageData === 'function') {
    const originalHydratePageData = hydratePageData;
    hydratePageData = async function v149HydratePageData(page) {
      await originalHydratePageData(page);
      await ensureCurrentBusinessTruth(page);
    };
  }

  document.addEventListener('ce-qc-run-complete', () => setTimeout(() => ensureCurrentBusinessTruth(), 150));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(() => ensureCurrentBusinessTruth(), 120), { once:true });
  else setTimeout(() => ensureCurrentBusinessTruth(), 120);
  console.info('[CE-QC][V149_CURRENT_BUSINESS_TRUTH]', VERSION);
})(window);
