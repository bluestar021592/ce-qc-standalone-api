import express from 'express';
import './v165WhppRunStateRecoveryPatch.js';
import './v143WhppRetryQueuePatch.js';
import { loadWhppState, saveWhppState } from './whppStore.js';

const PATCH_ID = '2026-08-17-v141-whpp-daily-retry-isolation-v2+v165-run-state-recovery+v143-independent-retry-queue';
const RUN_ROUTES = new Set(['/api/whpp/run/start', '/api/whpp/run/resume']);
const WRAPPED = Symbol.for('ce-qc.v141-whpp-daily-retry-isolation');

function cleanCodes(values = []) {
  return [...new Set((values || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean))];
}

function statusMap(rows = []) {
  return new Map((rows || []).map(row => [String(row?.shipmentCode || row?.运单号 || '').trim().toUpperCase(), String(row?.status || '').toLowerCase()]).filter(([bill]) => bill));
}

function retrySnapshot(state = {}) {
  const today = cleanCodes(state.pnhBills || []);
  const todaySet = new Set(today);
  const scan = statusMap(state.scanQueryStatus || []);
  const events = statusMap(state.eventQueryStatus || []);
  const exceptions = statusMap(state.exceptionQueryStatus || []);
  const scanPending = today.filter(bill => scan.get(bill) !== 'success');
  const needTrack = cleanCodes(state.needTrackBills || []).filter(bill => todaySet.has(bill));
  const eventPending = needTrack.filter(bill => events.get(bill) !== 'success');
  const exceptionPending = needTrack.filter(bill => exceptions.get(bill) !== 'success');
  const pending = new Set([...scanPending, ...eventPending, ...exceptionPending]);
  return {
    today: today.length,
    retryPending: pending.size,
    scanPending: scanPending.length,
    eventPending: eventPending.length,
    exceptionPending: exceptionPending.length
  };
}

function isolateWhppDailyCarry(req, res, next) {
  try {
    const state = loadWhppState();
    const today = new Set(cleanCodes(state.pnhBills || []));
    const oldCarry = cleanCodes(state.carryBills || []);
    const oldNextCarry = cleanCodes(state.nextCarryBills || []);
    const historicalDetached = oldCarry.filter(bill => !today.has(bill));
    const retry = retrySnapshot(state);

    // Daily WHPP automatic processing is strictly limited to today's imported
    // membership. Historical carry remains in carryover_open_items for the manual
    // carry window; no carry rows or business evidence are deleted here.
    state.carryBills = [];
    state.nextCarryBills = [];
    state.v141DailyIsolation = {
      patchId: PATCH_ID,
      reportDate: state.reportDate || '',
      historicalDetached: historicalDetached.length,
      previousCarryCount: oldCarry.length,
      previousNextCarryCount: oldNextCarry.length,
      retryPendingBefore: retry.retryPending,
      isolatedAt: new Date().toISOString()
    };
    saveWhppState(state);
    req.ceQcV141WhppDailyIsolation = state.v141DailyIsolation;
    next();
  } catch (error) {
    res.status(409).json({
      ok: false,
      code: 'WHPP_DAILY_ISOLATION_FAILED',
      error: `WHPP当日队列隔离失败，已阻止继续处理以避免重新扫描历史跨日：${error?.message || String(error)}`
    });
  }
}

const previousPost = express.application.post;
if (typeof previousPost === 'function' && !previousPost[WRAPPED]) {
  const wrappedPost = function v141WhppDailyRetryIsolationPost(pathValue, ...handlers) {
    const route = String(pathValue || '');
    if (!RUN_ROUTES.has(route)) return previousPost.call(this, pathValue, ...handlers);
    return previousPost.call(this, pathValue, isolateWhppDailyCarry, ...handlers);
  };
  Object.defineProperty(wrappedPost, WRAPPED, { value: true });
  express.application.post = wrappedPost;
}

export { retrySnapshot as summarizeV141WhppRetry };
export const V141_WHPP_DAILY_RETRY_ISOLATION_ID = PATCH_ID;
