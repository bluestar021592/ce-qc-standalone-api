(function installV194ExportTokenUi(global) {
  const REVISION = '2026-08-21-qc11-all-single-ipc-status-ui-v1';
  if (global.__CE_QC_V194_EXPORT_TOKEN_UI_REVISION__ === REVISION) return;
  global.__CE_QC_V194_EXPORT_TOKEN_UI__ = true;

  const VERSION = '2026-08-18-v194-export-token-ui-v1';
  const SIDECAR_VERSION = '2026-08-18-v194-token-status-sidecar-v1';
  const SIDECAR_REVISION = '2026-08-18-v195-ipc-memory-status-v1';
  const ACTIVE_JOB_KEY = 'ce_qc_active_export_job_v194';
  const LEGACY_KEYS = ['ce_qc_active_export_job_v180','ce_qc_active_export_job_v186','ce_qc_active_export_job_v187','ce_qc_active_export_job_v191','ce_qc_active_export_job_v192','ce_qc_active_export_job_v193'];
  const LEGACY_LABEL = '[V194独立导出]';
  const LABEL = '[QC11独立导出]';
  const previousExport = typeof global.exportPeriodReport === 'function' ? global.exportPeriodReport.bind(global) : null;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let pollEpoch = 0;

  function clearLegacy() { try { for (const key of LEGACY_KEYS) localStorage.removeItem(key); } catch {} }
  function sidecarBase() {
    if (location.protocol !== 'http:') return '';
    return `http://${location.hostname}:5178`;
  }
  function xhrJson(url, { method='GET', body=null, timeoutMs=8000, label='接口' } = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.withCredentials = true;
      xhr.timeout = timeoutMs;
      xhr.setRequestHeader('Accept', 'application/json');
      if (body !== null) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = () => {
        let payload = {};
        try { payload = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch {}
        if (xhr.status < 200 || xhr.status >= 300 || payload?.ok === false) {
          const error = new Error(payload?.error || payload?.message || `HTTP ${xhr.status}`);
          error.status = xhr.status;
          error.code = payload?.code || `HTTP_${xhr.status}`;
          error.transport = 'XHR';
          reject(error);
          return;
        }
        resolve(payload);
      };
      xhr.onerror = () => {
        const error = new Error(`${label}网络连接失败`);
        error.code = 'V195_NETWORK';
        error.transport = 'XHR';
        reject(error);
      };
      xhr.ontimeout = () => {
        const error = new Error(`${label}${Math.round(timeoutMs/1000)}秒内未响应`);
        error.code = 'V194_TIMEOUT';
        error.transport = 'XHR';
        reject(error);
      };
      xhr.onabort = () => {
        const error = new Error(`${label}请求被中止`);
        error.code = 'V195_ABORTED';
        error.transport = 'XHR';
        reject(error);
      };
      try { xhr.send(body === null ? null : JSON.stringify(body)); }
      catch (error) { reject(error); }
    });
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
    try { localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId, payload, pollUrl, version:VERSION, revision:REVISION, savedAt:new Date().toISOString() })); } catch {}
  }
  function load() {
    try {
      const value = JSON.parse(localStorage.getItem(ACTIVE_JOB_KEY) || 'null');
      return value?.jobId && value.version === VERSION && value.revision === REVISION ? value : null;
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
    if (progress) { progress.id = 'exportProgressV194'; progress.dataset.ceQcExportOwner = 'qc11'; }

    let files = document.getElementById('exportGeneratedFilesV194') || document.getElementById('exportGeneratedFilesV193') || document.getElementById('exportGeneratedFilesV192') || document.getElementById('exportGeneratedFilesV191') || document.getElementById('exportGeneratedFilesV187');
    const legacyFiles = document.getElementById('exportGeneratedFiles');
    if (!files && legacyFiles) {
      files = document.createElement('div');
      files.className = legacyFiles.className || 'export-file-list';
      legacyFiles.insertAdjacentElement('afterend', files);
    }
    if (files) { files.id = 'exportGeneratedFilesV194'; files.dataset.ceQcExportOwner = 'qc11'; }

    let button = document.querySelector('[data-testid="export-all-reports"]');
    if (button && button.dataset.ceQcExportOwner !== 'qc11') {
      const clone = button.cloneNode(true);
      clone.removeAttribute('onclick');
      clone.dataset.ceQcExportOwner = 'qc11';
      button.replaceWith(clone);
      clone.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        void exportV194();
      }, true);
      button = clone;
    }
    document.documentElement.dataset.ceQcExportUiOwner = 'qc11';
    return { progress, files, button };
  }
  function shortError(error) {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || error || '未知错误').trim();
    return `${code ? `${code}: ` : ''}${message}`.slice(0, 220);
  }
  async function poll(jobId, pollUrl, progress, files) {
    const epoch = ++pollEpoch;
    let errors = 0;
    while (epoch === pollEpoch) {
      try {
        const job = await xhrJson(pollUrl, { timeoutMs:6000, label:'QC11状态接口' });
        errors = 0;
        const status = String(job.status || '').toUpperCase();
        const pct = Math.max(0, Math.min(100, Number(job.progress || 0)));
        const transport = job.statusTransport === 'IPC_MEMORY_V195' ? ' · 5178 IPC内存状态' : '';
        progress.textContent = `${LABEL} Job ${jobId} · ${job.message || '后台生成中'} · ${pct}%${job.currentBusiness ? ` · ${job.currentBusiness}` : ''}${transport}`;
        if (status === 'COMPLETED') {
          const ready = Array.isArray(job.files) ? job.files.filter(item => item?.url && item?.name) : [];
          if (!ready.length) throw new Error('后台已完成，但没有返回下载文件');
          renderFiles(files, ready);
          clear(jobId);
          progress.textContent = `${LABEL} Job ${jobId} · 生成完成，可直接下载完整Excel`;
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
        progress.textContent = `${LABEL} Job ${jobId} · 状态重连第 ${errors} 次 · ${shortError(error)} · 5178继续保留后台任务`;
      }
      await sleep(errors ? Math.min(6500, 1200 + errors * 650) : 1600);
    }
  }
  async function exportV194() {
    const { progress, files, button } = ownDom();
    if (!progress || !files) return;
    const payload = inputs();
    if (!valid(payload, progress)) return;
    pollEpoch += 1;
    files.innerHTML = '';
    const oldText = button?.textContent || '一键导出全部报表';
    if (button) { button.disabled = true; button.textContent = '后台生成中…'; }
    try {
      const base = sidecarBase();
      if (!base) {
        if (previousExport) return await previousExport();
        throw new Error('公网HTTPS环境未找到兼容导出控制器');
      }
      progress.textContent = `${LABEL} 正在连接5178独立导出服务；${payload.businessType === 'ALL' ? '7业务' : payload.businessType}创建与状态查询均不占用5177看板进程…`;
      const ping = await xhrJson(`${base}/api/v194/export-ping`, { timeoutMs:3500, label:'QC11独立导出服务' });
      if (String(ping.version || '') !== SIDECAR_VERSION) throw new Error(`独立导出服务基础版本不一致：${ping.version || '未知'}`);
      if (String(ping.revision || '') !== SIDECAR_REVISION) throw new Error(`独立导出服务修订未生效：${ping.revision || '未知'}`);
      if (payload.businessType === 'ALL' && Array.isArray(ping.capabilities) && !ping.capabilities.includes('ALL')) throw new Error('当前5178服务尚未启用7业务独立导出');
      const start = await xhrJson(`${base}/api/v194/export-period/prepare`, {
        method:'POST', body:payload, timeoutMs:10000, label:'QC11导出创建接口'
      });
      const jobId = String(start.jobId || '').trim();
      if (!jobId) throw new Error('独立导出服务没有返回Job编号');
      let pollUrl = String(start.pollUrl || '').trim();
      if (pollUrl.startsWith('/')) pollUrl = `${base}${pollUrl}`;
      if (!pollUrl) throw new Error('独立导出服务没有返回token状态地址');
      save(jobId, payload, pollUrl);
      progress.textContent = `${LABEL} Job ${jobId} · 已创建；Worker进度经IPC写入5178内存 · 0%`;
      await poll(jobId, pollUrl, progress, files);
    } catch (error) {
      progress.textContent = `${LABEL} 导出失败：${shortError(error)}`;
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
      progress.textContent = `${LABEL} 正在恢复Job ${active.jobId} 的5178 IPC内存状态通道…`;
      await poll(active.jobId, active.pollUrl, progress, files);
    } catch (error) {
      if ([403,404].includes(Number(error.status || 0))) clear(active.jobId);
      progress.textContent = `${LABEL} 恢复任务失败：${shortError(error)}`;
    }
  }

  clearLegacy();
  ownDom();
  global.exportPeriodReport = exportV194;
  global.exportPeriodReportV194 = exportV194;
  global.resumeActiveExportJob = resume;
  global.__CE_QC_V194_EXPORT_TOKEN_UI_REVISION__ = REVISION;
  document.addEventListener('click', event => {
    if (event.target?.closest?.('[data-page="reports"],.side-link')) setTimeout(ownDom, 0);
  }, true);
  setTimeout(() => { ownDom(); void resume(); }, 120);
  console.info('[CE-QC][QC11_EXPORT_TOKEN_UI]', VERSION, REVISION, LEGACY_LABEL);
})(window);
