(function installV93ShopeeResumeUi(global) {
  if (global.__CE_QC_V93_SHOPEE_RESUME_UI__) return;
  const VERSION = '2026-08-13-v93-shopee-resume-ui-v2';
  let autoResumeStarted = false;

  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function install() {
    const original = global.runStatusMarkup;
    if (typeof original !== 'function') {
      setTimeout(install, 50);
      return;
    }
    if (original.__v93Wrapped) return;

    const wrapped = function v93RunStatusMarkup(state) {
      const html = original(state);
      if (String(state?.businessType || '').toUpperCase() !== 'SHOPEE') return html;
      const processing = state?.processing || {};
      if (/扫描/.test(String(processing.phase || ''))) return html;
      const batchIndex = Number(processing.batchIndex || 0);
      const totalBatches = Number(processing.totalBatches || 0);
      const eventRows = Number(state?.trackEvents || 0);
      const totalBills = Number(state?.total || 0);
      const status = batchIndex && totalBatches ? `当前批次 ${batchIndex}/${totalBatches}` : '轨迹批次准备中';
      const detail = `${status} · 已保存轨迹事件 ${eventRows.toLocaleString('zh-CN')} 条 · 日报运单 ${totalBills.toLocaleString('zh-CN')}票`;
      return String(html || '').replace(/<p>轨迹进度：[\s\S]*?<\/p>/, `<p>轨迹处理：${detail}</p>`);
    };
    wrapped.__v93Wrapped = true;
    global.runStatusMarkup = wrapped;
    global.__CE_QC_V93_SHOPEE_RESUME_UI__ = { version: VERSION, autoResumeShopee };
    console.info('[CE-QC][V93_SHOPEE_RESUME_UI]', VERSION);
    setTimeout(autoResumeShopee, 1200);
  }

  async function readJson(response) {
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || payload.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload.code || `HTTP_${response.status}`;
      throw error;
    }
    return payload;
  }

  function shouldAutoResume(state = {}) {
    const path = String(location.pathname || '').toLowerCase();
    if (!['/shopeecn','/shopeevn'].includes(path)) return false;
    if (!state.reportDate || state.dailyReportReady === false || state.snapshotId) return false;
    const status = String(state.runStatus || state.currentRun?.status || '').toLowerCase();
    const hasError = Boolean(String(state.processing?.error || '').trim());
    return ['failed','paused','running'].includes(status) || hasError;
  }

  function setResumeStatus(text, level = 'warning') {
    const node = document.getElementById('shopeeRunStatus');
    if (!node) return;
    const safe = String(text || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    node.insertAdjacentHTML('afterbegin', `<p><span class="status-pill ${level}">${safe}</span></p>`);
  }

  async function autoResumeShopee() {
    if (autoResumeStarted) return;
    autoResumeStarted = true;
    try {
      const statePayload = await fetch('/api/shopee/state?compact=1', { cache:'no-store', credentials:'same-origin' }).then(readJson);
      const state = statePayload?.state || statePayload || {};
      if (!shouldAutoResume(state)) return;
      const key = `ce_qc_v93_auto_resume_${state.reportDate}`;
      if (sessionStorage.getItem(key) === 'done') return;
      sessionStorage.setItem(key, 'running');
      setResumeStatus('检测到上次SHOPEE处理被中断，系统正在从已保存断点自动继续。');

      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const result = await fetch('/api/shopee/run/resume', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:'{}',
            credentials:'same-origin',
            cache:'no-store'
          }).then(readJson);
          sessionStorage.setItem(key, 'done');
          setResumeStatus(result?.alreadyRunning ? 'SHOPEE后台任务已在运行，页面已重新接管进度。' : 'SHOPEE断点续跑已完成。', 'success');
          try { if (typeof global.refresh === 'function') await global.refresh(); } catch {}
          return;
        } catch (error) {
          lastError = error;
          const transient = [408,425,429,500,502,503,504].includes(Number(error?.status || 0))
            || /连接|network|socket|timeout|TLS|temporar/i.test(String(error?.message || ''));
          if (!transient || attempt === 3) throw error;
          setResumeStatus(`SHOPEE续跑连接波动，系统自动重试 ${attempt}/3。`);
          await wait(1200 * attempt);
        }
      }
      throw lastError || new Error('SHOPEE自动续跑失败');
    } catch (error) {
      sessionStorage.removeItem(`ce_qc_v93_auto_resume_${new Date().toISOString().slice(0,10)}`);
      console.warn('[CE-QC][V93_AUTO_RESUME]', error);
      const auth = [401,403].includes(Number(error?.status || 0)) || /登录|未授权|unauthorized|AUTH_REQUIRED/i.test(String(error?.message || ''));
      setResumeStatus(auth ? 'CE登录已失效，请重新登录后系统可继续已保存断点。' : `SHOPEE自动续跑未完成：${error?.message || error}`, 'danger');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0), { once: true });
  else setTimeout(install, 0);
})(window);
