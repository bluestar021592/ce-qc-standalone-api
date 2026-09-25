(function (global) {
  const dates = ['07-14', '07-15', '07-16', '07-17', '07-18', '07-19', '07-20'];
  global.DashboardFixtureV18 = {
    dates,
    trends: {
      tickets: [17895, 18120, 18010, 18340, 18190, 18480, 18642],
      podCe: [87.6, 88.1, null, 88.2, 88.6, 88.0, 88.5],
      podPp: [90.3, 90.8, null, 90.1, 89.8, 89.9, 90.1],
      podPv: [81.2, 82.0, null, 83.1, 83.2, 82.9, 83.3],
      ocCe: [0.62, 0.74, null, 0.81, 0.76, 0.83, 0.9],
      ocPp: [0.12, 0.16, null, 0.13, 0.1, 0.08, 0],
      ocPv: [0.21, 0.18, null, 0.14, 0.1, 0.06, 0],
      firstCe: [87.1, 87.8, null, 88.0, 87.9, 88.3, null],
      firstShopee: [82.9, 83.1, null, 83.5, 83.7, 83.8, 84.05]
    }
  };
})(window);

(function installV533FirstPaintStartupGuard(global) {
  if (!global || !global.document || global.__CE_QC_V533_FIRST_PAINT_STARTUP_GUARD__) return;
  const PATCH_ID = '2026-09-14-v533-first-paint-bounded-startup-read-v1';
  const V535_PATCH_ID = '2026-09-14-v535-interactive-first-paint-body-bounded-v1';
  const V564_PATCH_ID = '2026-09-21-v564-startup-interaction-no-toast-v1';
  const V565_PATCH_ID = '2026-09-21-v565-interaction-surface-self-heal-v1';
  global.__CE_QC_V533_FIRST_PAINT_STARTUP_GUARD__ = PATCH_ID;
  global.__CE_QC_V535_INTERACTIVE_FIRST_PAINT__ = V535_PATCH_ID;
  global.__CE_QC_V564_STARTUP_INTERACTION__ = V564_PATCH_ID;
  global.__CE_QC_V565_INTERACTION_SURFACE__ = V565_PATCH_ID;
  const document = global.document;

  const STARTUP_TIMEOUT_MS = 3000;
  const STARTUP_GUARD_WINDOW_MS = 15000;
  const startupGuardDeadline = Date.now() + STARTUP_GUARD_WINDOW_MS;
  const startupRead = pathname => pathname === '/api/bootstrap'
    || pathname === '/api/state'
    || pathname === '/api/shopee/state'
    || pathname === '/api/ce-auth-status'
    || pathname === '/api/session'
    || pathname === '/api/history'
    || pathname === '/api/unified-history'
    || pathname === '/api/import/unified-latest'
    || pathname.startsWith('/api/business-state/');

  const nativeFetch = typeof global.fetch === 'function' ? global.fetch.bind(global) : null;
  if (nativeFetch) {
    global.fetch = function v533BoundedStartupFetch(input, init = {}) {
      let pathname = '';
      try {
        const raw = typeof input === 'string' ? input : input?.url;
        pathname = new URL(raw || '', global.location?.href || 'http://127.0.0.1:5177/').pathname;
      } catch {}
      const method = String(init?.method || (typeof input === 'object' ? input?.method : '') || 'GET').toUpperCase();
      if (Date.now() > startupGuardDeadline || method !== 'GET' || !startupRead(pathname) || init?.signal) return nativeFetch(input, init);

      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      if (!controller) return nativeFetch(input, init);
      let fetchSettled = false;
      let timedOut = false;
      let timer = null;
      return new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          try { controller.abort(); } catch {}
          // If response headers have not arrived yet, preserve V533 compatibility by
          // returning a finite synthetic failure. If headers already arrived, the
          // abort remains armed against response.text()/json() so a large/stalled
          // body cannot freeze the first interactive render indefinitely.
          if (!fetchSettled) {
            fetchSettled = true;
            const body = JSON.stringify({
              ok: false,
              code: 'V533_STARTUP_READ_TIMEOUT',
              error: '启动数据读取超过3秒，已跳过本次慢请求，页面继续打开。'
            });
            resolve(new Response(body, {
              status: 504,
              headers: {
                'content-type': 'application/json',
                'x-ce-qc-v533': PATCH_ID,
                'x-ce-qc-v535': V535_PATCH_ID
              }
            }));
          }
        }, STARTUP_TIMEOUT_MS);

        nativeFetch(input, { ...init, signal: controller.signal }).then(response => {
          if (fetchSettled) return;
          fetchSettled = true;
          // V535 intentionally does NOT clear the startup timer here. fetch() resolves
          // when headers arrive; keeping the controller alive until the 3-second wall
          // clock expires also bounds response body transfer/consumption.
          resolve(response);
        }).catch(error => {
          if (fetchSettled || timedOut && error?.name === 'AbortError') return;
          fetchSettled = true;
          if (timer) clearTimeout(timer);
          reject(error);
        });
      });
    };
  }

  function forceFirstPaint() {
    try {
      document.documentElement.style.background = '#f4f7fb';
      document.documentElement.style.pointerEvents = 'auto';
      document.body.style.background = '#f4f7fb';
      document.body.style.visibility = 'visible';
      document.body.style.opacity = '1';
      document.body.style.pointerEvents = 'auto';
      const stage = document.querySelector('.app-stage');
      if (stage) {
        stage.style.display = 'block';
        stage.style.visibility = 'visible';
        stage.style.opacity = '1';
        stage.style.minHeight = '100vh';
        stage.style.pointerEvents = 'auto';
      }
      const shell = document.querySelector('.app-shell');
      if (shell) {
        shell.style.display = 'block';
        shell.style.visibility = 'visible';
        shell.style.opacity = '1';
        shell.style.pointerEvents = 'auto';
      }
      document.getElementById('v533StartupNotice')?.remove();
    } catch {}
  }

  function clearNoticeWhenRendered() {
    const cards = document.getElementById('homeBusinessCards');
    if (!cards || !cards.children.length) return false;
    document.getElementById('v533StartupNotice')?.remove();
    return true;
  }

  function forceInteractivePaint() {
    try {
      const nodes = [
        document.documentElement,
        document.body,
        document.querySelector('.app-stage'),
        document.querySelector('.app-shell'),
        document.querySelector('.app-body'),
        document.querySelector('.sidebar'),
        document.querySelector('.topbar'),
        document.querySelector('.main-content')
      ].filter(Boolean);
      for (const node of nodes) {
        if (node.style?.setProperty) node.style.setProperty('pointer-events', 'auto', 'important');
        else node.style.pointerEvents = 'auto';
        try { node.removeAttribute?.('inert'); } catch {}
      }
      document.querySelectorAll?.(
        '.side-link,button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[onclick],.v18-business-card,.v18-metric-card,.region-block button'
      )?.forEach?.(node => {
        if (node.style?.setProperty) node.style.setProperty('pointer-events', 'auto', 'important');
        else if (node.style) node.style.pointerEvents = 'auto';
        try { node.removeAttribute?.('inert'); } catch {}
      });
      document.getElementById('v533StartupNotice')?.remove();
      document.documentElement.dataset.ceQcInteractionReady = V565_PATCH_ID;
    } catch {}
  }

  function isLegitimateBlockingLayer(node) {
    try {
      if (!node || node === document.documentElement || node === document.body) return true;
      if (node.closest?.('.modal:not([hidden])')) return true;
      if (node.closest?.('#v303CleanStartOverlay')) return true;
      if (node.closest?.('#accountDropdown:not([hidden])')) return true;
      return false;
    } catch { return false; }
  }

  function largeClickBlocker(node, control) {
    try {
      if (!node || !control || node === control || control.contains?.(node) || node.contains?.(control)) return false;
      if (isLegitimateBlockingLayer(node)) return false;
      const rect = node.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      const viewportW = Math.max(1, Number(global.innerWidth || document.documentElement?.clientWidth || 1));
      const viewportH = Math.max(1, Number(global.innerHeight || document.documentElement?.clientHeight || 1));
      const areaRatio = (rect.width * rect.height) / (viewportW * viewportH);
      const style = typeof global.getComputedStyle === 'function' ? global.getComputedStyle(node) : null;
      const position = String(style?.position || node.style?.position || '').toLowerCase();
      const z = Number.parseInt(style?.zIndex || node.style?.zIndex || '0', 10) || 0;
      return areaRatio >= 0.35 && (position === 'fixed' || position === 'absolute' || z >= 50);
    } catch { return false; }
  }

  function retireBlocker(node) {
    try {
      if (!node?.style) return false;
      if (node.style.setProperty) node.style.setProperty('pointer-events', 'none', 'important');
      else node.style.pointerEvents = 'none';
      node.dataset.ceQcRetiredClickBlocker = V565_PATCH_ID;
      return true;
    } catch { return false; }
  }

  function repairControlHitTarget(control) {
    try {
      if (!control || typeof document.elementsFromPoint !== 'function') return false;
      const rect = control.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      const x = Math.max(rect.left + 1, Math.min(rect.right - 1, rect.left + rect.width / 2));
      const y = Math.max(rect.top + 1, Math.min(rect.bottom - 1, rect.top + rect.height / 2));
      const stack = document.elementsFromPoint(x, y) || [];
      const controlIndex = stack.findIndex(node => node === control || control.contains?.(node));
      if (controlIndex <= 0) return false;
      let changed = false;
      for (const node of stack.slice(0, controlIndex)) {
        if (largeClickBlocker(node, control)) changed = retireBlocker(node) || changed;
      }
      return changed;
    } catch { return false; }
  }

  function repairInteractionSurface() {
    forceInteractivePaint();
    try {
      const representatives = [
        document.querySelector('.sidebar .side-link[data-page]'),
        document.getElementById('topRangeQuery'),
        document.querySelector('#homeBusinessCards .v18-business-card'),
        document.querySelector('.main-content button:not(:disabled)')
      ].filter(Boolean);
      for (const control of representatives) repairControlHitTarget(control);
    } catch {}
  }

  let redispatching = false;
  function findUnderlyingInteractive(event) {
    try {
      if (typeof document.elementsFromPoint !== 'function') return null;
      const stack = document.elementsFromPoint(Number(event.clientX || 0), Number(event.clientY || 0)) || [];
      for (const node of stack) {
        const candidate = node?.closest?.('.side-link[data-page],button:not(:disabled),a[href],[onclick],input:not(:disabled),select:not(:disabled),.v18-business-card,.v18-metric-card,.region-block button');
        if (candidate) return candidate;
      }
    } catch {}
    return null;
  }

  function repairBlockedPointer(event) {
    if (redispatching) return;
    repairInteractionSurface();
    try {
      const target = event.target;
      const direct = target?.closest?.('.side-link[data-page],button:not(:disabled),a[href],[onclick],input:not(:disabled),select:not(:disabled),.v18-business-card,.v18-metric-card,.region-block button');
      if (direct) return;
      const candidate = findUnderlyingInteractive(event);
      if (!candidate) return;
      const stack = typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(Number(event.clientX || 0), Number(event.clientY || 0)) || []
        : [];
      const candidateIndex = stack.findIndex(node => node === candidate || candidate.contains?.(node));
      if (candidateIndex <= 0) return;
      let repaired = false;
      for (const node of stack.slice(0, candidateIndex)) {
        if (largeClickBlocker(node, candidate)) repaired = retireBlocker(node) || repaired;
      }
      if (!repaired || event.type !== 'click') return;
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      redispatching = true;
      setTimeout(() => {
        try { candidate.click?.(); }
        finally { redispatching = false; }
      }, 0);
    } catch {}
  }

  function installInteractionCapture() {
    if (typeof global.addEventListener !== 'function') return;
    global.addEventListener('pointerdown', repairBlockedPointer, true);
    global.addEventListener('click', repairBlockedPointer, true);
  }

  forceFirstPaint();
  installInteractionCapture();
  repairInteractionSurface();
  // V564/V565 never paint a startup toast and never call renderAll from the guard.
  // It only guarantees clickability after parser-blocking scripts finish.
  setTimeout(repairInteractionSurface, 0);
  setTimeout(repairInteractionSurface, 250);
  setTimeout(repairInteractionSurface, 750);
  setTimeout(repairInteractionSurface, 1500);
  setTimeout(repairInteractionSurface, 3000);

  if (!clearNoticeWhenRendered()) {
    // Do not watch the whole dashboard subtree. Rendering cards/tables can generate a
    // large burst of childList mutations; a body-wide MutationObserver here adds no
    // business value and can starve the renderer during first paint.
    [100, 500, 1500, 3000, 5000].forEach(ms => setTimeout(clearNoticeWhenRendered, ms));
  }

  // V564: no automatic rescue refresh. Startup recovery stays read-only/lightweight
  // so a slow local SQLite read can never restart a render or interaction loop.
  setTimeout(repairInteractionSurface, 5000);

})(window);
