(function installAsyncExportUiV191(global) {
  if (global.__CE_QC_V191_ASYNC_EXPORT_UI_INSTALLED__) return;
  global.__CE_QC_V191_ASYNC_EXPORT_UI_INSTALLED__ = true;

  const VERSION = '2026-08-18-v191-export-ui-hard-direct-v1';
  const ACTIVE_JOB_KEY = 'ce_qc_active_export_job_v191';
  const LEGACY_JOB_KEYS = ['ce_qc_active_export_job_v180','ce_qc_active_export_job_v186','ce_qc_active_export_job_v187'];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let pollingJobId = '';
  let pollEpoch = 0;

  function clearLegacyJobs() {
    try { for (const key of LEGACY_JOB_KEYS) localStorage.removeItem(key); } catch {}
  }
  function cancelCurrentPoll() {
    pollEpoch += 1;
    pollingJobId = '';
  }
  function retirePreviousController() {
    try {
      const previous = global.__CE_QC_V84_ASYNC_EXPORT_UI__;
      if (previous && previous.version !== VERSION && typeof previous.cancelCurrentPoll === 'function') previous.cancelCurrentPoll();
    } catch {}
  }

  function ensureBusinessOptions() {
    const select = document.getElementById('periodExportBusiness');
    if (!select) return;
    const wanted = [
      ['ALL', '管理汇总 + 7业务（每业务1个完整Excel）'],
      ['CE', '仅CE完整表'],
      ['CEAF', '仅CEAF空运完整表'],
      ['TBKH', '仅TBKH完整表'],
      ['ALI1688', '仅ALI1688完整表'],
      ['SHOPEECN', '仅SHOPEE CN完整表'],
      ['SHOPEEVN', '仅SHOPEE VN完整表'],
      ['WHPP', '仅WHPP本土完整表']
    ];
    const current = select.value || 'ALL';
    select.innerHTML = wanted.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    select.value = wanted.some(([value]) => value === current) ? current : 'ALL';
  }

  function claimExclusiveDom() {
    ensureBusinessOptions();
    const legacyProgress = document.getElementById('exportProgress');
    let progress = document.getElementById('exportProgressV187') || document.getElementById('exportProgressV191');
    if (legacyProgress) {
      legacyProgress.hidden = true;
      legacyProgress.setAttribute('aria-hidden', 'true');
      legacyProgress.dataset.ceQcRetiredExportUi = '1';
      if (!progress) {
        progress = document.createElement('div');
        progress.id = 'exportProgressV191';
        progress.className = legacyProgress.className || 'operation-status';
        progress.dataset.ceQcExportOwner = 'v191';
        legacyProgress.insertAdjacentElement('afterend', progress);
      } else {
        progress.id = 'exportProgressV191';
        progress.dataset.ceQcExportOwner = 'v191';
      }
    }

    const legacyFiles = document.getElementById('exportGeneratedFiles');
    let files = document.getElementById('exportGeneratedFilesV187') || document.getElementById('exportGeneratedFilesV191');
    if (legacyFiles) {
      legacyFiles.hidden = true;
      legacyFiles.setAttribute('aria-hidden', 'true');
      legacyFiles.dataset.ceQcRetiredExportUi = '1';
      if (!files) {
        files = document.createElement('div');
        files.id = 'exportGeneratedFilesV191';
        files.className = legacyFiles.className || 'export-file-list';
        files.dataset.testid = 'export-generated-files-v191';
        files.dataset.ceQcExportOwner = 'v191';
        legacyFiles.insertAdjacentElement('afterend', files);
      } else {
        files.id = 'exportGeneratedFilesV191';
        files.dataset.testid = 'export-generated-files-v191';
        files.dataset.ceQcExportOwner = 'v191';
      }
    }

    let button = document.querySelector('[data-testid="export-all-reports"]');
    if (button && button.dataset.ceQcExportOwner !== 'v191') {
      const clone = button.cloneNode(true);
      clone.removeAttribute('onclick');
      clone.dataset.ceQcExportOwner = 'v191';
      button.replaceWith(clone);
      clone.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        void exportPeriodReportV191();
      }, true);
      button = clone;
    }
    document.documentElement.dataset.ceQcExportUiOwner = 'v191';
    return { progress, files, button };
  }

  function saveActiveJob(jobId, payload = {}, pollUrl = '') {
    try { localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId, payload, pollUrl, savedAt: new Date().toISOString(), version: VERSION })); } catch {}
  }
  function loadActiveJob() {
    try {
      const value = JSON.parse(localStorage.getItem(ACTIVE_JOB_KEY) || 'null');
      if (!value?.jobId) return null;
      if (String(value.version || '') !== VERSION) { localStorage.removeItem(ACTIVE_JOB_KEY); return null; }
      return value;
    } catch { return null; }
  }
  function clearActiveJob(jobId = '') {
    try {
      const current = loadActiveJob();
      if (!jobId || !current || current.jobId === jobId) localStorage.removeItem(ACTIVE_JOB_KEY);
    } catch {}
  }

  async function json(url, init = {}, timeoutMs = 15000, timeoutLabel = '接口') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
      const response = await global.fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal, ...init });
      const raw = await response.text();
      let payload = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch {}
      if (!response.ok || payload?.ok === false) {
        const error = new Error(payload?.error || payload?.message || (raw && !/^\s*</.test(raw) ? raw.slice(0, 240) : `HTTP ${response.status}`));
        error.status = response.status;
        error.code = payload?.code || `HTTP_${response.status}`;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(`${timeoutLabel}${Math.round(timeoutMs / 1000)}秒内未响应`);
        timeoutError.code = 'POLL_TIMEOUT';
        throw timeoutError;
      }
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function exportInputs() {
    ensureBusinessOptions();
    const activePeriod = document.querySelector('.period-tab.active')?.dataset?.period || 'daily';
    return {
      periodType: String(activePeriod || 'daily'),
      date: document.getElementById('periodExportDate')?.value || '',
      fromDate: document.getElementById('periodExportFrom')?.value || '',
      toDate: document.getElementById('periodExportTo')?.value || '',
      businessType: document.getElementById('periodExportBusiness')?.value || 'ALL'
    };
  }
  function validate(payload, progress) {
    if (payload.periodType === 'custom') {
      if (!payload.fromDate || !payload.toDate) { progress.textContent = '请选择开始日期和结束日期'; return false; }
      if (payload.fromDate > payload.toDate) { progress.textContent = '开始日期不能晚于结束日期'; return false; }
    } else if (!payload.date) { progress.textContent = '请选择基准日期'; return false; }
    return true;
  }

  function escapeHtml(value = '') { return String(value).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])); }
  function escapeAttr(value = '') { return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
  function fileLabel(file = {}) {
    const name = String(file.name || '');
    if (/\.zip$/i.test(name)) return '下载全部完整报表';
    if (/管理汇总/.test(name)) return '管理汇总完整表';
    return '下载完整表';
  }
  function renderFiles(target, files = []) {
    target.innerHTML = files.map(file => `<a class="export-file-item" href="${escapeAttr(file.url || '')}"><span>${escapeHtml(file.name || '')}</span><b>${fileLabel(file)}</b></a>`).join('');
  }
  function setProgressText(target, text) { if (target && target.textContent !== text) target.textContent = text; }
  function pollDelay(unchangedCycles, networkErrors = 0) {
    if (document.visibilityState === 'hidden') return 7000;
    if (networkErrors > 0) return Math.min(12000, 4500 + Math.min(networkErrors, 10) * 650);
    if (unchangedCycles >= 5) return 5000;
    if (unchangedCycles >= 2) return 3500;
    return 2500;
  }

  async function waitForJob(jobId, progress, files, suppliedPollUrl = '') {
    if (!jobId) throw new Error('后台没有返回导出任务编号');
    const myEpoch = ++pollEpoch;
    pollingJobId = jobId;
    const pollUrl = suppliedPollUrl || `/api/v190/export-job/${encodeURIComponent(jobId)}`;
    let networkErrors = 0;
    let lastSignature = '';
    let unchangedCycles = 0;
    let lastGoodAt = Date.now();
    try {
      while (myEpoch === pollEpoch) {
        try {
          const job = await json(pollUrl, {}, 15000, '导出状态接口');
          if (myEpoch !== pollEpoch) return { cancelled: true };
          networkErrors = 0;
          lastGoodAt = Date.now();
          const status = String(job.status || '').toUpperCase();
          const pct = Math.max(0, Math.min(100, Number(job.progress || 0)));
          const part = job.currentBusiness ? ` · ${job.currentBusiness}` : '';
          const mode = job.workerMode === 'SINGLE_BUSINESS_DIRECT' ? ' · 独立单进程' : '';
          const worker = job.workerVersion ? ` · ${String(job.workerVersion).includes('v185') ? 'V185' : job.workerVersion}` : '';
          const signature = `${status}|${pct}|${job.currentBusiness || ''}|${job.message || ''}`;
          if (signature === lastSignature) unchangedCycles += 1; else { lastSignature = signature; unchangedCycles = 0; }
          setProgressText(progress, `[V191直连进度] Job ${jobId} · ${job.message || '后台生成中'} · ${pct}%${part}${mode}${worker}`);
          if (status === 'COMPLETED') {
            const readyFiles = Array.isArray(job.files) ? job.files.filter(item => item?.url && item?.name) : [];
            if (!readyFiles.length) throw new Error('后台任务已完成，但没有返回可下载文件');
            renderFiles(files, readyFiles);
            clearActiveJob(jobId);
            setProgressText(progress, `[V191直连进度] Job ${jobId} · 生成完成：共 ${readyFiles.length} 个完整文件，可直接下载`);
            return { ...job, files: readyFiles };
          }
          if (status === 'FAILED' || status === 'CANCELLED') {
            clearActiveJob(jobId);
            const error = new Error(job.message || job.error || '后台导出失败');
            error.code = job.errorCode || status;
            throw error;
          }
        } catch (error) {
          if (myEpoch !== pollEpoch) return { cancelled: true };
          if ([401,403,404].includes(Number(error.status || 0)) || ['FAILED','CANCELLED'].includes(String(error.code || '').toUpperCase())) throw error;
          if (/后台任务已完成，但没有返回可下载文件/.test(String(error.message || ''))) throw error;
          networkErrors += 1;
          const disconnectedSeconds = Math.max(1, Math.floor((Date.now() - lastGoodAt) / 1000));
          setProgressText(progress, `[V191直连进度] Job ${jobId} · 状态连接暂时中断 ${disconnectedSeconds} 秒，后台任务仍保留；正在恢复（第 ${networkErrors} 次）…`);
        }
        await sleep(pollDelay(unchangedCycles, networkErrors));
      }
      return { cancelled: true };
    } finally {
      if (myEpoch === pollEpoch && pollingJobId === jobId) pollingJobId = '';
    }
  }

  async function exportPeriodReportV191() {
    const owned = claimExclusiveDom();
    const { progress, files, button } = owned;
    if (!progress || !files) return;
    const payload = exportInputs();
    if (!validate(payload, progress)) return;
    cancelCurrentPoll();
    files.innerHTML = '';
    const originalButtonText = button?.textContent || '';
    if (button) { button.disabled = true; button.textContent = '后台生成中…'; }
    const singleBusiness = String(payload.businessType || 'ALL').toUpperCase() !== 'ALL';
    const prepareUrl = singleBusiness ? '/api/v190/export-period/prepare' : '/api/export-period/prepare';
    progress.textContent = singleBusiness
      ? `[V191直连进度] 正在通过V190专用通道创建 ${payload.businessType} V185独立流式完整报表任务…`
      : '[V191直连进度] 正在创建7业务后台完整报表任务…';
    try {
      const start = await json(prepareUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
      }, singleBusiness ? 8000 : 20000, singleBusiness ? 'V190导出创建接口' : '七业务导出创建接口');
      const readyFiles = Array.isArray(start.files) ? start.files.filter(item => item?.url && item?.name) : [];
      if (readyFiles.length) {
        renderFiles(files, readyFiles);
        clearActiveJob();
        progress.textContent = `[V191直连进度] 完整报表已生成：共 ${readyFiles.length} 个文件`;
        return;
      }
      const jobId = String(start.jobId || '').trim();
      const pollUrl = String(start.pollUrl || '').trim() || (singleBusiness ? `/api/v190/export-job/${encodeURIComponent(jobId)}` : `/api/v84/export-job/${encodeURIComponent(jobId)}`);
      if (!jobId) throw new Error('报表请求已提交，但服务器没有返回后台任务编号');
      saveActiveJob(jobId, payload, pollUrl);
      const initialPct = Math.max(0, Math.min(100, Number(start.progress || 0)));
      progress.textContent = `[V191直连进度] Job ${jobId} · ${start.message || '后台完整报表任务已创建'} · ${initialPct}%${start.workerMode === 'SINGLE_BUSINESS_DIRECT' ? ' · 独立单进程' : ''}`;
      await waitForJob(jobId, progress, files, pollUrl);
    } catch (error) {
      progress.textContent = `[V191直连进度] 导出失败：${error.message}`;
    } finally {
      if (button) { button.disabled = false; button.textContent = originalButtonText || '一键导出全部报表'; }
    }
  }

  async function resumeActiveJobV191() {
    const active = loadActiveJob();
    if (!active?.jobId) return;
    const { progress, files } = claimExclusiveDom();
    if (!progress || !files) return;
    cancelCurrentPoll();
    progress.textContent = `[V191直连进度] 检测到当前完整报表任务 ${active.jobId}，正在恢复唯一进度通道…`;
    try { await waitForJob(active.jobId, progress, files, active.pollUrl || ''); }
    catch (error) {
      if (Number(error.status || 0) === 404) clearActiveJob(active.jobId);
      progress.textContent = `[V191直连进度] 恢复导出任务失败：${error.message}`;
    }
  }

  retirePreviousController();
  clearLegacyJobs();
  claimExclusiveDom();
  global.exportPeriodReport = exportPeriodReportV191;
  global.exportPeriodReportV191 = exportPeriodReportV191;
  global.resumeActiveExportJob = resumeActiveJobV191;
  global.__CE_QC_V84_ASYNC_EXPORT_UI__ = { version: VERSION, pollDelay, waitForJob, cancelCurrentPoll, activeJobKey: ACTIVE_JOB_KEY, claimExclusiveDom };
  document.addEventListener('click', event => {
    if (event.target?.closest?.('[data-page="reports"],.side-link')) setTimeout(() => claimExclusiveDom(), 0);
  }, true);
  setTimeout(() => { claimExclusiveDom(); void resumeActiveJobV191(); }, 80);
  console.info('[CE-QC][V191_EXPORT_UI_DIRECT]', VERSION);
})(window);
