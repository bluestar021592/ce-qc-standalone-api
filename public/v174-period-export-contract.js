(function restoreAsyncPeriodExportV175(global) {
  if (global.__CE_QC_V175_ASYNC_EXPORT_RESTORE__) return;

  const VERSION = '2026-08-17-v175-async-seven-business-export-restore-v1';
  const SCRIPT_ID = 'ceQcAsyncExportUiV120';
  const SCRIPT_SRC = '/v84-async-export-ui.js?v=20260817-v175-1';

  function markReady() {
    global.__CE_QC_V175_ASYNC_EXPORT_RESTORE__ = {
      version: VERSION,
      asyncExporter: global.__CE_QC_V84_ASYNC_EXPORT_UI__?.version || ''
    };
    console.info('[CE-QC][V175_ASYNC_EXPORT_RESTORE]', VERSION, global.__CE_QC_V84_ASYNC_EXPORT_UI__?.version || 'loading');
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
      console.error('[CE-QC][V175_ASYNC_EXPORT_RESTORE] failed to load', SCRIPT_SRC);
      const progress = document.getElementById('exportProgress');
      if (progress) progress.textContent = '导出模块加载失败，请刷新页面后重试。';
    };
    document.body.appendChild(script);
  }

  // V174 previously replaced exportPeriodReport with a synchronous contract shim.
  // The production export route is asynchronous for large 7-business ranges and
  // returns { async:true, jobId } first, then files from /api/v84/export-job/:id.
  // Restore that authoritative UI and do not require files in the prepare response.
  loadAsyncExporter();
})(window);
