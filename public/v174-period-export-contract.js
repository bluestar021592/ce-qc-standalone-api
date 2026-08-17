(function installPeriodExportContractV174(global) {
  if (global.__CE_QC_V174_PERIOD_EXPORT_CONTRACT__) return;
  const VERSION = '2026-08-17-v174-period-export-contract-v1';

  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  }

  function activePeriod() {
    return document.querySelector('.period-tab.active')?.dataset?.period || 'daily';
  }

  function fallbackRange(periodType, date, fromDate, toDate) {
    if (periodType === 'custom') {
      if (validDate(fromDate) && validDate(toDate)) return { from: fromDate, to: toDate };
      return null;
    }
    if (!validDate(date)) return null;
    if (periodType === 'daily') return { from: date, to: date };
    const source = new Date(`${date}T12:00:00+07:00`);
    const iso = value => {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    if (periodType === 'weekly') {
      const day = (source.getDay() + 6) % 7;
      const from = new Date(source); from.setDate(source.getDate() - day);
      const to = new Date(from); to.setDate(from.getDate() + 6);
      return { from: iso(from), to: iso(to) };
    }
    if (periodType === 'monthly') {
      const from = new Date(source.getFullYear(), source.getMonth(), 1, 12);
      const to = new Date(source.getFullYear(), source.getMonth() + 1, 0, 12);
      return { from: iso(from), to: iso(to) };
    }
    return { from: date, to: date };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  async function exportPeriodReportV174() {
    const progress = document.getElementById('exportProgress');
    const filesNode = document.getElementById('exportGeneratedFiles');
    const periodType = activePeriod();
    const date = String(document.getElementById('periodExportDate')?.value || '');
    const fromDate = String(document.getElementById('periodExportFrom')?.value || '');
    const toDate = String(document.getElementById('periodExportTo')?.value || '');
    const businessType = String(document.getElementById('periodExportBusiness')?.value || 'ALL');

    if (periodType === 'custom') {
      if (!validDate(fromDate) || !validDate(toDate)) {
        if (progress) progress.textContent = '导出失败：请选择有效的开始日期和结束日期。';
        return;
      }
      if (fromDate > toDate) {
        if (progress) progress.textContent = '导出失败：开始日期不能晚于结束日期。';
        return;
      }
    }

    if (progress) progress.textContent = '正在从SQLite已完成日报生成报表；网页看板不会被阻塞…';
    if (filesNode) filesNode.innerHTML = '';

    try {
      const payload = { periodType, date, businessType };
      if (periodType === 'custom') Object.assign(payload, { fromDate, toDate });
      const response = await fetch('/api/export-period/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const rawText = await response.text();
      let result = {};
      try { result = rawText ? JSON.parse(rawText) : {}; } catch {}
      if (!response.ok || result.ok === false) {
        throw new Error(result.error || result.message || `服务器请求失败（HTTP ${response.status}）`);
      }

      const range = (validDate(result?.range?.from) && validDate(result?.range?.to))
        ? result.range
        : fallbackRange(periodType, date, fromDate, toDate);
      const files = Array.isArray(result?.files) ? result.files.filter(file => file?.url && file?.name) : [];
      if (!range) throw new Error('导出接口未返回有效日期范围，请重新选择日期后再试。');
      if (!files.length) throw new Error('报表已经生成请求，但接口未返回可下载文件。');

      if (progress) progress.textContent = `生成完成：${range.from} 至 ${range.to}，共${files.length}个文件`;
      if (filesNode) {
        filesNode.innerHTML = files.map(file => `<a class="export-file-item" href="${escapeHtml(file.url)}"><span>${escapeHtml(file.name)}</span><b>下载</b></a>`).join('');
      }
    } catch (error) {
      if (progress) progress.textContent = `导出失败：${error?.message || error}`;
    }
  }

  global.exportPeriodReport = exportPeriodReportV174;
  global.__CE_QC_V174_PERIOD_EXPORT_CONTRACT__ = { version: VERSION };
  console.info('[CE-QC][V174_PERIOD_EXPORT_CONTRACT]', VERSION);
})(window);
