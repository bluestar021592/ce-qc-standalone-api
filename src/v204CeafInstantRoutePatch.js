import express from 'express';
import { inspectV203CeafFastState } from './v203CeafFastBusinessStatePatch.js';

const PATCH_ID = '2026-08-21-v204-ceaf-dedicated-instant-route-v1';
const ROUTE = '/api/v204/ceaf-fast-state';
const originalListen = express.application.listen;
let installed = false;

function handler(req, res) {
  const started = Date.now();
  try {
    const state = inspectV203CeafFastState(req);
    if (!state) {
      return res.status(404).json({ ok:false, code:'CEAF_SNAPSHOT_NOT_FOUND', error:'当前没有可用的CEAF日报快照', patchId:PATCH_ID });
    }
    res.setHeader('Cache-Control', 'private, max-age=10');
    res.setHeader('Server-Timing', `v204;dur=${Date.now()-started}`);
    return res.json({
      ok:true,
      patchId:PATCH_ID,
      businessType:'CEAF',
      reportDate:state.reportDate,
      snapshotId:state.snapshotId,
      snapshotStatus:state.snapshotStatus,
      state
    });
  } catch (error) {
    return res.status(500).json({ ok:false, code:'CEAF_INSTANT_ROUTE_FAILED', error:error?.message || String(error), patchId:PATCH_ID });
  }
}

express.application.listen = function v204CeafInstantListen(...args) {
  if (!installed) {
    installed = true;
    this.get(ROUTE, handler);
  }
  return originalListen.apply(this, args);
};

export const V204_CEAF_INSTANT_ROUTE_PATCH_ID = PATCH_ID;
