(function installWhppSourceTruthRouteV52(global) {
  const VERSION = '2026-08-11-v52-whpp-source-truth-route-v1';
  const previousFetch = global.fetch.bind(global);

  function toUrl(input) {
    try {
      if (typeof input === 'string') return new URL(input, location.origin);
      if (input instanceof URL) return new URL(input.href);
      if (input instanceof Request) return new URL(input.url);
    } catch {}
    return null;
  }

  global.fetch = function v52WhppSourceTruthFetch(input, init) {
    const url = toUrl(input);
    if (!url || url.origin !== location.origin) return previousFetch(input, init);

    // V51 runtime accidentally forced the canonical WHPP reader back to the
    // older V50 endpoint. Route both canonical and explicit V50 state reads to
    // the V51 source-truth endpoint so terminal POD/return/cancel evidence is
    // actually used by the WHPP board.
    if (url.pathname === '/api/whpp/state' || url.pathname === '/api/v50/whpp-state') {
      url.pathname = '/api/v51/whpp-state';
      return previousFetch(url.pathname + url.search + url.hash, init);
    }

    return previousFetch(input, init);
  };

  console.info('[CE-QC][WHPP_SOURCE_TRUTH_V52]', VERSION);
})(window);
