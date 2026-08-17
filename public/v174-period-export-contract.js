(function restoreAsyncPeriodExportV178(global) {
  if (global.__CE_QC_V178_ASYNC_EXPORT_AUTHORITY__) return;

  const VERSION = '2026-08-17-v178-async-export-authority-v2';
  const SCRIPT_ID = 'ceQcAsyncExportUiV178';
  const SCRIPT_SRC = '/v84-async-export-ui.js?v=20260817-v178-1';

  function hasV178Exporter() {
    return /v178/i.test(String(global.__CE_QC_V84_ASYNC_EXPORT_UI__?.version || ''))
      && typeof global.exportPeriodReport === 'function';
  }

  function markReady() {
    global.__CE_QC_V178_ASYNC_EXPORT_AUTHORITY__ = {
      version: VERSION,
      asyncExporter: global.__CE_QC_V84_ASYNC_EXPORT_UI__?.version || ''
    };
    console.info('[CE-QC][V178_ASYNC_EXPORT_AUTHORITY]', VERSION, global.__CE_QC_V84_ASYNC_EXPORT_UI__?.version || 'loading');
  }

  function loadAsyncExporter() {
    if (hasV178Exporter()) {
      markReady();
      return;
    }

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      if (existing.dataset.loaded === '1') markReady();
      else existing.addEventListener('load', markReady, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = false;
    script.onload = () => { script.dataset.loaded = '1'; markReady(); };
    script.onerror = () => {
      console.error('[CE-QC][V178_ASYNC_EXPORT_AUTHORITY] failed to load', SCRIPT_SRC);
      const progress = document.getElementById('exportProgress');
      if (progress) progress.textContent = '导出模块加载失败，请刷新页面后重试。';
    };
    document.body.appendChild(script);
  }

  // The prepare endpoint is asynchronous. A valid first response may only contain
  // jobId/pollUrl and therefore must never be treated as a missing-download error.
  // V178 deliberately replaces any older cached exporter before the user clicks.
  loadAsyncExporter();
})(window);
