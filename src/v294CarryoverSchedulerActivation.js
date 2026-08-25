import express from 'express';
import { startCarryoverRefreshScheduler } from './carryoverRefreshScheduler.js';

export const V294_CARRYOVER_SCHEDULER_ACTIVATION_ID = '2026-08-25-v294-carryover-next-day-scheduler-activation-v2';

let schedulerActivationAttempted = false;
let schedulerListeningObserved = false;
const previousListen = express.application.listen;

function activateAfterListening(server) {
  if (!server || schedulerActivationAttempted) return;
  const activate = () => {
    if (schedulerActivationAttempted) return;
    schedulerListeningObserved = true;
    schedulerActivationAttempted = true;
    const timer = setTimeout(() => {
      try {
        const result = startCarryoverRefreshScheduler();
        console.log('[CE-QC][V294_CARRYOVER_SCHEDULER]', JSON.stringify({
          id: V294_CARRYOVER_SCHEDULER_ACTIVATION_ID,
          listeningObserved: true,
          ...result
        }));
      } catch (error) {
        console.error('[CE-QC][V294_CARRYOVER_SCHEDULER_FAILED]', error?.stack || error?.message || error);
      }
    }, 0);
    timer.unref?.();
  };
  if (server.listening) activate();
  else server.once('listening', activate);
}

express.application.listen = function v294CarryoverSchedulerActivationListen(...args) {
  const server = previousListen.apply(this, args);
  // Never start background carry work merely because listen() was called. Wait
  // until Node confirms the port is actually bound, so a bind/startup failure
  // cannot leave a hidden scheduler competing with the recovery UI.
  activateAfterListening(server);
  return server;
};

export function inspectV294CarryoverSchedulerActivation() {
  return {
    id: V294_CARRYOVER_SCHEDULER_ACTIVATION_ID,
    listeningObserved: schedulerListeningObserved,
    activationAttempted: schedulerActivationAttempted
  };
}

console.info('[CE-QC][V294_CARRYOVER_SCHEDULER_ACTIVATION]', V294_CARRYOVER_SCHEDULER_ACTIVATION_ID,
  'OPEN carry scheduler activates only after the production server listening event; scheduler protects startup, then runs Cambodia 00:05 rollover + every 2 hours.');
