(function installAsyncExportUiV177(global) {
  if (global.__CE_QC_V84_ASYNC_EXPORT_UI__) return;
  const VERSION = '2026-08-17-v177-one-business-one-workbook-ui-v1';
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

  function saveActiveJob(jobId, payload = {}) {
    try { localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId, payload, savedAt: new Date().toISOString() })); } catch {}
  }
  function loadActiveJob() {
    try { const value = JSON.parse(localStorage.getItem(ACTIVE_JOB_KEY) || 'null'); return value?.jobId ? value : null; } catch { return null; }
  }
  function clearActiveJob(jobId = '') {
    try { const current = loadActiveJob(); if (!jobId || !current || current.jobId === jobId) localStorage.removeItem(ACTIVE_JOB_KEY); } catch {}
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
    } else if (!payload.date) { progress.textContent = '请选择基准日期'; return false; }
    return true;
  }

  function fileLabel(file = {}) {
    const name = String(file.name || '');
    if (/\.zip$/i.test(name)) return '下载全部完整报表';
    if (/管理汇总/.test(name)) return '管理汇总完整表';
    return '下载完整表';
  }
  function renderFiles(target, files = []) {
    target.innerHTML = files.map(file => `<a class="export-file-item" href="${String(file.url || '').replace(/"/g, '&quot;')}"><span>${String(file.name || '').replace(/[&<>]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]))}</span><b>${fileLabel(file)}</b></a>`).join('');
  }
  function setProgressText(target, text) { if (target.textContent !== text) target.textContent = text; }
  function pollDelay(unchangedCycles, networkErrors = 0) {
    if (document.visibilityState === 'hidden') return 5000;
    if (networkErrors > 0) return Math.min(6000, 1600 + Math.min(networkErrors, 12) * 350);
    if (unchangedCycles >= 5) return 2500;
    if (unchangedCycles >= 2) return 1800;
    return 900;
  }

  async function waitForJob(jobId, progress, files) {
    if (!jobId || pollingJobId === jobId) return null;
    pollingJobId = jobId;
    let networkErrors = 0;
    let lastSignature = '';
    let unchangedCycles = 0;
    try {
      while (true) {
        try {
          const job = await json(`/api/v84/export-job/${encodeURIComponent(jobId)}`);
          networkErrors = 0;
          const pct = Math.max(0, Math.min(100, Number(job.progress || 0)));
          const part = job.currentBusiness ? ` · ${job.currentBusiness}` : '';
          const signature = `${job.status}|${pct}|${job.currentBusiness || ''}|${job.message || ''}`;
          if (signature === lastSignature) unchangedCycles += 1;
          else { lastSignature = signature; unchangedCycles = 0; }
          setProgressText(progress, `${job.message || '后台生成中'} · ${pct}%${part}`);
          if (job.status === 'COMPLETED') {
            renderFiles(files, job.files || []);
            clearActiveJob(jobId);
            return job;
          }
          if (job.status === 'FAILED' || job.status === 'CANCELLED') {
            clearActiveJob(jobId);
            throw new Error(job.message || '后台导出失败');
          }
        } catch (error) {
          if ([401, 403, 404].includes(Number(error.status || 0))) throw error;
          networkErrors += 1;
          setProgressText(progress, `后台完整报表任务仍在运行，页面连接正在自动恢复（已重试 ${networkErrors} 次，不会因次数停止）…`);
        }
        await sleep(pollDelay(unchangedCycles, networkErrors));
      }
    } finally {
      if (pollingJobId === jobId) pollingJobId = '';
    }
  }

  async function exportPeriodReportV177() {
    const progress = document.getElementById('exportProgress');
    const files = document.getElementById('exportGeneratedFiles');
    if (!progress || !files) return;
    const payload = exportInputs();
    if (!validate(payload, progress)) return;
    files.innerHTML = '';
    progress.textContent = '正在创建后台完整报表任务：每个业务只生成1个Excel，内部不再把日期分片给你下载…';
    try {
      const start = await json('/api/export-period/prepare', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (!start.async || !start.jobId) {
        if (start.files) { progress.textContent = '完整报表已生成'; renderFiles(files, start.files); return; }
        throw new Error('服务器未返回后台导出任务编号');
      }
      saveActiveJob(start.jobId, payload);
      progress.textContent = `${start.message || '后台完整报表任务已创建'} · 0%`;
      await waitForJob(start.jobId, progress, files);
    } catch (error) {
      progress.textContent = `导出状态读取失败：${error.message}。已创建的后台任务不会因刷新页面而丢失，重新进入报表页会自动恢复。`;
    }
  }

  async function resumeActiveJob() {
    const active = loadActiveJob();
    if (!active?.jobId) return;
    const progress = document.getElementById('exportProgress');
    const files = document.getElementById('exportGeneratedFiles');
    if (!progress || !files) return;
    progress.textContent = '检测到上次未完成的完整报表任务，正在恢复进度…';
    try { await waitForJob(active.jobId, progress, files); }
    catch (error) { if (error.status === 404) clearActiveJob(active.jobId); progress.textContent = `恢复导出任务失败：${error.message}`; }
  }

  ensureBusinessOptions();
  global.exportPeriodReport = exportPeriodReportV177;
  global.resumeActiveExportJob = resumeActiveJob;
  global.__CE_QC_V84_ASYNC_EXPORT_UI__ = { version: VERSION, pollDelay };
  setTimeout(() => void resumeActiveJob(), 80);
  console.info('[CE-QC][V177_ONE_BUSINESS_ONE_WORKBOOK]', VERSION);
})(window);
