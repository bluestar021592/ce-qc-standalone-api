import express from 'express';

export const V231_METRIC_TRUTH_UI_INJECTION_ID = '2026-08-22-v231-metric-truth-ui-injection-v1';
export const V232_FAST_METRIC_UI_INJECTION_ID = '2026-08-22-v237-retired-fast-metric-ui-v3';
export const V235_CACHE_READY_UI_INJECTION_ID = '2026-08-22-v237-dashboard-owner-ui-injection-v4';
const CHART_MARKER = '/dashboard-chart-v18.js?v=20260822-v237-2';
const READY_MARKER = '/v235-cache-ready-reload.js?v=20260822-v237-2';
const LIVE_MARKER = '/v234-dashboard-live.js?v=20260822-v237-2';
const GUARD_MARKER = '/v237-dashboard-owner-guard.js?v=20260822-v237-3';
const HOME_MARKER = '/v237-home-dashboard-owner.js?v=20260822-v237-3';
const DRILLDOWN_MARKER = '/v58-drilldown-runtime.js?v=20260822-v237-2';
const originalSend = express.response.send;

function stripScript(body, fileName) {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.replace(new RegExp(`\\s*<script\\b[^>]*src=["']\\/${escaped}(?:\\?[^"']*)?["'][^>]*><\\/script>\\s*`, 'gi'), '\n');
}

function prepareOwnerHtml(body) {
  // These two clients are the duplicate/fake-zero owners seen in the UI. V237
  // replaces them completely; leaving the scripts present lets their observers
  // recreate the removed table and issue old /api/v27/trends reads.
  body = stripScript(body, 'v230-metric-truth-ui.js');
  body = stripScript(body, 'v232-card-percentages.js');

  // The guard must be physically first, before v55/v58/v233 and every legacy
  // observer. Remove any old body copy and re-inject one authoritative head copy.
  body = stripScript(body, 'v237-dashboard-owner-guard.js');
  body = stripScript(body, 'v237-home-dashboard-owner.js');

  return body
    .replace(/\/dashboard-chart-v18\.js\?v=[^"']+/g, CHART_MARKER)
    .replace(/\/v235-cache-ready-reload\.js\?v=[^"']+/g, READY_MARKER)
    .replace(/\/v234-dashboard-live\.js\?v=[^"']+/g, LIVE_MARKER)
    .replace(/\/v58-drilldown-runtime\.js\?v=[^"']+/g, DRILLDOWN_MARKER);
}

express.response.send = function v237MetricTruthUiSend(body) {
  if (typeof body === 'string' && body.includes('</body>') && body.includes('CE Express')) {
    body = prepareOwnerHtml(body);

    if (!body.includes(GUARD_MARKER)) {
      body = body.replace('</head>', `  <script src="${GUARD_MARKER}"></script>\n</head>`);
    }

    const tags = [];
    if (!body.includes(CHART_MARKER)) tags.push(`  <script src="${CHART_MARKER}"></script>`);
    if (!body.includes(LIVE_MARKER)) tags.push(`  <script src="${LIVE_MARKER}"></script>`);
    if (!body.includes(HOME_MARKER)) tags.push(`  <script src="${HOME_MARKER}"></script>`);
    if (!body.includes(READY_MARKER)) tags.push(`  <script src="${READY_MARKER}"></script>`);
    if (tags.length) body = body.replace('</body>', `${tags.join('\n')}\n</body>`);

    this.setHeader?.('X-CE-QC-V237-UI', V235_CACHE_READY_UI_INJECTION_ID);
  }
  return originalSend.call(this, body);
};

console.info('[CE-QC][V237_DASHBOARD_OWNER_UI]', V235_CACHE_READY_UI_INJECTION_ID, 'head-first owner guard + single live trend table + homepage/SHOPEE-region owner enabled; V230/V232 retired');
