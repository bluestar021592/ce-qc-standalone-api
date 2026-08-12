(function installWhppLightStateBridgeV72(global) {
  if (global.__CE_QC_V72_WHPP_LIGHT_STATE_BRIDGE__) return;

  const VERSION = '2026-08-12-v72-whpp-light-state-bridge-v1';
  const originalFetch = global.fetch.bind(global);

  function rewrite(input) {
    const raw = typeof input === 'string' ? input : (input instanceof URL ? input.href : String(input?.url || ''));
    if (!raw) return null;
    let url;
    try { url = new URL(raw, global.location.origin); } catch { return null; }
    if (url.origin !== global.location.origin || url.pathname !== '/api/whpp/state') return null;
    const reportDate = String(url.searchParams.get('reportDate') || '').slice(0, 10);
    const next = new URL('/api/v71/whpp-summary', global.location.origin);
    if (reportDate) next.searchParams.set('reportDate', reportDate);
    return `${next.pathname}${next.search}`;
  }

  global.fetch = function v72WhppLightFetch(input, init) {
    const rewritten = rewrite(input);
    if (!rewritten) return originalFetch(input, init);
    const method = String(init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();
    if (method !== 'GET') return originalFetch(input, init);
    return originalFetch(rewritten, { ...(init || {}), cache: 'no-store', credentials: 'same-origin' });
  };

  global.__CE_QC_V72_WHPP_LIGHT_STATE_BRIDGE__ = { version: VERSION };
  console.info('[CE-QC][V72_WHPP_LIGHT_STATE_BRIDGE]', VERSION);
})(window);
