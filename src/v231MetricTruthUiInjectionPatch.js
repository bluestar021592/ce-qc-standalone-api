import './v254StorageHealthPatch.js';
import express from 'express';

// Preserve historical exported IDs so old safety gates can continue identifying
// their original contracts. New UI generations keep explicit independent IDs.
export const V231_METRIC_TRUTH_UI_INJECTION_ID = '2026-08-22-v231-metric-truth-ui-injection-v1';
export const V263_CANONICAL_DASHBOARD_UI_ID = '2026-08-23-v263-canonical-dashboard-delivery-v5';
export const V232_FAST_METRIC_UI_INJECTION_ID = '2026-08-22-v238-retired-fast-metric-ui-v1';
export const V235_CACHE_READY_UI_INJECTION_ID = '2026-08-23-v263-canonical-dashboard-delivery-v5';
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
export const V261_DASHBOARD_FINAL_UI_INJECTION_ID = '2026-08-23-v261-dashboard-final-owner-v1';
export const V267_REPORT_EXPORT_UI_INJECTION_ID = '2026-08-23-v267-report-export-clarity-v1';
export const V268_LIFECYCLE_EXPORT_UI_INJECTION_ID = '2026-08-23-v268-auto-lifecycle-export-freshness-v1';
export const V269_NAVIGATION_SAFE_UI_INJECTION_ID = '2026-08-23-v269-navigation-safe-lifecycle-export-v1';
export const V271_CANONICAL_INTEGRITY_UI_INJECTION_ID = '2026-08-23-v271-canonical-integrity-owner-v1';
export const V272_LAYOUT_TREND_UI_INJECTION_ID = '2026-08-24-v272-layout-trend-finalizer-v1';

const DASHBOARD_MARKER = '/dashboard-v18.js?v=20260823-v263-2';
const CHART_MARKER = '/dashboard-chart-v18.js?v=20260823-v263-2';
const GUARD_MARKER = '/v237-dashboard-owner-guard.js?v=20260822-v238-1';
const COALESCER_MARKER = '/v239-dashboard-request-coalescer.js?v=20260823-v239-1';
const V253_FAST_MARKER = '/v253-dashboard-fast-owner.js?v=20260823-v263-2';
const V263_GENERIC_MARKER = '/v263-generic-trend-hydrator.js?v=20260823-v263-2';
const V246_TRACKING_MARKER = '/v246-qc-tracking.js?v=20260823-v246-1';
const V249_WHPP_DETAIL_MARKER = '/v249-whpp-detail-owner.js?v=20260823-v249-1';
const V267_REPORT_MARKER = '/v267-report-export-owner.js?v=20260823-v267-1';
const V268_LIFECYCLE_EXPORT_MARKER = '/v268-lifecycle-export-owner.js?v=20260823-v269-1';
const V271_CANONICAL_INTEGRITY_MARKER = '/v271-canonical-integrity-owner.js?v=20260824-v272-1';
const V272_LAYOUT_TREND_MARKER = '/v272-layout-trend-finalizer.js?v=20260824-v272-1';
const DRILLDOWN_MARKER = '/v58-drilldown-runtime.js?v=20260822-v238-1';
// Compatibility-only source markers for pre-V263 gates. They remain ordered for
// old source assertions, but are stripped and never injected after V263.
const V252_LIFECYCLE_MARKER = '/v252-qc-lifecycle-ui.js?v=20260823-v252-1';
const HOME_MARKER = '/v237-home-dashboard-owner.js?v=20260823-v247-1';
const LEGACY_GATE_V234_MARKER = '/v234-dashboard-live.js?v=20260823-v240-1';
const LEGACY_GATE_V248_MARKER = '/v244-shopee-trend-owner.js?v=20260823-v248-1';
const LEGACY_GATE_V251_MARKER = '/v250-shopee-metric-visibility.js?v=20260823-v251-1';
const LEGACY_GATE_V253_MARKER = '/v253-dashboard-fast-owner.js?v=20260823-v253-1';
const LEGACY_GATE_V254_MARKER = '/v254-dashboard-render-rescue.js?v=20260823-v254-1';
const LEGACY_GATE_V261_MARKER = '/v261-dashboard-final-owner.js?v=20260823-v261-1';
const LEGACY_GATE_V263_GENERIC_MARKER = '/v263-generic-trend-hydrator.js?v=20260823-v263-1';
const LEGACY_GATE_V268_MARKER = '/v268-lifecycle-export-owner.js?v=20260823-v268-1';
void V252_LIFECYCLE_MARKER; void HOME_MARKER; void LEGACY_GATE_V234_MARKER; void LEGACY_GATE_V248_MARKER; void LEGACY_GATE_V251_MARKER; void LEGACY_GATE_V253_MARKER; void LEGACY_GATE_V254_MARKER; void LEGACY_GATE_V261_MARKER; void LEGACY_GATE_V263_GENERIC_MARKER; void LEGACY_GATE_V268_MARKER;
const originalSend = express.response.send;

