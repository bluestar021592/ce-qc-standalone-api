(function installResilientRunGuardV67(global) {
  if (global.__CE_QC_V67_RESILIENT_RUN_GUARD__) return;

  const VERSION = '2026-08-12-v67-resilient-run-guard-v1';
  const priorFetch = global.fetch.bind(global);
  const readCache = new Map();
  const CACHE_TTL_MS = 30 * 60 * 1000;
  let runBusy = false;

  function urlOf(input) {
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

  function headerValue(init, name) {
    try { return new Headers(init?.headers || {}).get(name) || ''; } catch { return ''; }
  }

  function cacheableRead(url) {
    if (!url || url.origin !== location.origin) return false;
    const path = url.pathname;
    return path === '/api/import/unified-latest'
      || path === '/api/state'
      || path === '/api/shopee/state'
      || path === '/api/v51/whpp-state';
  }

  function cacheKey(url) {
    return `${url.pathname}${url.search}`;
  }

  function responseFrom(entry) {
    return new Response(entry.body, {
      status: entry.status,
      statusText: entry.statusText,
      headers: entry.headers
    });
  }

  global.fetch = async function v67Fetch(input, init) {
    const method = methodOf(input, init);
    const url = urlOf(input);
    const liveOnly = headerValue(init, 'X-CE-QC-V67-Live') === '1';
    if (method !== 'GET' || liveOnly || !cacheableRead(url)) return priorFetch(input, init);

    const key = cacheKey(url);
    try {
      const response = await priorFetch(input, init);
      if (response.ok) {
        const copy = response.clone();
        copy.text().then(body => {
          readCache.set(key, {
            body,
            status: response.status,
            statusText: response.statusText,
            headers: [...response.headers.entries()],
            savedAt: Date.now()
          });
        }).catch(() => {});
      }
      return response;
    } catch (error) {
      const cached = readCache.get(key);
      if (cached && Date.now() - cached.savedAt <= CACHE_TTL_MS) {
        console.warn('[CE-QC][V67] read interrupted, serving last good dashboard truth:', key);
        return responseFrom(cached);
      }
      throw error;
    }
  };

  async function readJson(url, options = {}, { live = false } = {}) {
    const headers = new Headers(options.headers || {});
    if (live) headers.set('X-CE-QC-V67-Live', '1');
    let response;
    try {
      response = await global.fetch(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        ...options,
        headers
      });
    } catch (cause) {
      const error = new Error('与后台连接中断');
      error.code = 'NETWORK_CONNECTION_INTERRUPTED';
      error.cause = cause;
      throw error;
    }
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || payload.message || `HTTP ${response.status}`);
      error.code = payload.code || `HTTP_${response.status}`;
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function stateOf(payload) {
    return payload?.state || payload || {};
  }

  function isFinished(payload) {
    const state = stateOf(payload);
    const phase = String(state?.processing?.phase || '').trim();
    const error = String(state?.processing?.error || '').trim();
    const status = String(payload?.snapshotStatus || state?.snapshotStatus || '').toUpperCase();
    return Boolean(state?.reportDate)
      && !error
      && (status === 'COMPLETED' || /^(完成|处理完成)$/.test(phase));
  }

  function isRunning(payload) {
    return Boolean(stateOf(payload)?.processing?.running);
  }

  function stateError(payload) {
    return String(stateOf(payload)?.processing?.error || '').trim();
  }

  function whppNeedsRun(payload) {
    const state = stateOf(payload);
    const total = Number(payload?.dashboard?.metrics?.total || state?.pnhBills?.length || 0);
    const unresolved = Number(payload?.dashboard?.metrics?.unresolved || 0);
    const status = String(payload?.snapshotStatus || state?.snapshotStatus || '').toUpperCase();
    if (!state?.dailyReportReady || total <= 0) return false;
    return !(status === 'COMPLETED' && unresolved === 0);
  }

  async function readRunStates({ live = true } = {}) {
    const requests = [
      readJson('/api/state?compact=1', {}, { live }),
      readJson('/api/shopee/state?compact=1', {}, { live }),
      readJson('/api/v51/whpp-state', {}, { live })
    ];
    const results = await Promise.allSettled(requests);
    if (results.every(item => item.status === 'rejected')) {
      const error = new Error('后台当前不可连接');
      error.code = 'NETWORK_CONNECTION_INTERRUPTED';
      throw error;
    }
    return {
      ccsl: results[0].status === 'fulfilled' ? results[0].value : {},
      shopee: results[1].status === 'fulfilled' ? results[1].value : {},
      whpp: results[2].status === 'fulfilled' ? results[2].value : {}
    };
  }

  function statusNode() { return document.getElementById('ccslRunStatus'); }
  function runButton() { return document.querySelector('[data-testid="global-auto-process"]'); }

  function setStatus(kind, text) {
    const node = statusNode();
    if (node) node.innerHTML = `<span class="status-pill ${kind}">${String(text || '')}</span>`;
  }

  function setBusy(value, text = '') {
    runBusy = Boolean(value);
    const button = runButton();
    if (!button) return;
    button.disabled = runBusy;
    button.textContent = runBusy ? (text || '正在处理…') : '开始全自动';
  }

  function transient(error) {
    return error?.code === 'NETWORK_CONNECTION_INTERRUPTED'
      || /socket hang up|ECONNRESET|ETIMEDOUT|timeout|连接中断|网络中断|fetch failed|failed to fetch/i.test(String(error?.message || error || ''));
  }

  function alreadyComplete(error) {
    return /RUN_ALREADY_COMPLETED|RUN_NOT_RECOVERABLE|当前任务已经完成|已经完成|不能继续处理|already\s*(?:completed|finished)/i.test([
      error?.code, error?.message, error?.payload?.code, error?.payload?.error
    ].filter(Boolean).join(' '));
  }

  function stateForStage(states, key) {
    return key === 'CCSL' ? states.ccsl : key === 'SHOPEE' ? states.shopee : states.whpp;
  }

  async function waitForStage(key, label, maxMs = 10 * 60 * 1000) {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      let states;
      try { states = await readRunStates({ live: true }); }
      catch { continue; }
      const current = stateForStage(states, key);
      if (isFinished(current) || (key === 'WHPP' && !whppNeedsRun(current))) return { done: true, states };
      const message = stateError(current);
      if (message && !isRunning(current)) {
        const error = new Error(message);
        error.code = 'STAGE_FAILED';
        error.states = states;
        throw error;
      }
      if (!isRunning(current)) return { done: false, states };
      setStatus('warning', `${label} 后台仍在处理，页面正在从断点读取进度…`);
    }
    const error = new Error(`${label}处理时间较长，后台任务仍保留，可稍后继续检查`);
    error.code = 'STAGE_WAIT_TIMEOUT';
    throw error;
  }

  async function postStage(key, label, startUrl, resumeUrl, preferResume) {
    let useResume = Boolean(preferResume);
    const delays = [0, 2000, 5000, 10000];
    let lastError = null;

    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (delays[attempt]) await new Promise(resolve => setTimeout(resolve, delays[attempt]));
      const url = useResume ? resumeUrl : startUrl;
      setBusy(true, `正在处理${label}…`);
      setStatus('warning', `${label}处理中${attempt ? ` · 第${attempt + 1}次恢复` : ''}，请勿重新上传日报。`);
      try {
        await readJson(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        }, { live: true });
        return;
      } catch (error) {
        lastError = error;
        if (alreadyComplete(error)) return;

        if (error.code === 'RUN_NOT_RECOVERABLE' && useResume) {
          useResume = false;
          continue;
        }

        if (error.code === 'NETWORK_CONNECTION_INTERRUPTED') {
          try {
            const check = await waitForStage(key, label, 30000);
            if (check.done) return;
          } catch (waitError) {
            lastError = waitError;
          }
        }

        if (!transient(lastError) || attempt === delays.length - 1) throw lastError;
        useResume = true;
      }
    }
    throw lastError || new Error(`${label}处理失败`);
  }

  async function refreshPageState() {
    try {
      if (typeof global.refresh === 'function') await global.refresh();
      else global.location.reload();
    } catch {}
  }

  async function executeUnified(mode = 'start') {
    if (runBusy) return;
    setBusy(true, '正在检查处理状态…');
    try {
      const states = await readRunStates({ live: true });
      const stages = [];
      if (!isFinished(states.ccsl)) stages.push(['CCSL', 'CCSL（CE/CEAF/TBKH/ALI1688）', '/api/run', '/api/resume']);
      if (!isFinished(states.shopee)) stages.push(['SHOPEE', 'SHOPEE CN/VN', '/api/shopee/run/start', '/api/shopee/run/resume']);
      if (whppNeedsRun(states.whpp)) stages.push(['WHPP', 'WHPP本土', '/api/whpp/run/start', '/api/whpp/run/resume']);

      if (!stages.length) {
        setStatus('success', '七业务均已完成，无需重复处理。');
        await refreshPageState();
        return;
      }

      for (const [key, label, startUrl, resumeUrl] of stages) {
        await postStage(key, label, startUrl, resumeUrl, mode === 'resume');
      }

      setStatus('success', '七业务处理完成，历史快照已保留。');
      await refreshPageState();
    } catch (error) {
      console.error('[CE-QC][V67_RESILIENT_RUN]', error);
      if (transient(error)) {
        setStatus('danger', '后台/CE接口连接中断。已完成进度和日报均已保存；请勿重新上传，后台恢复后点击“继续处理”。');
      } else {
        setStatus('danger', `处理未完成：${String(error.message || error)}。已保存断点，可继续处理。`);
      }
    } finally {
      setBusy(false);
    }
  }

  function installRunOverride() {
    global.runUnified = () => executeUnified('start');
    global.resumeUnified = () => executeUnified('resume');
    console.info('[CE-QC][V67_RESILIENT_RUN_GUARD]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installRunOverride, { once: true });
  else installRunOverride();

  global.__CE_QC_V67_RESILIENT_RUN_GUARD__ = {
    version: VERSION,
    readCacheSize: () => readCache.size,
    clearReadCache: () => readCache.clear()
  };
})(window);
