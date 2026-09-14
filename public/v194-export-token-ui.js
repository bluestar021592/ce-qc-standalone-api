(function installV473ExportUiLoader(global){
  const VERSION='2026-09-13-v508-export-ui-loader-v4';
  if(global.__CE_QC_V473_EXPORT_UI_LOADER__===VERSION)return;
  global.__CE_QC_V473_EXPORT_UI_LOADER__=VERSION;
  const script=document.createElement('script');
  script.src='/v473-all-export-sidecar-ui.js?v=20260908-v473-2';
  script.async=false;
  script.dataset.ceQcExportOwner='v473';
  (document.head||document.documentElement).appendChild(script);
  const routeOwner=document.createElement('script');
  routeOwner.src='/v508-canonical-business-export-route.js?v=20260913-v508-2';
  routeOwner.async=false;
  routeOwner.dataset.ceQcExportRouteOwner='v508';
  (document.head||document.documentElement).appendChild(routeOwner);
  console.info('[CE-QC][V473_EXPORT_UI_LOADER]',VERSION,'V473 sidecar UI + V508 canonical business export route');
})(window);
