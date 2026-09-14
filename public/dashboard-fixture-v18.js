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
  global.__CE_QC_V533_FIRST_PAINT_STARTUP_GUARD__ = PATCH_ID;
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
      let settled = false;
      let timer = null;
      return new Promise((resolve, reject) => {
        const finish = callback => value => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          callback(value);
        };
        const resolveOnce = finish(resolve);
        const rejectOnce = finish(reject);
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { controller.abort(); } catch {}
          const body = JSON.stringify({
            ok: false,
            code: 'V533_STARTUP_READ_TIMEOUT',
            error: '启动数据读取超过3秒，已跳过本次慢请求，页面继续打开。'
          });
          resolve(new Response(body, {
            status: 504,
            headers: { 'content-type': 'application/json', 'x-ce-qc-v533': PATCH_ID }
          }));
        }, STARTUP_TIMEOUT_MS);
        nativeFetch(input, { ...init, signal: controller.signal }).then(resolveOnce).catch(error => {
          if (settled && error?.name === 'AbortError') return;
          rejectOnce(error);
        });
      });
    };
  }

  function forceFirstPaint() {
    try {
      document.documentElement.style.background = '#f4f7fb';
      document.body.style.background = '#f4f7fb';
      document.body.style.visibility = 'visible';
      document.body.style.opacity = '1';
      const stage = document.querySelector('.app-stage');
      if (stage) {
        stage.style.display = 'block';
        stage.style.visibility = 'visible';
        stage.style.opacity = '1';
        stage.style.minHeight = '100vh';
      }
      const shell = document.querySelector('.app-shell');
      if (shell) {
        shell.style.display = 'block';
        shell.style.visibility = 'visible';
        shell.style.opacity = '1';
      }
      if (!document.getElementById('v533StartupNotice')) {
        const notice = document.createElement('div');
        notice.id = 'v533StartupNotice';
        notice.setAttribute('data-v533-first-paint', PATCH_ID);
        notice.textContent = '系统界面已加载，正在读取本地数据…';
        notice.style.cssText = 'position:fixed;z-index:2147483000;top:10px;left:50%;transform:translateX(-50%);padding:7px 14px;border:1px solid #cfe0f4;border-radius:6px;background:#fff;color:#31587f;font:12px/1.4 "Microsoft YaHei",sans-serif;box-shadow:0 2px 10px #173b681a;pointer-events:none';
        document.body.appendChild(notice);
      }
    } catch {}
  }

  function clearNoticeWhenRendered() {
    const cards = document.getElementById('homeBusinessCards');
    if (!cards || !cards.children.length) return false;
    document.getElementById('v533StartupNotice')?.remove();
    return true;
  }

  forceFirstPaint();
  if (!clearNoticeWhenRendered()) {
    const observer = new MutationObserver(() => {
      if (clearNoticeWhenRendered()) observer.disconnect();
    });
    try { observer.observe(document.body, { childList: true, subtree: true }); } catch {}
    setTimeout(() => observer.disconnect(), 30000);
  }

  // One bounded rescue refresh is allowed after the first startup window. This is
  // intentionally single-shot: it cannot create a polling loop or repeat business
  // processing. It only re-reads the same startup status endpoints.
  setTimeout(() => {
    try {
      if (clearNoticeWhenRendered()) return;
      if (typeof global.refresh === 'function') {
        Promise.resolve(global.refresh()).catch(() => {}).finally(clearNoticeWhenRendered);
      }
    } catch {}
  }, 8000);
})(window);
