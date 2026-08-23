import './v254StorageHealthPatch.js';
import express from 'express';

export const V231_METRIC_TRUTH_UI_INJECTION_ID = '2026-08-22-v231-metric-truth-ui-injection-v1';
export const V232_FAST_METRIC_UI_INJECTION_ID = '2026-08-22-v238-retired-fast-metric-ui-v1';
export const V235_CACHE_READY_UI_INJECTION_ID = '2026-08-22-v238-dashboard-owner-ui-injection-v1';
export const V239_DASHBOARD_REQUEST_UI_INJECTION_ID = '2026-08-23-v239-dashboard-request-coalescer-ui-v1';
export const V240_DAILY_RATE_UI_INJECTION_ID = '2026-08-23-v240-daily-rate-ui-injection-v1';
export const V244_SHOPEE_TREND_UI_INJECTION_ID = '2026-08-23-v248-shopee-spa-operational-ui-v1';
export const V245_SHOPEE_TREND_UI_INJECTION_ID = V244_SHOPEE_TREND_UI_INJECTION_ID;
export const V248_SHOPEE_TREND_UI_INJECTION_ID = V244_SHOPEE_TREND_UI_INJECTION_ID;
export const V246_TRACKING_UI_INJECTION_ID = '2026-08-23-v246-qc-tracking-ui-v1';
export const V247_HOME_LEDGER_UI_INJECTION_ID = '2026-08-23-v247-home-ledger-truth-ui-v1';
export const V249_WHPP_DETAIL_UI_INJECTION_ID = '2026-08-23-v249-whpp-exact-drilldown-ui-v1';
export const V250_SHOPEE_METRIC_VISIBILITY_UI_INJECTION_ID = '2026-08-23-v251-shopee-final-render-ui-v1';
export const V251_SHOPEE_FINAL_UI_INJECTION_ID = V250_SHOPEE_METRIC_VISIBILITY_UI_INJECTION_ID;
export const V252_LIFECYCLE_UI_INJECTION_ID = '2026-08-23-v252-qc-lifecycle-ui-v1';
export const V253_DASHBOARD_FAST_UI_INJECTION_ID = '2026-08-23-v253-final-fast-dashboard-owner-v1';
export const V254_DASHBOARD_RENDER_RESCUE_UI_INJECTION_ID = '2026-08-23-v254-dashboard-render-rescue-ui-v1';
export const V261_DASHBOARD_FINAL_OWNER_UI_INJECTION_ID = '2026-08-23-v261-dashboard-final-owner-v1';
const CHART_MARKER = '/dashboard-chart-v18.js?v=20260822-v238-1';
const LIVE_MARKER = '/v234-dashboard-live.js?v=20260823-v240-1';
const GUARD_MARKER = '/v237-dashboard-owner-guard.js?v=20260822-v238-1';
const COALESCER_MARKER = '/v239-dashboard-request-coalescer.js?v=20260823-v239-1';
const V253_FAST_MARKER = '/v253-dashboard-fast-owner.js?v=20260823-v253-1';
const V252_LIFECYCLE_MARKER = '/v252-qc-lifecycle-ui.js?v=20260823-v252-1';
const HOME_MARKER = '/v237-home-dashboard-owner.js?v=20260823-v247-1';
const V248_SHOPEE_MARKER = '/v244-shopee-trend-owner.js?v=20260823-v248-1';
const V246_TRACKING_MARKER = '/v246-qc-tracking.js?v=20260823-v246-1';
const V249_WHPP_DETAIL_MARKER = '/v249-whpp-detail-owner.js?v=20260823-v249-1';
const V251_SHOPEE_FINAL_MARKER = '/v250-shopee-metric-visibility.js?v=20260823-v251-1';
const V254_RENDER_MARKER = '/v254-dashboard-render-rescue.js?v=20260823-v254-1';
const V261_FINAL_OWNER_MARKER = '/v261-dashboard-final-owner.js?v=20260823-v261-1';
const DRILLDOWN_MARKER = '/v58-drilldown-runtime.js?v=20260822-v238-1';
const originalSend = express.response.send;

function stripScript(body, fileName) {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.replace(new RegExp(`\\s*<script\\b[^>]*src=["']\\/${escaped}(?:\\?[^"']*)?["'][^>]*><\\/script>\\s*`, 'gi'), '\n');
}

