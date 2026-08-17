(function installAsyncExportUiV186(global) {
  if (global.__CE_QC_V186_ASYNC_EXPORT_UI_INSTALLED__) return;
  global.__CE_QC_V186_ASYNC_EXPORT_UI_INSTALLED__ = true;

  const VERSION = '2026-08-17-v186-single-business-export-ui-poll-isolation-v1';
  const ACTIVE_JOB_KEY = 'ce_qc_active_export_job_v186';
  const LEGACY_JOB_KEYS = ['ce_qc_active_export_job_v180'];
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

  function saveActiveJob(jobId, payload = {}, pollUrl = '') {
    try {
      localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId, payload, pollUrl, savedAt: new Date().toISOString(), version: VERSION }));
    } catch {}
  }
  function loadActiveJob() {
    try {
      const value = JSON.parse(localStorage.getItem(ACTIVE_JOB_KEY) || 'null');
      if (!value?.jobId) return null;
      if (String(value.version || '') !== VERSION) {
        localStorage.removeItem(ACTIVE_JOB_KEY);
        return null;
      }
      return value;
    } catch { return null; }
  }
  function clearActiveJob(jobId = '') {
    try {
      const current = loadActiveJob();
      if (!jobId || !current || current.jobId === jobId) localStorage.removeItem(ACTIVE_JOB_KEY);
    } catch {}
  }

  async function json(url, init = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal, ...init });
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
        const timeoutError = new Error(`状态接口${Math.round(timeoutMs / 1000)}秒内未响应`);
        timeoutError.code = 'POLL_TIMEOUT';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
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
    } else if (!payload.date) {
      progress.textContent = '请选择基准日期';
      return false;
    }
    return true;
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  }
  function escapeAttr(value = '') {
    return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function fileLabel(file = {}) {
    const name = String(file.name || '');
    if (/\.zip$/i.test(name)) return '下载全部完整报表';
    if (/管理汇总/.test(name)) return '管理汇总完整表';
    return '下载完整表';
  }
  function renderFiles(target, files = []) {
    target.innerHTML = files.map(file => `<a class="export-file-item" href="${escapeAttr(file.url || '')}"><span>${escapeHtml(file.name || '')}</span><b>${fileLabel(file)}</b></a>`).join('');
  }
  function setProgressText(target, text) {
    if (target && target.textContent !== text) target.textContent = text;
  }
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
    const pollUrl = suppliedPollUrl || `/api/v84/export-job/${encodeURIComponent(jobId)}`;
    let networkErrors = 0;
    let lastSignature = '';
    let unchangedCycles = 0;
    let lastGoodAt = Date.now();
    try {
      while (myEpoch === pollEpoch) {
        try {
          const job = await json(pollUrl, {}, 15000);
          if (myEpoch !== pollEpoch) return { cancelled: true };
          networkErrors = 0;
          lastGoodAt = Date.now();
          const status = String(job.status || '').toUpperCase();
          const pct = Math.max(0, Math.min(100, Number(job.progress || 0)));
          const part = job.currentBusiness ? ` · ${job.currentBusiness}` : '';
          const mode = job.workerMode === 'SINGLE_BUSINESS_DIRECT' ? ' · 独立单进程' : '';
          const worker = job.workerVersion ? ` · ${String(job.workerVersion).includes('v185') ? 'V185' : job.workerVersion}` : '';
          const signature = `${status}|${pct}|${job.currentBusiness || ''}|${job.message || ''}`;
          if (signature === lastSignature) unchangedCycles += 1;
          else { lastSignature = signature; unchangedCycles = 0; }
          setProgressText(progress, `${job.message || '后台生成中'} · ${pct}%${part}${mode}${worker}`);

          if (status === 'COMPLETED') {
            const readyFiles = Array.isArray(job.files) ? job.files.filter(item => item?.url && item?.name) : [];
            if (!readyFiles.length) throw new Error('后台任务已完成，但没有返回可下载文件');
            renderFiles(files, readyFiles);
            clearActiveJob(jobId);
            setProgressText(progress, `生成完成：共 ${readyFiles.length} 个完整文件，可直接下载`);
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
          if ([401, 403, 404].includes(Number(error.status || 0)) || ['FAILED', 'CANCELLED'].includes(String(error.code || '').toUpperCase())) throw error;
          if (/后台任务已完成，但没有返回可下载文件/.test(String(error.message || ''))) throw error;
          networkErrors += 1;
          const disconnectedSeconds = Math.max(1, Math.floor((Date.now() - lastGoodAt) / 1000));
          setProgressText(progress, `当前V185导出任务 ${jobId} 仍在后台执行；状态连接暂时中断 ${disconnectedSeconds} 秒，正在恢复（第 ${networkErrors} 次）…`);
        }
        await sleep(pollDelay(unchangedCycles, networkErrors));
      }
      return { cancelled: true };
    } finally {
      if (myEpoch === pollEpoch && pollingJobId === jobId) pollingJobId = '';
    }
  }

  async function exportPeriodReportV186() {
    const progress = document.getElementById('exportProgress');
    const files = document.getElementById('exportGeneratedFiles');
    const button = document.querySelector('[data-testid="export-all-reports"]');
    if (!progress || !files) return;
    const payload = exportInputs();
    if (!validate(payload, progress)) return;

    cancelCurrentPoll();
    files.innerHTML = '';
    const originalButtonText = button?.textContent || '';
    if (button) { button.disabled = true; button.textContent = '后台生成中…'; }
    progress.textContent = payload.businessType === 'ALL'
      ? '正在创建7业务后台完整报表任务…'
      : `正在创建 ${payload.businessType} V185独立流式完整报表任务；最终只生成1个Excel…`;

    try {
      const start = await json('/api/export-period/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      }, 20000);

      const readyFiles = Array.isArray(start.files) ? start.files.filter(item => item?.url && item?.name) : [];
      if (readyFiles.length) {
        renderFiles(files, readyFiles);
        clearActiveJob();
        progress.textContent = `完整报表已生成：共 ${readyFiles.length} 个文件`;
        return;
      }

      const jobId = String(start.jobId || '').trim();
      const pollUrl = String(start.pollUrl || '').trim();
      if (!jobId) throw new Error('报表请求已提交，但服务器没有返回后台任务编号');

      saveActiveJob(jobId, payload, pollUrl);
      const initialPct = Math.max(0, Math.min(100, Number(start.progress || 0)));
      progress.textContent = `${start.message || '后台完整报表任务已创建'} · ${initialPct}%${start.workerMode === 'SINGLE_BUSINESS_DIRECT' ? ' · 独立单进程' : ''} · Job ${jobId}`;
      await waitForJob(jobId, progress, files, pollUrl);
    } catch (error) {
      if (String(error?.code || '') === 'POLL_SUPERSEDED') return;
      progress.textContent = `导出失败：${error.message}。如果后台任务已经创建，重新进入报表页会自动恢复进度。`;
    } finally {
      if (button) { button.disabled = false; button.textContent = originalButtonText || '一键导出全部报表'; }
    }
  }

  async function resumeActiveJob() {
    const active = loadActiveJob();
    if (!active?.jobId) return;
    const progress = document.getElementById('exportProgress');
    const files = document.getElementById('exportGeneratedFiles');
    if (!progress || !files) return;
    cancelCurrentPoll();
    progress.textContent = `检测到V186当前完整报表任务 ${active.jobId}，正在恢复唯一进度通道…`;
    try {
      await waitForJob(active.jobId, progress, files, active.pollUrl || '');
    } catch (error) {
      if (Number(error.status || 0) === 404) clearActiveJob(active.jobId);
      progress.textContent = `恢复导出任务失败：${error.message}`;
    }
  }

  clearLegacyJobs();
  ensureBusinessOptions();
  global.exportPeriodReport = exportPeriodReportV186;
  global.resumeActiveExportJob = resumeActiveJob;
  global.__CE_QC_V84_ASYNC_EXPORT_UI__ = { version: VERSION, pollDelay, waitForJob, cancelCurrentPoll, activeJobKey: ACTIVE_JOB_KEY };
  setTimeout(() => void resumeActiveJob(), 80);
  console.info('[CE-QC][V186_SINGLE_BUSINESS_EXPORT_UI]', VERSION);
})(window);
