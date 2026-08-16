(function installResilientRunGuardV67(global) {
  if (global.__CE_QC_V67_RESILIENT_RUN_GUARD__) return;

  const VERSION = '2026-08-16-v148-direct-daily-runner-v1';
  let busy = false;

  function wait(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0)))); }
  function normalizeDate(value) {
    const text = String(value || '').trim().replace(/\//g, '-').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }
  function targetDate() {
    const importPage = location.pathname === '/import' || document.getElementById('importPage')?.classList?.contains('active');
    if (importPage) {
      const inputDate = normalizeDate(document.getElementById('reportDate')?.value);
      if (inputDate) return inputDate;
      try {
        const imported = normalizeDate(typeof unifiedImportState !== 'undefined' ? unifiedImportState?.reportDate : '');
        if (imported) return imported;
      } catch {}
    }
    const topDate = normalizeDate(document.getElementById('topRangeTo')?.value || document.getElementById('dashboardRangeTo')?.value);
    if (topDate) return topDate;
    try {
      return normalizeDate(
        (typeof unifiedImportState !== 'undefined' ? unifiedImportState?.reportDate : '')
        || (typeof appState !== 'undefined' ? appState?.reportDate : '')
        || (typeof shopeeState !== 'undefined' ? shopeeState?.reportDate : '')
      );
    } catch { return ''; }
  }

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
    const target = targetDate();
    setBusy(true, `正在启动 ${target || '当日'} 七业务处理…`);
    const results = [];
    try {
      // V148: do not pre-read three large dashboard/state endpoints before a daily run.
      // On a ~20GB SQLite database those aborted browser reads can keep executing on
      // the backend and compete with the real scan/track workload. Daily import is the
      // authority for what should run; each processing endpoint already knows how to
      // return RUN_ALREADY_COMPLETED / NO_DAILY_REPORT and how to resume checkpoints.
      const stages = [
        { key: 'CCSL', label: 'CCSL（CE/CEAF/TBKH/ALI1688）', start: '/api/run', resume: '/api/resume' },
        { key: 'SHOPEE', label: 'SHOPEE CN/VN', start: '/api/shopee/run/start', resume: '/api/shopee/run/resume' },
        { key: 'WHPP', label: 'WHPP本土', start: '/api/whpp/run/start', resume: '/api/whpp/run/resume' }
      ];

      for (const stage of stages) {
        setStatus(`${stage.label}正在进入当日日报处理…`);
        const result = await runStage(stage, mode === 'resume');
        results.push(result);
      }

      const failed = results.filter(item => item.ok === false);
      if (failed.length) {
        setStatus(`当日日报主流程已继续推进；${failed.map(item => item.label).join('、')}失败票已保留到独立重试中心。`, 'warning');
      } else {
        setStatus('七业务当日日报处理完成，已保存最新快照。', 'success');
      }
      document.dispatchEvent(new CustomEvent('ce-qc-run-complete', { detail: { results, reportDate: target } }));
      try { if (typeof global.refresh === 'function') await global.refresh(); } catch {}
      return { ok: failed.length === 0, results, reportDate: target };
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
    global.__CE_QC_V67_RESILIENT_RUN_GUARD__ = { version: VERSION, run: execute, targetDate };
    console.info('[CE-QC][V148_DIRECT_DAILY_RUNNER]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0), { once: true });
  else setTimeout(install, 0);
})(window);
