import express from 'express';

export const V231_METRIC_TRUTH_UI_INJECTION_ID = '2026-08-22-v231-metric-truth-ui-injection-v1';
const MARKER = '/v230-metric-truth-ui.js?v=20260822-v230-1';
const originalSend = express.response.send;

express.response.send = function v231MetricTruthUiSend(body) {
  if (typeof body === 'string' && body.includes('</body>') && body.includes('CE Express') && !body.includes(MARKER)) {
    body = body.replace('</body>', `  <script src="${MARKER}"></script>\n</body>`);
    this.setHeader?.('X-CE-QC-V231-UI', V231_METRIC_TRUTH_UI_INJECTION_ID);
  }
  return originalSend.call(this, body);
};

console.info('[CE-QC][V231_METRIC_TRUTH_UI]', V231_METRIC_TRUTH_UI_INJECTION_ID, 'V230 daily truth panel injection enabled');
