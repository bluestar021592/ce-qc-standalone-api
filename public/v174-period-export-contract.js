(function restoreAsyncPeriodExportV178(global) {
  if (global.__CE_QC_V178_ASYNC_EXPORT_AUTHORITY__) return;

  const VERSION = '2026-08-17-v178-async-export-authority-v1';
  const SCRIPT_ID = 'ceQcAsyncExportUiV178';
  const SCRIPT_SRC = '/v84-async-export-ui.js?v=20260817-v178-1';

  function markReady() {
    global.__CE_QC_V178_ASYNC_EXPORT_AUTHORITY__ = {
      version: VERSION,
      asyncExporter: global.__CE_QC_V84_ASYNC_EXPORT_UI__?.version || ''
    };
    console.info('[CE-QC][V178_ASYNC_EXPORT_AUTHORITY]', VERSION, global.__CE_QC_V84_ASYNC_EXPORT_UI__?.version || 'loading');
  }

  function loadAsyncExporter() {
    if (global.__CE_QC_V84_ASYNC_EXPORT_UI__ && typeof global.exportPeriodReport === 'function') {
      markReady();
      return;
    }

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', markReady, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = false;
    script.onload = markReady;
    script.onerror = () => {
      console.error('[CE-QC][V178_ASYNC_EXPORT_AUTHORITY] failed to load', SCRIPT_SRC);
      const progress = document.getElementById('exportProgress');
      if (progress) progress.textContent = '导出模块加载失败，请刷新页面后重试。';
    };
    document.body.appendChild(script);
  }

  // /api/export-period/prepare is authoritative asynchronous work for large ranges.
  // The prepare response may only contain { async:true, jobId, pollUrl }. Files are
  // returned after the background worker reaches COMPLETED. Never restore the old
  // synchronous shim that required files in the prepare response.
  loadAsyncExporter();
})(window);
