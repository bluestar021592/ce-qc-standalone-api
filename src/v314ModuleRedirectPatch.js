import { registerHooks } from 'node:module';

export const V314_MODULE_REDIRECT_ID = '2026-08-26-v315-server-carryover-module-throughput-redirect-v2';
const INSTALL_KEY = Symbol.for('ce-qc.v314.module-redirect-installed');
const PIPELINE_URL = new URL('./v314PipelineThroughput.js', import.meta.url).href;
const STORE_URL = new URL('./v314BusinessStoreCheckpoint.js', import.meta.url).href;

export function resolveV314Target(specifier = '', parentURL = '') {
  const parent=String(parentURL || '').replace(/\\/g, '/');
  if (parent.endsWith('/server.js')) {
    if (specifier === './src/pipeline.js') return PIPELINE_URL;
    if (specifier === './src/businessStore.js') return STORE_URL;
  }
  // The two-hour/next-day carryover scheduler used to preload pipeline.js before
  // the runtime batch policy existed. That permanently froze ORDER_BATCH_SIZE at
  // 350 for the whole process. Route this early import through the same owner so
  // both normal daily processing and background carryover use one bounded policy.
  if (parent.endsWith('/src/carryoverRefreshScheduler.js') && specifier === './pipeline.js') return PIPELINE_URL;
  return '';
}

if (!globalThis[INSTALL_KEY]) {
  if (typeof registerHooks !== 'function') throw new Error('V314 requires node:module registerHooks support');
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const redirected = resolveV314Target(specifier, context?.parentURL || '');
      if (redirected) return { url: redirected, shortCircuit: true };
      return nextResolve(specifier, context);
    }
  });
  globalThis[INSTALL_KEY] = true;
  console.info('[CE-QC][V315_MODULE_REDIRECT]', V314_MODULE_REDIRECT_ID, 'server + carryover pipeline imports share bounded CCSL/SHOPEE throughput owner; server businessStore keeps throttled full-mirror checkpoints.');
}