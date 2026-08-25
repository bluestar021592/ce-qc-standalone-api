import express from 'express';
import { startCarryoverRefreshScheduler } from './carryoverRefreshScheduler.js';

export const V294_CARRYOVER_SCHEDULER_ACTIVATION_ID = '2026-08-25-v294-carryover-next-day-scheduler-activation-v1';

let schedulerActivationAttempted = false;
const previousListen = express.application.listen;

express.application.listen = function v294CarryoverSchedulerActivationListen(...args) {
  const server = previousListen.apply(this, args);
  if (!schedulerActivationAttempted) {
    schedulerActivationAttempted = true;
    const timer = setTimeout(() => {
      try {
        const result = startCarryoverRefreshScheduler();
        console.log('[CE-QC][V294_CARRYOVER_SCHEDULER]', JSON.stringify({
          id: V294_CARRYOVER_SCHEDULER_ACTIVATION_ID,
          ...result
        }));
      } catch (error) {
        console.error('[CE-QC][V294_CARRYOVER_SCHEDULER_FAILED]', error?.stack || error?.message || error);
      }
    }, 0);
    timer.unref?.();
  }
  return server;
};

export function inspectV294CarryoverSchedulerActivation() {
  return {
    id: V294_CARRYOVER_SCHEDULER_ACTIVATION_ID,
    activationAttempted: schedulerActivationAttempted
  };
}

console.info('[CE-QC][V294_CARRYOVER_SCHEDULER_ACTIVATION]', V294_CARRYOVER_SCHEDULER_ACTIVATION_ID,
  'formal server listen activates OPEN carry refresh; scheduler itself defers first refresh to protect startup and then runs Cambodia day-rollover + every 2 hours.');
