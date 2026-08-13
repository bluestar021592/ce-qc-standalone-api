import express from 'express';
import { startCarryoverRefreshScheduler } from './carryoverRefreshScheduler.js';

export const V98_CARRY_REFRESH_ENDPOINT_ID = '2026-08-14-v98-backend-owned-open-carry-refresh-v4';

// No HTTP bypass route exists. The refresh scheduler lives inside the same Node
// backend that owns port 5177, so it inherits the backend lifecycle and stops
// automatically whenever the managed desktop console closes.
let installed = false;
const previousListen = express.application.listen;
express.application.listen = function v98CarryRefreshListen(...args) {
  if (!installed) {
    installed = true;
    startCarryoverRefreshScheduler();
  }
  return previousListen.apply(this, args);
};
