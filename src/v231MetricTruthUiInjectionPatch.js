import express from 'express';

export const V231_METRIC_TRUTH_UI_INJECTION_ID = '2026-08-22-v231-metric-truth-ui-injection-v1';
export const V232_FAST_METRIC_UI_INJECTION_ID = '2026-08-22-v237-retired-fast-metric-ui-v2';
export const V235_CACHE_READY_UI_INJECTION_ID = '2026-08-22-v237-dashboard-owner-ui-injection-v2';
const UI_MARKER = '/v230-metric-truth-ui.js?v=20260822-v237-1';
const CHART_MARKER = '/dashboard-chart-v18.js?v=20260822-v237-1';
const CARD_MARKER = '/v232-card-percentages.js?v=20260822-v237-1';
const READY_MARKER = '/v235-cache-ready-reload.js?v=20260822-v237-1';
const LIVE_MARKER = '/v234-dashboard-live.js?v=20260822-v237-1';
const GUARD_MARKER = '/v237-dashboard-owner-guard.js?v=20260822-v237-1';
const DRILLDOWN_MARKER = '/v58-drilldown-runtime.js?v=20260822-v237-1';
const originalSend = express.response.send;

function replaceOldUiMarkers(body) {
  return body
    .replace(/\/v230-metric-truth-ui\.js\?v=[^"']+/g, UI_MARKER)
    .replace(/\/dashboard-chart-v18\.js\?v=[^"']+/g, CHART_MARKER)
    .replace(/\/v232-card-percentages\.js\?v=[^"']+/g, CARD_MARKER)
    .replace(/\/v235-cache-ready-reload\.js\?v=[^"']+/g, READY_MARKER)
    .replace(/\/v234-dashboard-live\.js\?v=[^"']+/g, LIVE_MARKER)
    .replace(/\/v58-drilldown-runtime\.js\?v=[^"']+/g, DRILLDOWN_MARKER)
    .replace(/\/v237-dashboard-owner-guard\.js\?v=[^"']+/g, GUARD_MARKER);
}

express.response.send = function v237MetricTruthUiSend(body) {
  if (typeof body === 'string' && body.includes('</body>') && body.includes('CE Express')) {
    body = replaceOldUiMarkers(body);
    const tags = [];
    if (!body.includes(CHART_MARKER)) tags.push(`  <script src="${CHART_MARKER}"></script>`);
    if (!body.includes(CARD_MARKER)) tags.push(`  <script src="${CARD_MARKER}"></script>`);
    if (!body.includes(UI_MARKER)) tags.push(`  <script src="${UI_MARKER}"></script>`);
    if (!body.includes(READY_MARKER)) tags.push(`  <script src="${READY_MARKER}"></script>`);
    if (!body.includes(LIVE_MARKER)) tags.push(`  <script src="${LIVE_MARKER}"></script>`);
    if (!body.includes(GUARD_MARKER)) tags.push(`  <script src="${GUARD_MARKER}"></script>`);
    if (tags.length) body = body.replace('</body>', `${tags.join('\n')}\n</body>`);
    this.setHeader?.('X-CE-QC-V237-UI', V235_CACHE_READY_UI_INJECTION_ID);
  }
  return originalSend.call(this, body);
};

console.info('[CE-QC][V237_DASHBOARD_OWNER_UI]', V235_CACHE_READY_UI_INJECTION_ID, 'single live dashboard owner + cache-busted clients + legacy read guard enabled');
