(function installV194ExportTokenUi(global) {
  if (global.__CE_QC_V194_EXPORT_TOKEN_UI__) return;
  global.__CE_QC_V194_EXPORT_TOKEN_UI__ = true;

  const VERSION = '2026-08-18-v194-export-token-ui-v1';
  const SIDECAR_VERSION = '2026-08-18-v194-token-status-sidecar-v1';
  const ACTIVE_JOB_KEY = 'ce_qc_active_export_job_v194';
  const LEGACY_KEYS = ['ce_qc_active_export_job_v180','ce_qc_active_export_job_v186','ce_qc_active_export_job_v187','ce_qc_active_export_job_v191','ce_qc_active_export_job_v192','ce_qc_active_export_job_v193'];
  const previousExport = typeof global.exportPeriodReport === 'function' ? global.exportPeriodReport.bind(global) : null;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let pollEpoch = 0;

  function clearLegacy() {
    try { for (const key of LEGACY_KEYS) localStorage.removeItem(key); } catch {}
  }
  function sidecarBase() {
    if (location.protocol !== 'http:') return '';
    return `http://${location.hostname}:5178`;
  }
  function credentialsFor(url) {
    try { return new URL(url, location.href).origin === location.origin ? 'same-origin' : 'include'; }
    catch { return 'include'; }
  }
  async function json(url, init = {}, timeoutMs = 8000, label = '接口') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await global.fetch(url, { cache:'no-store', credentials:credentialsFor(url), signal:controller.signal, ...init });
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch {}
      if (!response.ok || payload?.ok === false) {
        const error = new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
        error.status = response.status;
        error.code = payload?.code || `HTTP_${response.status}`;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(`${label}${Math.round(timeoutMs/1000)}秒内未响应`);
        timeoutError.code = 'V194_TIMEOUT';
        throw timeoutError;
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
  function inputs() {
    const periodType = document.querySelector('.period-tab.active')?.dataset?.period || 'daily';
    return {
      periodType,
      date: document.getElementById('periodExportDate')?.value || '',
      fromDate: document.getElementById('periodExportFrom')?.value || '',
      toDate: document.getElementById('periodExportTo')?.value || '',
      businessType: String(document.getElementById('periodExportBusiness')?.value || 'ALL').toUpperCase()
    };
  }
  function valid(payload, progress) {
    if (payload.periodType === 'custom') {
      if (!payload.fromDate || !payload.toDate) { progress.textContent = '请选择开始日期和结束日期'; return false; }
      if (payload.fromDate > payload.toDate) { progress.textContent = '开始日期不能晚于结束日期'; return false; }
    } else if (!payload.date) { progress.textContent = '请选择基准日期'; return false; }
    return true;
  }
  function escapeHtml(value='') { return String(value).replace(/[&<>]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch])); }
  function escapeAttr(value='') { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function renderFiles(target, files=[]) {
    target.innerHTML = files.map(file => `<a class="export-file-item" href="${escapeAttr(file.url || '')}"><span>${escapeHtml(file.name || '')}</span><b>下载完整表</b></a>`).join('');
  }
  function save(jobId, payload, pollUrl) {
    try { localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId, payload, pollUrl, version:VERSION, savedAt:new Date().toISOString() })); } catch {}
  }
  function load() {
    try {
      const value = JSON.parse(localStorage.getItem(ACTIVE_JOB_KEY) || 'null');
      return value?.jobId && value.version === VERSION ? value : null;
    } catch { return null; }
  }
  function clear(jobId='') {
    try {
      const current = load();
      if (!jobId || !current || current.jobId === jobId) localStorage.removeItem(ACTIVE_JOB_KEY);
    } catch {}
  }
  function ownDom() {
    let progress = document.getElementById('exportProgressV194') || document.getElementById('exportProgressV193') || document.getElementById('exportProgressV192') || document.getElementById('exportProgressV191') || document.getElementById('exportProgressV187');
    const legacyProgress = document.getElementById('exportProgress');
    if (!progress && legacyProgress) {
      progress = document.createElement('div');
      progress.className = legacyProgress.className || 'operation-status';
      legacyProgress.insertAdjacentElement('afterend', progress);
    }
    if (progress) { progress.id = 'exportProgressV194'; progress.dataset.ceQcExportOwner = 'v194'; }

    let files = document.getElementById('exportGeneratedFilesV194') || document.getElementById('exportGeneratedFilesV193') || document.getElementById('exportGeneratedFilesV192') || document.getElementById('exportGeneratedFilesV191') || document.getElementById('exportGeneratedFilesV187');
    const legacyFiles = document.getElementById('exportGeneratedFiles');
    if (!files && legacyFiles) {
      files = document.createElement('div');
      files.className = legacyFiles.className || 'export-file-list';
      legacyFiles.insertAdjacentElement('afterend', files);
    }
    if (files) { files.id = 'exportGeneratedFilesV194'; files.dataset.ceQcExportOwner = 'v194'; }

    let button = document.querySelector('[data-testid="export-all-reports"]');
    if (button && button.dataset.ceQcExportOwner !== 'v194') {
      const clone = button.cloneNode(true);
      clone.removeAttribute('onclick');
      clone.dataset.ceQcExportOwner = 'v194';
      button.replaceWith(clone);
      clone.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        void exportV194();
      }, true);
      button = clone;
    }
    document.documentElement.dataset.ceQcExportUiOwner = 'v194';
    return { progress, files, button };
  }
  async function poll(jobId, pollUrl, progress, files) {
    const epoch = ++pollEpoch;
    let errors = 0;
    while (epoch === pollEpoch) {
      try {
        const job = await json(pollUrl, {}, 6000, 'V194状态接口');
        errors = 0;
        const status = String(job.status || '').toUpperCase();
        const pct = Math.max(0, Math.min(100, Number(job.progress || 0)));
        progress.textContent = `[V194独立导出] Job ${jobId} · ${job.message || '后台生成中'} · ${pct}%${job.currentBusiness ? ` · ${job.currentBusiness}` : ''}`;
        if (status === 'COMPLETED') {
          const ready = Array.isArray(job.files) ? job.files.filter(item => item?.url && item?.name) : [];
          if (!ready.length) throw new Error('后台已完成，但没有返回下载文件');
          renderFiles(files, ready);
          clear(jobId);
          progress.textContent = `[V194独立导出] Job ${jobId} · 生成完成，可直接下载完整Excel`;
          return;
        }
        if (status === 'FAILED' || status === 'CANCELLED') {
          clear(jobId);
          const error = new Error(job.message || job.error || '后台导出失败');
          error.code = job.errorCode || status;
          throw error;
        }
      } catch (error) {
        if ([401,403,404].includes(Number(error.status || 0)) || ['FAILED','CANCELLED'].includes(String(error.code || '').toUpperCase())) throw error;
        errors += 1;
        progress.textContent = `[V194独立导出] Job ${jobId} · 状态通道重连第 ${errors} 次；本通道不访问SQLite鉴权表，后台任务继续保留…`;
      }
      await sleep(errors ? Math.min(8000, 1500 + errors * 700) : 1800);
    }
  }
  async function exportV194() {
    const { progress, files, button } = ownDom();
    if (!progress || !files) return;
    const payload = inputs();
    if (!valid(payload, progress)) return;
    if (payload.businessType === 'ALL') {
      if (previousExport) return previousExport();
      progress.textContent = '7业务导出控制器不可用';
      return;
    }
    pollEpoch += 1;
    files.innerHTML = '';
    const oldText = button?.textContent || '一键导出全部报表';
    if (button) { button.disabled = true; button.textContent = '后台生成中…'; }
    try {
      const base = sidecarBase();
      if (!base) throw new Error('V194独立导出当前仅支持本机/LAN HTTP访问');
      progress.textContent = `[V194独立导出] 正在检查5178独立服务；状态轮询将完全绕开主SQLite鉴权…`;
      const ping = await json(`${base}/api/v194/export-ping`, {}, 3500, 'V194独立服务');
      if (String(ping.version || '') !== SIDECAR_VERSION) throw new Error(`V194独立服务版本不一致：${ping.version || '未知'}`);
      const start = await json(`${base}/api/v194/export-period/prepare`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
      }, 10000, 'V194导出创建接口');
      const jobId = String(start.jobId || '').trim();
      if (!jobId) throw new Error('独立导出服务没有返回Job编号');
      let pollUrl = String(start.pollUrl || '').trim();
      if (pollUrl.startsWith('/')) pollUrl = `${base}${pollUrl}`;
      if (!pollUrl) throw new Error('独立导出服务没有返回令牌状态地址');
      save(jobId, payload, pollUrl);
      progress.textContent = `[V194独立导出] Job ${jobId} · 已创建；状态查询采用随机Job令牌，不再查询SQLite用户表 · 0%`;
      await poll(jobId, pollUrl, progress, files);
    } catch (error) {
      progress.textContent = `[V194独立导出] 导出失败：${error.message || error}`;
    } finally {
      if (button) { button.disabled = false; button.textContent = oldText; }
    }
  }
  async function resume() {
    const active = load();
    if (!active) return;
    const { progress, files } = ownDom();
    if (!progress || !files) return;
    try {
      progress.textContent = `[V194独立导出] 正在恢复Job ${active.jobId} 的令牌状态通道…`;
      await poll(active.jobId, active.pollUrl, progress, files);
    } catch (error) {
      if ([403,404].includes(Number(error.status || 0))) clear(active.jobId);
      progress.textContent = `[V194独立导出] 恢复任务失败：${error.message || error}`;
    }
  }

  clearLegacy();
  ownDom();
  global.exportPeriodReport = exportV194;
  global.exportPeriodReportV194 = exportV194;
  global.resumeActiveExportJob = resume;
  document.addEventListener('click', event => {
    if (event.target?.closest?.('[data-page="reports"],.side-link')) setTimeout(ownDom, 0);
  }, true);
  setTimeout(() => { ownDom(); void resume(); }, 120);
  console.info('[CE-QC][V194_EXPORT_TOKEN_UI]', VERSION);
})(window);
