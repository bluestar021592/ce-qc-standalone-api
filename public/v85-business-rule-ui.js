(function installBusinessRuleUiV85(global) {
  if (global.__CE_QC_V85_BUSINESS_RULE_UI__) return;
  const VERSION = '2026-08-13-v89-business-rule-cleanup-v4';
  let timer = null;

  function routeType() {
    const path = location.pathname.toLowerCase();
    if (path === '/shopeecn') return 'SHOPEECN';
    if (path === '/shopeevn') return 'SHOPEEVN';
    if (path === '/whpp') return 'WHPP';
    return '';
  }

  function removeMetricCards(labels) {
    const unwanted = new Set(labels);
    document.querySelectorAll('.v18-core-grid .v18-metric-card').forEach(card => {
      const label = String(card.querySelector('span')?.textContent || '').trim();
      if (unwanted.has(label)) card.remove();
    });
  }

  function cleanup() {
    const type = routeType();
    if (type === 'WHPP') {
      removeMetricCards(['CCSLCN分流','CCSLZT分流','580滞留包裹','CCSL580分流','CECN滞留包裹','CEZT滞留包裹']);
      return;
    }
    if (['SHOPEECN','SHOPEEVN'].includes(type)) {
      // CN/VN do not use 580 or CN diversion. CEZT remains because it is still a
      // valid observed business destination in the existing source-of-truth rules.
      removeMetricCards(['580滞留包裹','CCSL580分流','CCSLCN分流','CCSLCN','CECN滞留包裹']);
    }
  }

  function schedule(delay = 30) {
    clearTimeout(timer);
    timer = setTimeout(cleanup, Math.max(0, delay));
  }

  // Do not run a document-wide MutationObserver or a second WHPP metric API loop.
  // V89 injects WHPP into the dashboard model itself; V85 now only removes options
  // that cannot occur for the current business.
  if (global.DashboardV18 && !global.DashboardV18.__v85CleanupWrapped) {
    const original = global.DashboardV18.renderBusiness;
    global.DashboardV18.renderBusiness = function v85CleanupRenderBusiness(root, model) {
      const result = original.call(this, root, model);
      schedule(0);
      return result;
    };
    global.DashboardV18.__v85CleanupWrapped = true;
  }

  global.addEventListener('popstate', () => schedule(20));
  global.addEventListener('ce-qc-startup-truth-ready', () => schedule(20));
  document.addEventListener('click', event => {
    if (event.target?.closest?.('.side-link,#topRangeQuery,#dashboardRangeQuery')) schedule(40);
  }, true);
  schedule(80);

  global.__CE_QC_V85_BUSINESS_RULE_UI__ = { version: VERSION };
  console.info('[CE-QC][V89_BUSINESS_RULE_CLEANUP]', VERSION);
})(window);
