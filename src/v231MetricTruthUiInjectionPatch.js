import express from 'express';

export const V231_METRIC_TRUTH_UI_INJECTION_ID = '2026-08-22-v231-metric-truth-ui-injection-v1';
export const V232_FAST_METRIC_UI_INJECTION_ID = '2026-08-22-v232-fast-metric-ui-injection-v1';
const UI_MARKER = '/v230-metric-truth-ui.js?v=20260822-v232-1';
const CHART_MARKER = '/dashboard-chart-v18.js?v=20260822-v232-1';
const CARD_MARKER = '/v232-card-percentages.js?v=20260822-v232-1';
const originalSend = express.response.send;

function replaceOldUiMarkers(body) {
  return body
    .replace(/\/v230-metric-truth-ui\.js\?v=[^"']+/g, UI_MARKER)
    .replace(/\/dashboard-chart-v18\.js\?v=[^"']+/g, CHART_MARKER)
    .replace(/\/v232-card-percentages\.js\?v=[^"']+/g, CARD_MARKER);
}

express.response.send = function v232MetricTruthUiSend(body) {
  if (typeof body === 'string' && body.includes('</body>') && body.includes('CE Express')) {
    body = replaceOldUiMarkers(body);
    const tags = [];
    if (!body.includes(CHART_MARKER)) tags.push(`  <script src="${CHART_MARKER}"></script>`);
    if (!body.includes(CARD_MARKER)) tags.push(`  <script src="${CARD_MARKER}"></script>`);
    if (!body.includes(UI_MARKER)) tags.push(`  <script src="${UI_MARKER}"></script>`);
    if (tags.length) body = body.replace('</body>', `${tags.join('\n')}\n</body>`);
    this.setHeader?.('X-CE-QC-V232-UI', V232_FAST_METRIC_UI_INJECTION_ID);
  }
  return originalSend.call(this, body);
};

console.info('[CE-QC][V232_FAST_METRIC_UI]', V232_FAST_METRIC_UI_INJECTION_ID, 'fast daily percentage UI + numeric card percentages + chart cache-bust enabled');
