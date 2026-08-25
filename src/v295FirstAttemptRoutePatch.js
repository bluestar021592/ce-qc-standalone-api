import express from 'express';
import { readV295FirstAttemptTrends, V295_FIRST_ATTEMPT_TRUTH_ID } from './v295FirstAttemptTruth.js';
import { V295_FIRST_ATTEMPT_METRIC_ID } from './v295FirstAttemptMetric.js';

export const V295_FIRST_ATTEMPT_ROUTE_ID = '2026-08-25-v295-first-attempt-api-overlay-v1';
const TARGETS = new Set(['/api/v253/trends','/api/v263/delivery-trends']);
const previousGet = express.application.get;

function dateKey(value=''){return String(value||'').slice(0,10);}
function overlayPayload(req,payload={}){
  if (!payload || payload.ok === false) return payload;
  const type = String(req.query?.businessType || payload.businessType || 'ALL').toUpperCase();
  const from = dateKey(req.query?.from || payload.fromDate || payload.requestedFromDate || req.query?.to);
  const to = dateKey(req.query?.to || payload.toDate || payload.requestedToDate || from);
  if (!from || !to) return payload;
  const truth = readV295FirstAttemptTrends(type, from, to);
  const byDate = new Map((truth.daily || []).map(row => [String(row.reportDate || ''), row]));
  const daily = Array.isArray(payload.daily) ? payload.daily.map(row => {
    const fact = byDate.get(String(row?.reportDate || ''));
    if (!fact) return row;
    const sourceReady = row?.ready !== false && row?.ledgerReady !== false;
    return {
      ...row,
      firstAttemptEligible: fact.firstAttemptEligible,
      firstAttemptDenominator: fact.firstAttemptEligible,
      firstAttemptSuccess: fact.firstAttemptSuccess,
      firstAttemptCount: fact.firstAttemptSuccess,
      firstAttemptUnknownPod: fact.firstAttemptUnknownPod,
      firstAttemptEvidenceComplete: sourceReady && fact.firstAttemptEvidenceComplete,
      firstAttemptRate: sourceReady && fact.firstAttemptEvidenceComplete ? fact.firstAttemptRate : null,
      firstAttemptTruthId: V295_FIRST_ATTEMPT_TRUTH_ID,
      firstAttemptMetricId: V295_FIRST_ATTEMPT_METRIC_ID
    };
  }) : [];
  const summary = truth.firstAttemptSummary || {};
  return {
    ...payload,
    daily,
    firstAttemptEligible: daily.map(row => row.firstAttemptEligible ?? null),
    firstAttemptSuccess: daily.map(row => row.firstAttemptSuccess ?? null),
    firstAttemptRate: daily.map(row => row.firstAttemptRate ?? null),
    firstAttemptEvidenceComplete: daily.map(row => row.firstAttemptEvidenceComplete === true),
    firstAttemptSummary: summary,
    firstAttemptDefinition: truth.definition,
    firstAttemptTruthId: V295_FIRST_ATTEMPT_TRUTH_ID,
    firstAttemptMetricId: V295_FIRST_ATTEMPT_METRIC_ID
  };
}
function responseHook(req,res,next){
  const originalJson = res.json.bind(res);
  res.json = function v295FirstAttemptJson(payload){
    try {
      const next = overlayPayload(req,payload);
      res.setHeader?.('X-CE-QC-V295-First-Attempt',V295_FIRST_ATTEMPT_ROUTE_ID);
      return originalJson(next);
    } catch (error) {
      console.warn('[CE-QC][V295_FIRST_ATTEMPT_ROUTE] overlay failed:',error?.message||error);
      return originalJson({ ...payload, firstAttemptRate: Array.isArray(payload?.dates) ? payload.dates.map(()=>null) : payload?.firstAttemptRate, firstAttemptSummary: payload?.firstAttemptSummary || null, firstAttemptOverlayError: error?.message || String(error) });
    }
  };
  next();
}
express.application.get = function v295FirstAttemptRouteRegistration(pathValue,...handlers){
  const path = String(pathValue || '');
  if (TARGETS.has(path) && handlers.length) return previousGet.call(this,pathValue,responseHook,...handlers);
  return previousGet.call(this,pathValue,...handlers);
};

console.info('[CE-QC][V295_FIRST_ATTEMPT_ROUTE]',V295_FIRST_ATTEMPT_ROUTE_ID,'V253/V263 trend responses publish real first-attempt success separately from same-day POD.');
