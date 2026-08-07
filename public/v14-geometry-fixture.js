window.__V14_GEOMETRY_FIXTURE__ = Object.freeze({
  sidebar: { x: 0, y: 0, width: 250, height: 1024 },
  topbar: { x: 250, y: 0, width: 1286, height: 64 },
  'business-card-total': { x: 268, y: 88, width: 200, height: 112 },
  'business-card-ce': { x: 478, y: 88, width: 200, height: 112 },
  'business-card-tbkh': { x: 688, y: 88, width: 200, height: 112 },
  'business-card-shopeecn': { x: 898, y: 88, width: 200, height: 112 },
  'business-card-shopeevn': { x: 1108, y: 88, width: 200, height: 112 },
  'business-card-ali1688': { x: 1318, y: 88, width: 200, height: 112 },
  'core-metrics': { x: 268, y: 210, width: 1250, height: 150 },
  'shopee-special': { x: 268, y: 370, width: 558, height: 300 },
  'dispatch-probability': { x: 836, y: 370, width: 682, height: 300 },
  'trend-ticket': { x: 268, y: 680, width: 304, height: 314 },
  'trend-pod': { x: 584, y: 680, width: 304, height: 314 },
  'trend-oc': { x: 899, y: 680, width: 304, height: 314 },
  'trend-first': { x: 1215, y: 680, width: 304, height: 314 }
});

function applyV16TestIds() {
  const selectors = {
    'business-card-total': '#homeBusinessCards > :nth-child(1)',
    'business-card-ce': '#homeBusinessCards > :nth-child(2)',
    'business-card-tbkh': '#homeBusinessCards > :nth-child(3)',
    'business-card-shopeecn': '#homeBusinessCards > :nth-child(4)',
    'business-card-shopeevn': '#homeBusinessCards > :nth-child(5)',
    'business-card-ali1688': '#homeBusinessCards > :nth-child(6)',
    'core-metrics': '.home-core-panel',
    'shopee-special': '.home-special-row > :nth-child(1)',
    'dispatch-probability': '.home-special-row > :nth-child(2)',
    'trend-ticket': '#homeTrendGrid > :nth-child(1)',
    'trend-pod': '#homeTrendGrid > :nth-child(2)',
    'trend-oc': '#homeTrendGrid > :nth-child(3)',
    'trend-first': '#homeTrendGrid > :nth-child(4)'
  };
  Object.entries(selectors).forEach(([testId, selector]) => {
    document.querySelector(selector)?.setAttribute('data-testid', testId);
  });
}

if (new URLSearchParams(location.search).has('visualTest')) {
  applyV16TestIds();
  new MutationObserver(applyV16TestIds).observe(document.getElementById('homePage'), { childList: true, subtree: true });
}
