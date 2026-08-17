(function installAsyncExportUiV178(global) {
  if (global.__CE_QC_V178_ASYNC_EXPORT_UI_INSTALLED__) return;
  global.__CE_QC_V178_ASYNC_EXPORT_UI_INSTALLED__ = true;

  const VERSION = '2026-08-17-v178-async-export-poll-authority-v1';
  const ACTIVE_JOB_KEY = 'ce_qc_active_export_job_v177';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let pollingJobId = '';

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
      localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId, payload, pollUrl, savedAt: new Date().toISOString() }));
    } catch {}
  }
  function loadActiveJob() {
    try {
      const value = JSON.parse(localStorage.getItem(ACTIVE_JOB_KEY) || 'null');
      return value?.jobId ? value : null;
    } catch { return null; }
  }
  function clearActiveJob(jobId = '') {
    try {
      const current = loadActiveJob();
      if (!jobId || !current || current.jobId === jobId) localStorage.removeItem(ACTIVE_JOB_KEY);
    } catch {}
  }

  async function json(url, init = {}) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...init });
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
    if (document.visibilityState === 'hidden') return 5000;
    if (networkErrors > 0) return Math.min(6500, 1700 + Math.min(networkErrors, 12) * 350);
    if (unchangedCycles >= 5) return 2600;
    if (unchangedCycles >= 2) return 1800;
    return 900;
  }

  async function waitForJob(jobId, progress, files, suppliedPollUrl = '') {
    if (!jobId) throw new Error('后台没有返回导出任务编号');
    if (pollingJobId === jobId) return null;
    pollingJobId = jobId;
    const pollUrl = suppliedPollUrl || `/api/v84/export-job/${encodeURIComponent(jobId)}`;
    let networkErrors = 0;
    let lastSignature = '';
    let unchangedCycles = 0;
    try {
      while (true) {
        try {
          const job = await json(pollUrl);
          networkErrors = 0;
          const status = String(job.status || '').toUpperCase();
          const pct = Math.max(0, Math.min(100, Number(job.progress || 0)));
          const part = job.currentBusiness ? ` · ${job.currentBusiness}` : '';
          const signature = `${status}|${pct}|${job.currentBusiness || ''}|${job.message || ''}`;
          if (signature === lastSignature) unchangedCycles += 1;
          else { lastSignature = signature; unchangedCycles = 0; }
          setProgressText(progress, `${job.message || '后台生成中'} · ${pct}%${part}`);

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
          if ([401, 403, 404].includes(Number(error.status || 0)) || ['FAILED', 'CANCELLED'].includes(String(error.code || '').toUpperCase())) throw error;
          if (/后台任务已完成，但没有返回可下载文件/.test(String(error.message || ''))) throw error;
          networkErrors += 1;
          setProgressText(progress, `后台完整报表仍在生成，页面连接正在自动恢复（第 ${networkErrors} 次）…`);
        }
        await sleep(pollDelay(unchangedCycles, networkErrors));
      }
    } finally {
      if (pollingJobId === jobId) pollingJobId = '';
    }
  }

  async function exportPeriodReportV178() {
    const progress = document.getElementById('exportProgress');
    const files = document.getElementById('exportGeneratedFiles');
    const button = document.querySelector('[data-testid="export-all-reports"]');
    if (!progress || !files) return;
    const payload = exportInputs();
    if (!validate(payload, progress)) return;

    files.innerHTML = '';
    const originalButtonText = button?.textContent || '';
    if (button) { button.disabled = true; button.textContent = '后台生成中…'; }
    progress.textContent = '正在创建后台完整报表任务：一个业务只生成1个完整Excel，请不要重复点击…';

    try {
      const start = await json('/api/export-period/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });

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
      progress.textContent = `${start.message || '后台完整报表任务已创建'} · ${initialPct}%`;
      await waitForJob(jobId, progress, files, pollUrl);
    } catch (error) {
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
    progress.textContent = '检测到上次未完成的完整报表任务，正在恢复进度…';
    try {
      await waitForJob(active.jobId, progress, files, active.pollUrl || '');
    } catch (error) {
      if (Number(error.status || 0) === 404) clearActiveJob(active.jobId);
      progress.textContent = `恢复导出任务失败：${error.message}`;
    }
  }

  ensureBusinessOptions();
  global.exportPeriodReport = exportPeriodReportV178;
  global.resumeActiveExportJob = resumeActiveJob;
  global.__CE_QC_V84_ASYNC_EXPORT_UI__ = { version: VERSION, pollDelay, waitForJob };
  setTimeout(() => void resumeActiveJob(), 80);
  console.info('[CE-QC][V178_ASYNC_EXPORT_POLL_AUTHORITY]', VERSION);
})(window);
