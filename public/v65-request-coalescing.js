(function installRequestCoalescingV65(global) {
  if (global.__CE_QC_V65_REQUEST_COALESCING__) return;

  const VERSION = '2026-08-13-v95-request-coalescing-v2';
  const nativeFetch = global.fetch.bind(global);
  const inflight = new Map();
  const recent = new Map();
  const RECENT_TTL_MS = 15000;
  const MAX_RECENT = 32;

  function asUrl(input) {
    try {
      if (typeof input === 'string') return new URL(input, location.origin);
      if (input instanceof URL) return new URL(input.href);
      if (input instanceof Request) return new URL(input.url);
    } catch {}
    return null;
  }

  function methodOf(input, init) {
    return String(init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
  }

  function isSameOrigin(url) {
    return Boolean(url && url.origin === location.origin);
  }

  function isHeavyRead(url) {
    const path = url.pathname;
    return path === '/api/bootstrap'
      || path === '/api/import/unified-latest'
      || path === '/api/state'
      || path === '/api/shopee/state'
      || path === '/api/v89/instant-dashboard'
      || path === '/api/v89/shopee-whpp-detail'
      || path === '/api/v71/whpp-summary'
      || /^\/api\/business-state\//.test(path)
      || /\/whpp-state$/.test(path)
      || /\/reconciliation$/.test(path)
      || /\/trends$/.test(path)
      || /\/routing$/.test(path);
  }

  function requestKey(url) {
    return `${url.pathname}${url.search}`;
  }

  function clearRecent() {
    recent.clear();
  }

  function pruneRecent() {
    const now = Date.now();
    for (const [key, entry] of recent) {
      if (!entry || entry.expiresAt <= now) recent.delete(key);
    }
    while (recent.size > MAX_RECENT) {
      const first = recent.keys().next().value;
      if (first === undefined) break;
      recent.delete(first);
    }
  }

  global.fetch = function v65Fetch(input, init) {
    const method = methodOf(input, init);
    const url = asUrl(input);

    // Every write may change dashboard truth, so invalidate immediately before it.
    if (method !== 'GET') {
      clearRecent();
      return nativeFetch(input, init);
    }
    if (!isSameOrigin(url) || !isHeavyRead(url)) return nativeFetch(input, init);

    pruneRecent();
    const key = requestKey(url);
    const cached = recent.get(key);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.response.clone());

    const active = inflight.get(key);
    if (active) return active.then(response => response.clone());

    const pending = nativeFetch(input, init)
      .then(response => {
        const template = response.clone();
        if (response.ok) {
          recent.set(key, {
            response: template.clone(),
            expiresAt: Date.now() + RECENT_TTL_MS
          });
          pruneRecent();
        }
        return template;
      })
      .finally(() => inflight.delete(key));

    inflight.set(key, pending);
    return pending.then(response => response.clone());
  };

  // Merely moving between CE / SHOPEE / WHPP pages does not change source data.
  // Keep the short read cache across navigation so the same dashboard/bootstrap
  // requests are not repeated on every menu click. Explicit range/date queries
  // and all writes still invalidate immediately.
  document.addEventListener('click', event => {
    if (event.target?.closest?.('#topRangeQuery,#dashboardRangeQuery')) clearRecent();
  }, true);
  document.addEventListener('change', event => {
    if (event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo')) clearRecent();
  }, true);

  global.__CE_QC_V65_REQUEST_COALESCING__ = {
    version: VERSION,
    clear: clearRecent,
    inflightCount: () => inflight.size,
    recentCount: () => recent.size
  };
  console.info('[CE-QC][REQUEST_COALESCING_V65]', VERSION);
})(window);
