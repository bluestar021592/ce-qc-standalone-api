(function installWhppUnifiedIntegrationV54(global) {
  if (global.__CE_QC_V54_WHPP_COMPAT__) return;

  const VERSION = '2026-08-12-v54-whpp-unified-integration-v8';

  async function post(url) {
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || data.ok === false) throw new Error(data.error || data.message || `HTTP ${response.status}`);
    return data;
  }

  function installPauseBridge() {
    const original = global.pauseUnified;
    if (typeof original !== 'function' || original.__v54WhppPauseBridge) return;

    const wrapped = async function () {
      const tasks = [Promise.resolve().then(() => original.apply(this, arguments)), post('/api/whpp/run/pause')];
      const results = await Promise.allSettled(tasks);
      const fatal = results.find(result => result.status === 'rejected');
      if (fatal) console.warn('[CE-QC][V54_PAUSE]', fatal.reason);
      return results;
    };
    wrapped.__v54WhppPauseBridge = true;
    global.pauseUnified = wrapped;
  }

  function install() {
    // V47 is now the authoritative seven-business start/resume orchestrator.
    // V64/V68 are the authoritative lightweight import/home renderers.
    // V54 intentionally does not reassign runUnified/resumeUnified, does not read
    // the multi-megabyte WHPP state, and does not observe the whole application DOM.
    installPauseBridge();
    global.__CE_QC_V54_WHPP_COMPAT__ = { version: VERSION, pauseBridge: true };
    console.info('[CE-QC][WHPP_UNIFIED_V54_COMPAT]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);
