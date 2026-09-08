(function installV473ExportUiLoader(global){
  const VERSION='2026-09-08-v473-export-ui-loader-v2';
  if(global.__CE_QC_V473_EXPORT_UI_LOADER__===VERSION)return;
  global.__CE_QC_V473_EXPORT_UI_LOADER__=VERSION;
  const script=document.createElement('script');
  script.src='/v473-all-export-sidecar-ui.js?v=20260908-v473-2';
  script.async=false;
  script.dataset.ceQcExportOwner='v473';
  (document.head||document.documentElement).appendChild(script);
  console.info('[CE-QC][V473_EXPORT_UI_LOADER]',VERSION);
})(window);
