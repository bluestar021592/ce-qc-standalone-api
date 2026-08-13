(function installAsyncExportUiV84(global) {
  if (global.__CE_QC_V84_ASYNC_EXPORT_UI__) return;
  const VERSION = '2026-08-13-v84-async-export-ui-v1';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    let networkErrors = 0;
    while (true) {
      try {
        const job = await json(`/api/v84/export-job/${encodeURIComponent(jobId)}`);
        networkErrors = 0;
        const pct = Math.max(0, Math.min(100, Number(job.progress || 0)));
        const part = job.currentBusiness ? ` · ${job.currentBusiness}${job.businessParts > 1 ? ` ${job.currentPart}/${job.businessParts}` : ''}` : '';
        progress.textContent = `${job.message || '后台生成中'} · ${pct}%${part}`;
        if (job.status === 'COMPLETED') {
          renderFiles(files, job.files || []);
          return job;
        }
        if (job.status === 'FAILED') throw new Error(job.message || '后台导出失败');
      } catch (error) {
        networkErrors += 1;
        if (error.status === 401) throw error;
        if (networkErrors >= 8) throw error;
        progress.textContent = `后台导出仍在运行，页面连接正在重试（${networkErrors}/8）…`;
      }
      await sleep(1200);
    }
  }

  async function exportPeriodReportV84() {
    const progress = document.getElementById('exportProgress');
    const files = document.getElementById('exportGeneratedFiles');
    if (!progress || !files) return;
    const payload = exportInputs();
    if (!validate(payload, progress)) return;
    files.innerHTML = '';
    progress.textContent = '正在创建后台导出任务；大范围报表不会再占住网页后台…';
    try {
      const start = await json('/api/export-period/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!start.async || !start.jobId) {
        // Compatibility with an older server during rolling update.
        if (start.files) {
          progress.textContent = `生成完成：${start.range?.from || ''} 至 ${start.range?.to || ''}`;
          renderFiles(files, start.files);
          return;
        }
        throw new Error('服务器未返回后台导出任务编号');
      }
      progress.textContent = `${start.message || '后台任务已创建'} · 0%`;
      await waitForJob(start.jobId, progress, files);
    } catch (error) {
      progress.textContent = `导出失败：${error.message}`;
    }
  }

  global.exportPeriodReport = exportPeriodReportV84;
  global.__CE_QC_V84_ASYNC_EXPORT_UI__ = { version: VERSION };
  console.info('[CE-QC][V84_ASYNC_EXPORT_UI]', VERSION);
})(window);
