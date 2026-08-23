import express from 'express';

export const V231_METRIC_TRUTH_UI_INJECTION_ID = '2026-08-22-v231-metric-truth-ui-injection-v1';
export const V232_FAST_METRIC_UI_INJECTION_ID = '2026-08-22-v238-retired-fast-metric-ui-v1';
export const V235_CACHE_READY_UI_INJECTION_ID = '2026-08-22-v238-dashboard-owner-ui-injection-v1';
export const V239_DASHBOARD_REQUEST_UI_INJECTION_ID = '2026-08-23-v239-dashboard-request-coalescer-ui-v1';
export const V240_DAILY_RATE_UI_INJECTION_ID = '2026-08-23-v240-daily-rate-ui-injection-v1';
export const V244_SHOPEE_TREND_UI_INJECTION_ID = '2026-08-23-v244-shopee-operational-trends-ui-v1';
const CHART_MARKER = '/dashboard-chart-v18.js?v=20260822-v238-1';
const LIVE_MARKER = '/v234-dashboard-live.js?v=20260823-v240-1';
const GUARD_MARKER = '/v237-dashboard-owner-guard.js?v=20260822-v238-1';
const COALESCER_MARKER = '/v239-dashboard-request-coalescer.js?v=20260823-v239-1';
const HOME_MARKER = '/v237-home-dashboard-owner.js?v=20260823-v240-1';
const V244_SHOPEE_MARKER = '/v244-shopee-trend-owner.js?v=20260823-v244-1';
const DRILLDOWN_MARKER = '/v58-drilldown-runtime.js?v=20260822-v238-1';
const originalSend = express.response.send;

function stripScript(body, fileName) {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.replace(new RegExp(`\\s*<script\\b[^>]*src=["']\\/${escaped}(?:\\?[^"']*)?["'][^>]*><\\/script>\\s*`, 'gi'), '\n');
}

function prepareOwnerHtml(body) {
  // V237/V238/V239/V240/V244 owns dashboard current/trend rendering. Remove duplicate legacy
  // observers plus the old cache-ready poller that reloaded the whole page every
  // few seconds and created extra SQLite traffic.
  for (const file of ['v230-metric-truth-ui.js','v232-card-percentages.js','v235-cache-ready-reload.js','v237-dashboard-owner-guard.js','v237-home-dashboard-owner.js','v239-dashboard-request-coalescer.js','v244-shopee-trend-owner.js']) {
    body = stripScript(body, file);
  }
  return body
    .replace(/\/dashboard-chart-v18\.js\?v=[^"']+/g, CHART_MARKER)
    .replace(/\/v234-dashboard-live\.js\?v=[^"']+/g, LIVE_MARKER)
    .replace(/\/v58-drilldown-runtime\.js\?v=[^"']+/g, DRILLDOWN_MARKER);
}

express.response.send = function v244MetricTruthUiSend(body) {
  if (typeof body === 'string' && body.includes('</body>') && body.includes('CE Express')) {
    body = prepareOwnerHtml(body);
    const headTags=[];
    if (!body.includes(GUARD_MARKER)) headTags.push(`  <script src="${GUARD_MARKER}"></script>`);
    if (!body.includes(COALESCER_MARKER)) headTags.push(`  <script src="${COALESCER_MARKER}"></script>`);
    if(headTags.length) body = body.replace('</head>', `${headTags.join('\n')}\n</head>`);
    const tags = [];
    if (!body.includes(CHART_MARKER)) tags.push(`  <script src="${CHART_MARKER}"></script>`);
    if (!body.includes(LIVE_MARKER)) tags.push(`  <script src="${LIVE_MARKER}"></script>`);
    if (!body.includes(HOME_MARKER)) tags.push(`  <script src="${HOME_MARKER}"></script>`);
    if (!body.includes(V244_SHOPEE_MARKER)) tags.push(`  <script src="${V244_SHOPEE_MARKER}"></script>`);
    if (tags.length) body = body.replace('</body>', `${tags.join('\n')}\n</body>`);
    this.setHeader?.('X-CE-QC-V238-UI', V235_CACHE_READY_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V239-UI', V239_DASHBOARD_REQUEST_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V240-UI', V240_DAILY_RATE_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V244-UI', V244_SHOPEE_TREND_UI_INJECTION_ID);
  }
  return originalSend.call(this, body);
};

console.info('[CE-QC][V240_DASHBOARD_OWNER_UI]', V240_DAILY_RATE_UI_INJECTION_ID, 'single dashboard owner + corrected daily rate contract + current-summary coalescer enabled');
console.info('[CE-QC][V244_SHOPEE_TREND_UI]', V244_SHOPEE_TREND_UI_INJECTION_ID, 'SHOPEECN/SHOPEEVN primary charts = ticket/POD/avg POD days/OC');
