import express from 'express';
import { inspectV90FastDashboard } from './v90FastDashboardReadPatch.js';
import './v213FastBootstrapRoutePatch.js';
import './v214FastTrendRoutePatch.js';
import './v216WhppImportParityPatch.js';
import './v217CeAuthRetentionPatch.js';
import './v218HistoricalTerminalReconcilePatch.js';
import './v220HistoryRefreshSemanticsPatch.js';
import './v224ShopeePending1203EvidencePatch.js';
import './v221HistoricalFullRangeRefreshPatch.js';
import './v227MultiBusinessHistoryRefreshPatch.js';

export const V94_UNIFIED_IMPORT_DISPLAY_TRUTH_ID = '2026-08-13-v94-unified-import-display-truth-v1';
const ROUTE = '/api/import/unified-daily-report';

function reconcilePayload(payload = {}) {
  if (!payload || payload.ok === false || !payload.reportDate) return payload;
  const canonical = inspectV90FastDashboard(payload.reportDate);
  if (!canonical?.counts || canonical.reportDate !== payload.reportDate) return payload;
  return {
    ...payload,
    classificationCounts: { ...(payload.classificationCounts || {}), ...canonical.counts },
    canonicalClassificationCounts: canonical.counts,
    canonicalClassificationTotal: Number(canonical.total || 0),
    displayClassificationSource: 'V94_CANONICAL_POST_CLASSIFICATION',
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

// This changes only the API response used by the import screen. The imported
// snapshot and normalized source rows remain immutable/auditable. The response
// immediately shows the same CEAF/WHPP classification that the home/business
// dashboards use, eliminating the CEAF=0 vs CEAF=80 split-brain display.
const previousPost = express.application.post;
express.application.post = function v94UnifiedImportDisplayTruthPost(pathValue, ...handlers) {
  if (String(pathValue || '') === ROUTE) {
    return previousPost.call(this, pathValue, displayTruthMiddleware, ...handlers);
  }
  return previousPost.call(this, pathValue, ...handlers);
};