function prepareOwnerHtml(body) {
  for (const file of ['v230-metric-truth-ui.js','v232-card-percentages.js','v235-cache-ready-reload.js','v237-dashboard-owner-guard.js','v237-home-dashboard-owner.js','v239-dashboard-request-coalescer.js','v244-shopee-trend-owner.js','v246-qc-tracking.js','v249-whpp-detail-owner.js','v250-shopee-metric-visibility.js','v252-qc-lifecycle-ui.js','v253-dashboard-fast-owner.js','v254-dashboard-render-rescue.js','v261-dashboard-final-owner.js']) {
    body = stripScript(body, file);
  }
  return body
    .replace(/\/dashboard-chart-v18\.js\?v=[^"']+/g, CHART_MARKER)
    .replace(/\/v234-dashboard-live\.js\?v=[^"']+/g, LIVE_MARKER)
    .replace(/\/v58-drilldown-runtime\.js\?v=[^"']+/g, DRILLDOWN_MARKER);
}

express.response.send = function v261MetricTruthUiSend(body) {
  if (typeof body === 'string' && body.includes('</body>') && body.includes('CE Express')) {
    body = prepareOwnerHtml(body);
    const headTags=[];
    if (!body.includes(GUARD_MARKER)) headTags.push(`  <script src="${GUARD_MARKER}"></script>`);
    if (!body.includes(COALESCER_MARKER)) headTags.push(`  <script src="${COALESCER_MARKER}"></script>`);
    if (!body.includes(V253_FAST_MARKER)) headTags.push(`  <script src="${V253_FAST_MARKER}"></script>`);
    if(headTags.length) body = body.replace('</head>', `${headTags.join('\n')}\n</head>`);
    const tags = [];
    if (!body.includes(CHART_MARKER)) tags.push(`  <script src="${CHART_MARKER}"></script>`);
    if (!body.includes(LIVE_MARKER)) tags.push(`  <script src="${LIVE_MARKER}"></script>`);
    if (!body.includes(V252_LIFECYCLE_MARKER)) tags.push(`  <script src="${V252_LIFECYCLE_MARKER}"></script>`);
    if (!body.includes(HOME_MARKER)) tags.push(`  <script src="${HOME_MARKER}"></script>`);
    if (!body.includes(V248_SHOPEE_MARKER)) tags.push(`  <script src="${V248_SHOPEE_MARKER}"></script>`);
    if (!body.includes(V246_TRACKING_MARKER)) tags.push(`  <script src="${V246_TRACKING_MARKER}"></script>`);
    if (!body.includes(V249_WHPP_DETAIL_MARKER)) tags.push(`  <script src="${V249_WHPP_DETAIL_MARKER}"></script>`);
    if (!body.includes(V251_SHOPEE_FINAL_MARKER)) tags.push(`  <script src="${V251_SHOPEE_FINAL_MARKER}"></script>`);
    if (!body.includes(V254_RENDER_MARKER)) tags.push(`  <script src="${V254_RENDER_MARKER}"></script>`);
    // V261 is the one final visible-page owner. It runs after every legacy/rescue
    // dashboard client and resolves SPA pages from the active navigation state.
    if (!body.includes(V261_FINAL_OWNER_MARKER)) tags.push(`  <script src="${V261_FINAL_OWNER_MARKER}"></script>`);
    if (tags.length) body = body.replace('</body>', `${tags.join('\n')}\n</body>`);
    this.setHeader?.('X-CE-QC-V238-UI', V235_CACHE_READY_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V239-UI', V239_DASHBOARD_REQUEST_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V240-UI', V240_DAILY_RATE_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V245-UI', V245_SHOPEE_TREND_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V246-UI', V246_TRACKING_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V247-UI', V247_HOME_LEDGER_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V248-UI', V248_SHOPEE_TREND_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V249-UI', V249_WHPP_DETAIL_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V250-UI', V250_SHOPEE_METRIC_VISIBILITY_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V251-UI', V251_SHOPEE_FINAL_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V252-UI', V252_LIFECYCLE_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V253-UI', V253_DASHBOARD_FAST_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V254-UI', V254_DASHBOARD_RENDER_RESCUE_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V261-UI', V261_DASHBOARD_FINAL_OWNER_UI_INJECTION_ID);
  }
  return originalSend.call(this, body);
};

console.info('[CE-QC][V240_DASHBOARD_OWNER_UI]', V240_DAILY_RATE_UI_INJECTION_ID, 'single dashboard owner + corrected daily rate contract + current-summary coalescer enabled');
console.info('[CE-QC][V246_TRACKING_UI]', V246_TRACKING_UI_INJECTION_ID, 'Shopee locked first-report signing days + real attempt evidence + global QC anti-leak reconciliation panel enabled');
console.info('[CE-QC][V247_HOME_LEDGER_UI]', V247_HOME_LEDGER_UI_INJECTION_ID, 'home uses V246 locked Shopee ledger for attempt trend and region distribution; duplicate first-day assessment removed');
console.info('[CE-QC][V248_SHOPEE_TREND_UI]', V248_SHOPEE_TREND_UI_INJECTION_ID, 'SHOPEECN/VN SPA navigation now activates operational trends and strict attempt evidence');
console.info('[CE-QC][V249_WHPP_DETAIL_UI]', V249_WHPP_DETAIL_UI_INJECTION_ID, 'WHPP canonical-page handoff and exact V172 drilldown owner delivered last');
console.info('[CE-QC][V251_SHOPEE_FINAL_OWNER]', V251_SHOPEE_FINAL_UI_INJECTION_ID, 'final Shopee owner wraps canonical renderAll/renderShopeePage and keeps V246 attempt/signing truth visible after every legacy rerender');
console.info('[CE-QC][V252_LIFECYCLE_UI]', V252_LIFECYCLE_UI_INJECTION_ID, 'Shopee UI uses fast lifecycle-only reads; home replaces cramped dual attempt charts with one QC summary and exact-date PP/PV reads');
console.info('[CE-QC][V253_DASHBOARD_FAST_OWNER]', V253_DASHBOARD_FAST_UI_INJECTION_ID, 'head-level fast read redirect + cache-independent seven-day trends + compact stale-while-revalidate render ownership enabled');
console.info('[CE-QC][V254_RENDER_RESCUE_UI]', V254_DASHBOARD_RENDER_RESCUE_UI_INJECTION_ID, 'legacy rescue renderer remains available before V261 final ownership');
console.info('[CE-QC][V261_FINAL_OWNER_UI]', V261_DASHBOARD_FINAL_OWNER_UI_INJECTION_ID, 'visible-page final owner removes duplicate loading layouts and renders one authoritative trend surface');
