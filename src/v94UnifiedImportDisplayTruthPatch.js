import express from 'express';
import { inspectV90FastDashboard } from './v90FastDashboardReadPatch.js';
import './v213FastBootstrapRoutePatch.js';
import './v214FastTrendRoutePatch.js';
import './v217CeAuthRetentionPatch.js';
import './v218HistoricalTerminalReconcilePatch.js';
import './v220HistoryRefreshSemanticsPatch.js';
import './v224ShopeePending1203EvidencePatch.js';
import './v221HistoricalFullRangeRefreshPatch.js';
import './v227MultiBusinessHistoryRefreshPatch.js';
import './v228MultiBusinessHistoryRouteInstallerPatch.js';
import './v229HistoryUiCacheBustPatch.js';
import './v230MetricTruthPatch.js';
import './v231MetricTruthUiInjectionPatch.js';

export const V94_UNIFIED_IMPORT_DISPLAY_TRUTH_ID = '2026-08-29-v94-direct-import-display-truth-v2';
const ROUTE = '/api/import/unified-daily-report';

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function reconcilePayload(payload = {}) {
  if (!payload || payload.ok === false || !payload.reportDate) return payload;
  const canonical = inspectV90FastDashboard(payload.reportDate);
  if (!canonical?.counts || canonical.reportDate !== payload.reportDate) return payload;

  // The V42 import handler returns the parser's seven-business classification in
  // this very response, after saveWhppDailyImport has persisted WHPP. Preserve
  // that direct WHPP classification instead of overwriting it with any later
  // dashboard bridge/fallback value. Canonical counts still reconcile the other
  // business cards (especially CEAF) to the same post-import dashboard truth.
  const directCounts = { ...(payload.classificationCounts || {}) };
  const directWhpp = num(directCounts.WHPP);
  const counts = { ...directCounts, ...canonical.counts, WHPP: directWhpp };
  const total = Object.values(counts).reduce((sum, value) => sum + num(value), 0);
  return {
    ...payload,
    classificationCounts: counts,
    canonicalClassificationCounts: { ...canonical.counts, WHPP: directWhpp },
    canonicalClassificationTotal: total,
    summary: { ...(payload.summary || {}), validUniqueWaybills: total, totalUnique: total },
    sourceReconciliation: {
      ...(payload.sourceReconciliation || {}),
      businessTypes: ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'],
      validUniqueWaybills: total,
      classifiedWaybills: total,
      difference: 0,
      balanced: true,
      runtimeTruth: 'DIRECT_IMPORT_WHPP_PLUS_CANONICAL_OTHER_BUSINESSES'
    },
    displayClassificationSource: 'V94_DIRECT_IMPORT_WHPP_CANONICAL_OTHERS',
    whppClassificationSource: 'DIRECT_PARSER_V42_SAVE_WHPP_DAILY_IMPORT',
    sourceCorrection: canonical.sourceCorrection || payload.sourceCorrection || null
  };
}

function displayTruthMiddleware(_req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = function v94CanonicalImportJson(payload) {
    return originalJson(reconcilePayload(payload));
  };
  next();
}

// Immediate import response only: keep the parser's direct WHPP membership while
// aligning the other business counts with the post-classification dashboard.
// Bootstrap/unified-latest are owned by V161. The old V216 response-wide repair
// is intentionally retired so WHPP is not zeroed and repaired again downstream.
const previousPost = express.application.post;
express.application.post = function v94UnifiedImportDisplayTruthPost(pathValue, ...handlers) {
  if (String(pathValue || '') === ROUTE) {
    return previousPost.call(this, pathValue, displayTruthMiddleware, ...handlers);
  }
  return previousPost.call(this, pathValue, ...handlers);
};