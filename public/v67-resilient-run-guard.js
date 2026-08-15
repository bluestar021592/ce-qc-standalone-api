(function installResilientRunGuardV67(global) {
  if (global.__CE_QC_V67_RESILIENT_RUN_GUARD__) return;

  const VERSION = '2026-08-13-v67-seven-business-runner-v5';
  let busy = false;

  function wait(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0)))); }

  async function jsonFetch(url, options = {}) {
    let response;
    try {
      response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options });
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

  function stateOf(payload) { return payload?.state || payload || {}; }

  function completed(payload) {
    const state = stateOf(payload);
    const status = String(payload?.snapshotStatus || state?.snapshotStatus || (payload?.completed ? 'COMPLETED' : '')).toUpperCase();
    const runStatus = String(
      state?.currentRun?.status
      || state?.lastRunSummary?.runStatus
      || state?.lastRun?.runStatus
      || payload?.runStatus
      || ''
    ).toUpperCase();
    const phase = String(state?.processing?.phase || '').trim();
    return status === 'COMPLETED'
      || ['FINISHED', 'COMPLETED'].includes(runStatus)
      || /^(完成|处理完成)$/.test(phase);
  }

  function canResume(payload) {
    const state = stateOf(payload);
    const runStatus = String(
      state?.currentRun?.status
      || state?.lastRunSummary?.runStatus
      || state?.lastRun?.runStatus
      || ''
    ).toLowerCase();
    return Boolean(
      state?.processing?.running
      || state?.processing?.paused
      || ['running', 'paused', 'failed'].includes(runStatus)
    );
  }

  function hasReport(payload, type) {
    const state = stateOf(payload);
    if (type === 'WHPP') return Boolean(state?.dailyReportReady && Number(payload?.total || payload?.dashboard?.metrics?.total || 0) > 0);
    return Boolean(state?.reportDate && state?.dailyReportReady !== false);
  }

  function isAuth(error) {
    const status = Number(error?.status || error?.payload?.status || 0);
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '');
    return [401, 403].includes(status) || ['401','403','AUTH_REQUIRED'].includes(code)
      || /未授权|unauthorized|登录.*失效|token.*(?:过期|expired|invalid)/i.test(message);
  }

  function isTransient(error) {
    const status = Number(error?.status || 0);
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '');
    return ['NETWORK_CONNECTION_INTERRUPTED','ECONNRESET','ECONNABORTED','ETIMEDOUT'].includes(code)
      || [408,425,429,500,502,503,504].includes(status)
      || /socket hang up|connection reset|timeout|timed out|failed to fetch|fetch failed|连接中断|网络中断/i.test(message);
  }

  function alreadyDone(error) {
    return ['RUN_ALREADY_COMPLETED','WHPP_RUN_ALREADY_ACTIVE'].includes(String(error?.code || ''))
      || /已经完成|当前任务已经完成|already\s*(?:completed|finished)/i.test(String(error?.message || ''));
  }

  function noReport(error) {
    return ['WHPP_REPORT_MISSING','REPORT_MISSING','NO_DAILY_REPORT'].includes(String(error?.code || ''))
      || /未导入.*日报|没有.*日报/i.test(String(error?.message || ''));
  }

  function statusNode() { return document.getElementById('ccslRunStatus'); }
  function runButton() { return document.querySelector('[data-testid="global-auto-process"]'); }

  function setStatus(text, level = 'warning') {
    const node = statusNode();
    if (node) node.innerHTML = `<span class="status-pill ${level}">${String(text || '')}</span>`;
  }

  function setBusy(value, text = '') {
    busy = Boolean(value);
    const button = runButton();
    if (button) {
      button.disabled = busy;
      button.textContent = busy ? (text || '七业务处理中…') : '开始全自动';
    }
  }

  async function readStates() {
    const results = await Promise.allSettled([
      jsonFetch('/api/state?compact=1'),
      jsonFetch('/api/shopee/state?compact=1'),
      jsonFetch('/api/v71/whpp-summary')
    ]);
    return {
      CCSL: results[0].status === 'fulfilled' ? results[0].value : {},
      SHOPEE: results[1].status === 'fulfilled' ? results[1].value : {},
      WHPP: results[2].status === 'fulfilled' ? results[2].value : {}
    };
  }

  async function runStage(stage, preferResume) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const useResume = Boolean(preferResume || attempt > 0);
      const url = useResume ? stage.resume : stage.start;
      if (attempt) await wait(700 * attempt);
      setStatus(`${stage.label}${attempt ? `自动续跑 ${attempt + 1}/3` : '处理中'}…`);
      try {
        await jsonFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        return { label: stage.label, ok: true };
      } catch (error) {
        if (alreadyDone(error) || noReport(error)) return { label: stage.label, ok: true, skipped: true };
        if (isAuth(error)) throw error;
        lastError = error;
        if (!isTransient(error)) break;
      }
    }
    return { label: stage.label, ok: false, error: lastError?.message || String(lastError || '处理失败') };
  }

  async function execute(mode = 'start') {
    if (busy) return;
    setBusy(true, '正在检查七业务状态…');
    const results = [];
    try {
      const states = await readStates();
      const stages = [
        { key: 'CCSL', label: 'CCSL（CE/CEAF/TBKH/ALI1688）', start: '/api/run', resume: '/api/resume' },
        { key: 'SHOPEE', label: 'SHOPEE CN/VN', start: '/api/shopee/run/start', resume: '/api/shopee/run/resume' },
        { key: 'WHPP', label: 'WHPP本土', start: '/api/whpp/run/start', resume: '/api/whpp/run/resume' }
      ];

      for (const stage of stages) {
        const state = states[stage.key] || {};
        if (!hasReport(state, stage.key) || completed(state)) {
          results.push({ label: stage.label, ok: true, skipped: true });
          continue;
        }
        const preferResume = mode === 'resume' && canResume(state);
        results.push(await runStage(stage, preferResume));
      }

      const failed = results.filter(item => item.ok === false);
      if (failed.length) {
        setStatus(`已完成可完成板块；${failed.map(item => item.label).join('、')}保留断点待续查。`, 'warning');
      } else {
        setStatus('七业务处理完成，已保存最新快照。', 'success');
      }
      document.dispatchEvent(new CustomEvent('ce-qc-run-complete', { detail: { results } }));
      try { if (typeof global.refresh === 'function') await global.refresh(); } catch {}
      return { ok: failed.length === 0, results };
    } catch (error) {
      const text = isAuth(error)
        ? 'CE登录已失效，请重新登录后点击继续处理；已完成断点不会丢失。'
        : `处理连接异常：${String(error.message || error)}；已完成断点不会丢失。`;
      setStatus(text, 'danger');
      return { ok: false, error: error.message || String(error), results };
    } finally {
      setBusy(false);
    }
  }

  function install() {
    global.runUnified = () => execute('start');
    global.resumeUnified = () => execute('resume');
    global.__CE_QC_V67_RESILIENT_RUN_GUARD__ = { version: VERSION, run: execute };
    console.info('[CE-QC][V67_SEVEN_BUSINESS_RUNNER]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0), { once: true });
  else setTimeout(install, 0);
})(window);
