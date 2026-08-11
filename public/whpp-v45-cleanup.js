(function () {
  const VERSION = '2026-08-11-v48-whpp-cleanup-v2';
  // CN/ZT are hidden on WHPP's compact local board. 580 is no longer hidden:
  // CEL:CCSL580 is a dedicated 580滞留包裹 business metric.
  const HIDDEN_CORE_LABELS = new Set(['工单', 'CCSLCN分流', 'CCSLZT分流']);
  let scheduled = false;

  function cleanup() {
    scheduled = false;
    if (location.pathname !== '/whpp') return;
    const root = document.getElementById('shopeePage');
    if (!root) return;
    root.querySelectorAll('.v18-core-grid .v18-metric-card').forEach(card => {
      const label = String(card.querySelector('span')?.textContent || '').trim();
      if (HIDDEN_CORE_LABELS.has(label)) card.remove();
    });
  }

  function scheduleCleanup() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(cleanup);
  }

  function install() {
    const root = document.getElementById('shopeePage') || document.body;
    const observer = new MutationObserver(mutations => {
      if (location.pathname !== '/whpp') return;
      if (mutations.some(mutation => mutation.type === 'childList' && mutation.addedNodes.length > 0)) scheduleCleanup();
    });
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener('popstate', scheduleCleanup);
    scheduleCleanup();
    console.info('[CE-QC][WHPP_CLEANUP]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
