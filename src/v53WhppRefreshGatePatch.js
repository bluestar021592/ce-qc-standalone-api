import express from 'express';
import { loadWhppState, saveWhppState } from './whppStore.js';

const PATCH_ID = '2026-08-11-v53-whpp-refresh-gate-v1';

function billOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase();
}

function scanTerminal(row = {}) {
  const status = String(row.orderStatus ?? row.scanOrderStatus ?? '').trim();
  if (status === '85') return 'POD';
  if (status === '100') return 'RETURNED';
  if (status === '10') return 'ORDER_CANCELLED';
  return '';
}

function finalTerminal(row = {}) {
  const state = String(row.currentState || row.state || '').trim().toUpperCase();
  if (state === 'POD') return 'POD';
  if (state === 'RETURNED' || state === 'RETURN_COMPLETED') return 'RETURNED';
  if (state === 'ORDER_CANCELLED') return 'ORDER_CANCELLED';
  if (row.是否POD === '是' || row.POD状态 === 'POD' || Number(row.isPod || 0) === 1) return 'POD';

  const category = String(
    row.specialState || row.primaryCategory || row.主分类 || row.异常分类 || row.matchedRule || ''
  ).trim().toUpperCase();
  if ([
    'CCSLCN_DIVERSION',
    'CCSLZT_DIVERSION',
    'CCSL580_DIVERSION',
    'CCSL580_RETENTION',
    'SELF_PICKUP',
    'NORMAL_FINAL',
    'NORMAL_FINAL_HUB'
  ].includes(category)) return category;
  return '';
}

function terminalBills(state = {}) {
  const closed = new Set();
  for (const row of state.scanResults || []) {
    if (scanTerminal(row)) closed.add(billOf(row));
  }
  for (const row of state.finalRows || []) {
    if (finalTerminal(row)) closed.add(billOf(row));
  }
  closed.delete('');
  return closed;
}

function filterStatuses(rows = [], refreshSet) {
  return (rows || []).filter(row => !refreshSet.has(billOf(row)));
}

function prepareWhppRefreshState() {
  const state = loadWhppState();
  const bills = [...new Set([
    ...(state.pnhBills || []),
    ...(state.carryBills || []),
    ...(state.nextCarryBills || [])
  ].map(value => String(value || '').trim().toUpperCase()).filter(Boolean))];
  const closed = terminalBills(state);
  const refreshBills = bills.filter(bill => !closed.has(bill));
  const refreshSet = new Set(refreshBills);

  if (!refreshBills.length) {
    return { state, total: bills.length, closed: closed.size, refresh: 0 };
  }

  // A previous successful API call only means that the query succeeded at that
  // moment. It must not permanently suppress a later refresh while the parcel is
  // still unresolved. Clear only per-waybill query-status checkpoints for open
  // bills; keep the already collected rows so the next run can safely overwrite
  // them with newer CE facts and still preserve crash/retry safety.
  state.scanQueryStatus = filterStatuses(state.scanQueryStatus, refreshSet);
  state.eventQueryStatus = filterStatuses(state.eventQueryStatus || state.trackQueryStatus, refreshSet);
  state.trackQueryStatus = filterStatuses(state.trackQueryStatus || state.eventQueryStatus, refreshSet);
  state.exceptionQueryStatus = filterStatuses(state.exceptionQueryStatus, refreshSet);
  state.needTrackBills = refreshBills;
  state.processing = {
    ...(state.processing || {}),
    running: false,
    paused: false,
    phase: 'WHPP待刷新终态',
    batchIndex: 0,
    totalBatches: Math.ceil(refreshBills.length / 350)
  };
  state.refreshGate = {
    patchId: PATCH_ID,
    preparedAt: new Date().toISOString(),
    totalBills: bills.length,
    preservedClosedBills: closed.size,
    refreshBills: refreshBills.length
  };
  saveWhppState(state);
  console.log(`[CE-QC][WHPP_REFRESH_GATE] prepared ${refreshBills.length}/${bills.length} unresolved bills for fresh scan/track evidence`);
  return { state, total: bills.length, closed: closed.size, refresh: refreshBills.length };
}

const previousPost = express.application.post;
express.application.post = function v53WhppRefreshPost(pathValue, ...handlers) {
  if ((pathValue === '/api/whpp/run/start' || pathValue === '/api/whpp/run/resume') && handlers.length) {
    const original = handlers.at(-1);
    if (typeof original === 'function' && !original.__v53WhppRefreshWrapped) {
      const wrapped = async function v53WhppRefreshRun(req, res, next) {
        try {
          prepareWhppRefreshState();
        } catch (error) {
          console.error('[CE-QC][WHPP_REFRESH_GATE_PREPARE_FAILED]', error);
          if (!res.headersSent) {
            res.status(500).json({ ok: false, code: 'WHPP_REFRESH_PREPARE_FAILED', error: error.message || String(error) });
            return;
          }
          if (typeof next === 'function') return next(error);
          return;
        }
        return original(req, res, next);
      };
      Object.defineProperty(wrapped, '__v53WhppRefreshWrapped', { value: true });
      return previousPost.call(this, pathValue, ...handlers.slice(0, -1), wrapped);
    }
  }
  return previousPost.call(this, pathValue, ...handlers);
};

export { prepareWhppRefreshState };
export const V53_WHPP_REFRESH_GATE_PATCH_ID = PATCH_ID;
