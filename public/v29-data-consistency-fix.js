(function loadCeQcRuntimePatches() {
  if (new URLSearchParams(location.search).has('visualTest')) return;

  function loadScript(src, onload) {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    if (onload) script.onload = onload;
    document.head.appendChild(script);
  }

  loadScript('/v29-data-consistency-core.js?v=20260809-v29-core-1', function () {
    loadScript('/v33-live-run-progress.js?v=20260809-v33-1');
  });
})();