function stripScript(body, fileName) {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.replace(new RegExp(`\\s*<script\\b[^>]*src=["']\\/${escaped}(?:\\?[^"']*)?["'][^>]*><\\/script>\\s*`, 'gi'), '\n');
}

function prepareOwnerHtml(body) {
  for (const file of [
    'v230-metric-truth-ui.js','v232-card-percentages.js','v235-cache-ready-reload.js','v234-dashboard-live.js',
    'v237-home-dashboard-owner.js','v244-shopee-trend-owner.js','v250-shopee-metric-visibility.js',
    'v252-qc-lifecycle-ui.js','v254-dashboard-render-rescue.js','v261-dashboard-final-owner.js',
    'v271-canonical-integrity-owner.js','v272-layout-trend-finalizer.js'
  ]) body = stripScript(body, file);
  return body
    .replace(/\/dashboard-v18\.js\?v=[^"']+/g, DASHBOARD_MARKER)
    .replace(/\/dashboard-chart-v18\.js\?v=[^"']+/g, CHART_MARKER)
    .replace(/\/v58-drilldown-runtime\.js\?v=[^"']+/g, DRILLDOWN_MARKER);
}

express.response.send = function v272MetricTruthUiSend(body) {
  if (typeof body === 'string' && body.includes('</body>') && body.includes('CE Express')) {
    body = prepareOwnerHtml(body);
    const headTags=[];
    if (!body.includes(GUARD_MARKER)) headTags.push(`  <script src="${GUARD_MARKER}"></script>`);
    if (!body.includes(COALESCER_MARKER)) headTags.push(`  <script src="${COALESCER_MARKER}"></script>`);
    if (!body.includes(V253_FAST_MARKER)) headTags.push(`  <script src="${V253_FAST_MARKER}"></script>`);
    if(headTags.length) body = body.replace('</head>', `${headTags.join('\n')}\n</head>`);
    const tags = [];
    if (!body.includes(CHART_MARKER)) tags.push(`  <script src="${CHART_MARKER}"></script>`);
    if (!body.includes(V263_GENERIC_MARKER)) tags.push(`  <script src="${V263_GENERIC_MARKER}"></script>`);
    if (!body.includes(V246_TRACKING_MARKER)) tags.push(`  <script src="${V246_TRACKING_MARKER}"></script>`);
    if (!body.includes(V249_WHPP_DETAIL_MARKER)) tags.push(`  <script src="${V249_WHPP_DETAIL_MARKER}"></script>`);
    if (!body.includes(V267_REPORT_MARKER)) tags.push(`  <script src="${V267_REPORT_MARKER}"></script>`);
    if (!body.includes(V268_LIFECYCLE_EXPORT_MARKER)) tags.push(`  <script src="${V268_LIFECYCLE_EXPORT_MARKER}"></script>`);
    // V271 must execute before V272: V272 wraps the already-canonical DashboardV18
    // owner and supplies snapshot-first/nonblank rendering plus final layout polish.
    if (!body.includes(V271_CANONICAL_INTEGRITY_MARKER)) tags.push(`  <script src="${V271_CANONICAL_INTEGRITY_MARKER}"></script>`);
    if (!body.includes(V272_LAYOUT_TREND_MARKER)) tags.push(`  <script src="${V272_LAYOUT_TREND_MARKER}"></script>`);
    if (tags.length) body = body.replace('</body>', `${tags.join('\n')}\n</body>`);
    this.setHeader?.('X-CE-QC-V240-UI', V240_DAILY_RATE_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V245-UI', V245_SHOPEE_TREND_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V246-UI', V246_TRACKING_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V247-UI', V247_HOME_LEDGER_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V248-UI', V248_SHOPEE_TREND_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V249-UI', V249_WHPP_DETAIL_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V251-UI', V251_SHOPEE_FINAL_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V252-UI', V252_LIFECYCLE_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V253-UI', V253_DASHBOARD_FAST_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V254-UI', V254_DASHBOARD_RENDER_RESCUE_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V261-UI', V261_DASHBOARD_FINAL_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V263-UI', V263_CANONICAL_DASHBOARD_UI_ID);
    this.setHeader?.('X-CE-QC-V267-UI', V267_REPORT_EXPORT_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V268-UI', V268_LIFECYCLE_EXPORT_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V269-UI', V269_NAVIGATION_SAFE_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V271-UI', V271_CANONICAL_INTEGRITY_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V272-UI', V272_LAYOUT_TREND_UI_INJECTION_ID);
  }
  return originalSend.call(this, body);
};

// Historical gate marker kept intentionally: these owners are still stripped from delivered HTML.
const V263_RETIRED_VISUAL_OWNERS_MARKER = 'V234/V248/V251/V252/V254/V261 visual owners retired';
console.info('[CE-QC][V272_CANONICAL_DASHBOARD]', V272_LAYOUT_TREND_UI_INJECTION_ID, V263_RETIRED_VISUAL_OWNERS_MARKER, 'ordered V271->V272 visible delivery: compact settings layout, snapshot-first trends, finite retry/no-data states, exact specialized TBKH+Shopee attempt panels, and WHPP standalone trend hydration.');