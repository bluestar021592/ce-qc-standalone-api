(function installWhppLightStateBridgeV72(global) {
  if (global.__CE_QC_V72_WHPP_LIGHT_STATE_BRIDGE__) return;

  const VERSION = '2026-08-21-v204-whpp-silent-background-verify-v1';
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

  function cleanWhppBackgroundVerification() {
    if (String(global.location.pathname || '').toLowerCase() !== '/whpp') return;
    const page = document.getElementById('whppFastPage');
    if (!page || page.hidden) return;
    page.querySelectorAll('.processing-notice,.global-processing-notice').forEach(node => {
      const value = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (/正在后台校验最新WHPP摘要|已先显示本机最近验证数据.*后台.*校验最新值/.test(value)) node.remove();
    });
  }

  let queued = false;
  function scheduleClean() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      cleanWhppBackgroundVerification();
    });
  }

  function installCleanGuard() {
    const observer = new MutationObserver(scheduleClean);
    observer.observe(document.body, { subtree:true, childList:true, characterData:true });
    document.addEventListener('click', scheduleClean, true);
    global.addEventListener('popstate', scheduleClean);
    scheduleClean();
    global.__CE_QC_V72_WHPP_CLEAN_OBSERVER__ = observer;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installCleanGuard, { once:true });
  else installCleanGuard();

  global.__CE_QC_V72_WHPP_LIGHT_STATE_BRIDGE__ = { version: VERSION, clean: cleanWhppBackgroundVerification };
  console.info('[CE-QC][V72_WHPP_LIGHT_STATE_BRIDGE]', VERSION);
})(window);
