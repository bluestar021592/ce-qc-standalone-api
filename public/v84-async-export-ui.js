(function installAsyncExportUiV84(global) {
  if (global.__CE_QC_V84_ASYNC_EXPORT_UI__) return;
  const VERSION = '2026-08-13-v88-resumable-seven-business-export-ui-v3';
  const ACTIVE_JOB_KEY = 'ce_qc_active_export_job_v88';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let pollingJobId = '';

  function ensureBusinessOptions() {
    const select = document.getElementById('periodExportBusiness');
    if (!select) return;
    const wanted = [
      ['ALL', '管理汇总 + 7业务'],
      ['CE', '仅CE'],
      ['CEAF', '仅CEAF空运'],
      ['TBKH', '仅TBKH'],
      ['ALI1688', '仅ALI1688'],
      ['SHOPEECN', '仅SHOPEE CN'],
      ['SHOPEEVN', '仅SHOPEE VN'],
      ['WHPP', '仅WHPP本土']
    ];
    const current = select.value || 'ALL';
    select.innerHTML = wanted.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    select.value = wanted.some(([value]) => value === current) ? current : 'ALL';
  }

  function saveActiveJob(jobId, payload = {}) {
    try {
      localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId, payload, savedAt: new Date().toISOString() }));
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
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function exportInputs() {
    ensureBusinessOptions();
    return {
      periodType: String(global.exportPeriodType || document.querySelector('.period-tab.active')?.dataset?.period || 'daily'),
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

  function renderFiles(target, files = []) {
    target.innerHTML = files.map(file => `<a class="export-file-item" href="${String(file.url || '').replace(/"/g, '&quot;')}"><span>${String(file.name || '').replace(/[&<>]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]))}</span><b>下载</b></a>`).join('');
  }

  async function waitForJob(jobId, progress, files) {
    if (!jobId || pollingJobId === jobId) return null;
    pollingJobId = jobId;
    let networkErrors = 0;
    try {
      while (true) {
        try {
          const job = await json(`/api/v84/export-job/${encodeURIComponent(jobId)}`);
          networkErrors = 0;
          const pct = Math.max(0, Math.min(100, Number(job.progress || 0)));
          const part = job.currentBusiness ? ` · ${job.currentBusiness}${job.businessParts > 1 ? ` ${job.currentPart}/${job.businessParts}` : ''}` : '';
          progress.textContent = `${job.message || '后台生成中'} · ${pct}%${part}`;
          if (job.status === 'COMPLETED') {
            renderFiles(files, job.files || []);
            clearActiveJob(jobId);
            return job;
          }
          if (job.status === 'FAILED') {
            clearActiveJob(jobId);
            throw new Error(job.message || '后台导出失败');
          }
        } catch (error) {
          networkErrors += 1;
          if (error.status === 401) throw error;
          if (networkErrors >= 8) throw error;
          progress.textContent = `后台任务仍在服务器运行，页面连接正在恢复（${networkErrors}/8）…`;
        }
        await sleep(1200);
      }
    } finally {
      if (pollingJobId === jobId) pollingJobId = '';
    }
  }

  async function exportPeriodReportV84() {
    const progress = document.getElementById('exportProgress');
    const files = document.getElementById('exportGeneratedFiles');
    if (!progress || !files) return;
    const payload = exportInputs();
    if (!validate(payload, progress)) return;
    files.innerHTML = '';
    progress.textContent = '正在创建7业务后台导出任务；关闭或刷新页面也不会中断任务…';
    try {
      const start = await json('/api/export-period/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!start.async || !start.jobId) {
        if (start.files) {
          progress.textContent = `生成完成：${start.range?.from || ''} 至 ${start.range?.to || ''}`;
          renderFiles(files, start.files);
          return;
        }
        throw new Error('服务器未返回后台导出任务编号');
      }
      saveActiveJob(start.jobId, payload);
      progress.textContent = `${start.message || '后台任务已创建'} · 0%`;
      await waitForJob(start.jobId, progress, files);
    } catch (error) {
      progress.textContent = `导出状态读取失败：${error.message}。后台任务若已创建会继续运行，重新进入报表页将自动恢复查询。`;
    }
  }

  async function resumeActiveJob() {
    const active = loadActiveJob();
    if (!active?.jobId) return;
    const progress = document.getElementById('exportProgress');
    const files = document.getElementById('exportGeneratedFiles');
    if (!progress || !files) return;
    progress.textContent = '检测到上次未完成的后台导出任务，正在恢复进度…';
    try {
      await waitForJob(active.jobId, progress, files);
    } catch (error) {
      if (error.status === 404) clearActiveJob(active.jobId);
      progress.textContent = `恢复导出任务失败：${error.message}`;
    }
  }

  ensureBusinessOptions();
  global.exportPeriodReport = exportPeriodReportV84;
  global.resumeActiveExportJob = resumeActiveJob;
  global.__CE_QC_V84_ASYNC_EXPORT_UI__ = { version: VERSION };
  setTimeout(() => void resumeActiveJob(), 80);
  console.info('[CE-QC][V88_RESUMABLE_SEVEN_BUSINESS_EXPORT_UI]', VERSION);
})(window);
