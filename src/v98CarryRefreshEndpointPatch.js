import express from 'express';
import { getDb } from './db.js';
import { dueCarryRefreshReason, hasActiveBusinessProcessing, refreshOpenCarryNow } from './carryoverRefreshScheduler.js';

export const V98_CARRY_REFRESH_ENDPOINT_ID = '2026-08-14-v98-due-only-open-carry-refresh';

let installed = false;
const previousListen = express.application.listen;
express.application.listen = function v98CarryRefreshListen(...args) {
  if (!installed) {
    installed = true;
    this.get('/api/v98/carry-refresh/status', (req, res) => {
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

    this.post('/api/v98/carry-refresh', async (req, res) => {
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
