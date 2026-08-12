(function (global) {
  const VERSION = '2026-08-12-v47-seven-business-orchestrator-v3';
  let orchestrating = false;

  async function readJson(response) {
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || data.message || `HTTP ${response.status}`);
      error.code = data.code || `HTTP_${response.status}`;
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function post(url) {
    return readJson(await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }));
  }

  function isAlreadyDone(error) {
    return ['RUN_ALREADY_COMPLETED','WHPP_RUN_ALREADY_ACTIVE'].includes(String(error?.code || ''))
      || /已完成|already completed/i.test(String(error?.message || ''));
  }

  function isNoReport(error) {
    return ['WHPP_REPORT_MISSING','REPORT_MISSING','NO_DAILY_REPORT'].includes(String(error?.code || ''))
      || /未导入.*日报|没有.*日报/i.test(String(error?.message || ''));
  }

  function isAuth(error) {
    return ['AUTH_REQUIRED','401','403'].includes(String(error?.code || '').toUpperCase())
      || [401,403].includes(Number(error?.status || error?.payload?.status || 0))
      || /未授权|unauthorized|登录.*失效|token.*(?:过期|expired|invalid)/i.test(String(error?.message || ''));
  }

  function isTransient(error) {
    const status = Number(error?.status || 0);
    const message = String(error?.message || '');
    return [408,425,429,500,502,503,504].includes(status)
      || /timeout|timed out|socket hang up|ECONNRESET|connection reset|network|连接.*中断/i.test(message);
  }

  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function runBusiness({ label, start, resume }) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const url = attempt === 0 ? start : resume;
      try {
        await post(url);
        return { label, ok: true, attempt: attempt + 1 };
      } catch (error) {
        if (isAlreadyDone(error)) return { label, ok: true, skipped: true, reason: error.code || 'completed' };
        if (isNoReport(error)) return { label, ok: true, skipped: true, reason: 'no-report' };
        if (isAuth(error)) throw error;
        lastError = error;
        if (!isTransient(error) || attempt >= 2) break;
        await wait(700 * (attempt + 1));
      }
    }
    return { label, ok: false, error: lastError?.message || String(lastError || 'unknown') };
  }

  function statusNode() { return document.getElementById('ccslRunStatus'); }
  function runButton() { return document.querySelector('[data-testid="global-auto-process"]'); }
  function setStatus(text, level = 'warning') {
    const node = statusNode();
    if (node) node.innerHTML = `<span class="status-pill ${level}">${text}</span>`;
  }

  async function finishWhppOnly() {
    return runBusiness({ label: 'WHPP本土', start: '/api/whpp/run/start', resume: '/api/whpp/run/resume' });
  }

  function install() {
    const original = global.runUnified;
    if (typeof original !== 'function' || original.__whppV47Wrapped) return;

    const wrapped = async function () {
      if (orchestrating) return;
      orchestrating = true;
      const button = runButton();
      if (button) { button.disabled = true; button.textContent = '七业务处理中…'; }
      const results = [];
      let originalError = null;

      try {
        try {
          // Keep the mature CCSL + SHOPEE workflow as the primary path.
          await original.apply(this, arguments);
          results.push({ label: 'CCSL / SHOPEE', ok: true });
        } catch (error) {
          originalError = error;
          if (isAuth(error)) throw error;

          // If the legacy two-business orchestrator stopped at one CE network
          // failure, recover both independently instead of blocking the rest of
          // the daily report. Completed work is checkpointed and resume is safe.
          setStatus('CCSL / SHOPEE出现接口波动，系统正在自动续跑，不需要人工重新开始…');
          results.push(await runBusiness({ label: 'CCSL', start: '/api/run', resume: '/api/resume' }));
          results.push(await runBusiness({ label: 'SHOPEE', start: '/api/shopee/run/start', resume: '/api/shopee/run/resume' }));
        }

        setStatus('正在处理WHPP本土扫描、轨迹、退回与订单取消…');
        results.push(await finishWhppOnly());

        if (typeof global.refresh === 'function') {
          try { await global.refresh(); } catch (error) { console.warn('[CE-QC][V47][REFRESH]', error); }
        }

        const failed = results.filter(item => item && item.ok === false);
        if (failed.length) {
          setStatus(`七业务已完成可完成部分；${failed.map(item => `${item.label}待续查`).join('、')}。系统已保存断点。`, 'warning');
        } else {
          setStatus('七业务处理完成，所有板块已保存最新状态。', 'success');
        }

        if (location.pathname === '/whpp' && typeof global.navigateWhppPage === 'function') {
          try { await global.navigateWhppPage(); } catch {}
        }
        return { ok: failed.length === 0, results, recoveredFrom: originalError?.message || '' };
      } catch (error) {
        console.error('[CE-QC][SEVEN_BUSINESS_ORCHESTRATOR]', error);
        setStatus(isAuth(error) ? 'CE登录已失效，请重新登录后点击继续处理。断点已保存。' : `处理失败：${String(error.message || error)}`, 'danger');
        return { ok: false, error: error.message || String(error), results };
      } finally {
        orchestrating = false;
        if (button) { button.disabled = false; button.textContent = '开始全自动'; }
      }
    };
    wrapped.__whppV47Wrapped = true;
    global.runUnified = wrapped;

    const originalResume = global.resumeUnified;
    if (typeof originalResume === 'function' && !originalResume.__whppV47Wrapped) {
      const resumeWrapped = async function () {
        if (orchestrating) return;
        orchestrating = true;
        const button = runButton();
        if (button) button.disabled = true;
        try {
          const results = [];
          results.push(await runBusiness({ label: 'CCSL', start: '/api/resume', resume: '/api/resume' }));
          results.push(await runBusiness({ label: 'SHOPEE', start: '/api/shopee/run/resume', resume: '/api/shopee/run/resume' }));
          results.push(await runBusiness({ label: 'WHPP本土', start: '/api/whpp/run/resume', resume: '/api/whpp/run/resume' }));
          if (typeof global.refresh === 'function') { try { await global.refresh(); } catch {} }
          const failed = results.filter(item => item.ok === false);
          setStatus(failed.length ? `${failed.map(item => item.label).join('、')}仍有待续查，其他板块已保存。` : '七业务续跑完成。', failed.length ? 'warning' : 'success');
          return { ok: failed.length === 0, results };
        } finally {
          orchestrating = false;
          if (button) button.disabled = false;
        }
      };
      resumeWrapped.__whppV47Wrapped = true;
      global.resumeUnified = resumeWrapped;
    }

    console.info('[CE-QC][SEVEN_BUSINESS_ORCHESTRATOR]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);
