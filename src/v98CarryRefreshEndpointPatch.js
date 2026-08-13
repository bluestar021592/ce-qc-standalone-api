import express from 'express';
import { getDb } from './db.js';
import { dueCarryRefreshReason, hasActiveBusinessProcessing, refreshOpenCarryNow } from './carryoverRefreshScheduler.js';

export const V98_CARRY_REFRESH_ENDPOINT_ID = '2026-08-14-v98-loopback-only-open-carry-refresh-v2';
const STATUS_ROUTE = '/_ce_qc_internal/v98/carry-refresh/status';
const REFRESH_ROUTE = '/_ce_qc_internal/v98/carry-refresh';

function normalizeHost(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split(':')[0];
}
function normalizeIp(value = '') { return String(value || '').replace(/^::ffff:/, ''); }
function isLoopbackRequest(req) {
  const host = normalizeHost(req.hostname || req.get?.('host'));
  const remote = normalizeIp(req.socket?.remoteAddress);
  return ['localhost','127.0.0.1','::1'].includes(host) && ['127.0.0.1','::1'].includes(remote);
}
function internalPath(pathname = '') { return pathname === STATUS_ROUTE || pathname === REFRESH_ROUTE; }
function rejectNonLoopback(res) { return res.status(403).json({ ok:false, code:'LOCAL_INTERNAL_ONLY', error:'Local internal endpoint only.' }); }

// server.js installs accessIdentity globally before all routes. The managed desktop
// poller has no browser session cookie, so wrap only that middleware registration:
// these two exact routes may pass without a user session only when BOTH Host and
// socket peer are loopback. Every ordinary UI/API request keeps the original auth.
const previousUse = express.application.use;
let accessBridgeInstalled = false;
express.application.use = function v98LocalInternalAccessUse(...args) {
  const mapped = args.map(value => {
    if (accessBridgeInstalled || typeof value !== 'function' || value.name !== 'accessIdentity') return value;
    accessBridgeInstalled = true;
    return function v98LoopbackInternalIdentity(req, res, next) {
      if (!internalPath(req.path)) return value(req, res, next);
      if (!isLoopbackRequest(req)) return rejectNonLoopback(res);
      req.accessMode = 'LOCAL_INTERNAL';
      req.user = { id:0, username:'ce-qc-local-scheduler', role:'SYSTEM', businessScope:'ALL', devMode:true };
      return next();
    };
  });
  return previousUse.apply(this, mapped);
};

let installed = false;
const previousListen = express.application.listen;
express.application.listen = function v98CarryRefreshListen(...args) {
  if (!installed) {
    installed = true;
    this.get(STATUS_ROUTE, (req, res) => {
      if (!isLoopbackRequest(req)) return rejectNonLoopback(res);
      try {
        const db = getDb();
        const dueReason = dueCarryRefreshReason(db, new Date());
        const openCount = Number(db.prepare("SELECT COUNT(*) count FROM carryover_open_items WHERE status='OPEN'").get()?.count || 0);
        res.setHeader('Cache-Control', 'no-store');
        res.json({
          ok: true,
          patchId: V98_CARRY_REFRESH_ENDPOINT_ID,
          due: Boolean(dueReason),
          dueReason,
          foregroundProcessing: hasActiveBusinessProcessing(db),
          openCount
        });
      } catch (error) {
        res.status(500).json({ ok: false, patchId: V98_CARRY_REFRESH_ENDPOINT_ID, error: error.message || String(error) });
      }
    });

    this.post(REFRESH_ROUTE, async (req, res) => {
      if (!isLoopbackRequest(req)) return rejectNonLoopback(res);
      try {
        const db = getDb();
        const dueReason = dueCarryRefreshReason(db, new Date());
        if (!dueReason) return res.json({ ok: true, skipped: true, reason: 'NOT_DUE' });
        if (hasActiveBusinessProcessing(db)) return res.json({ ok: true, skipped: true, reason: 'FOREGROUND_PROCESSING_ACTIVE' });
        const result = await refreshOpenCarryNow({ reason: dueReason, db });
        res.setHeader('Cache-Control', 'no-store');
        res.json({ ok: true, patchId: V98_CARRY_REFRESH_ENDPOINT_ID, ...result });
      } catch (error) {
        console.error('[CE-QC][V98_CARRY_REFRESH]', error?.message || error);
        res.status(503).json({ ok: false, patchId: V98_CARRY_REFRESH_ENDPOINT_ID, error: error.message || String(error) });
      }
    });
  }
  return previousListen.apply(this, args);
};
