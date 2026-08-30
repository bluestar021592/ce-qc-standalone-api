import { registerHooks } from 'node:module';

// Keep the historical V314 identifier contract because production activation
// gates key off /v314/. V340 extends the same early redirect owner with the CCSL
// lightweight storage checkpoint wrapper; it does not replace the owner identity.
export const V314_MODULE_REDIRECT_ID = '2026-08-27-v314-v340-server-throughput-storage-redirect-v3';
const INSTALL_KEY = Symbol.for('ce-qc.v314.module-redirect-installed');
const PIPELINE_URL = new URL('./v314PipelineThroughput.js', import.meta.url).href;
const STORE_URL = new URL('./v314BusinessStoreCheckpoint.js', import.meta.url).href;
const STORAGE_URL = new URL('./v340CcslStorageCheckpoint.js', import.meta.url).href;

export function resolveV314Target(specifier = '', parentURL = '') {
  const parent=String(parentURL || '').replace(/\\/g, '/');
  if (parent.endsWith('/server.js')) {
    if (specifier === './src/pipeline.js') return PIPELINE_URL;
    if (specifier === './src/businessStore.js') return STORE_URL;
    if (specifier === './src/storage.js') return STORAGE_URL;
  }
  // V315 extends the existing owner to the two-hour/next-day carryover scheduler.
  // The scheduler must share the same pipeline batch policy loaded by server.js.
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
  console.info('[CE-QC][V340_MODULE_REDIRECT]', V314_MODULE_REDIRECT_ID, 'server pipeline uses stable all-business 350 scan / 50x4 tracking; CCSL and SHOPEE both use lightweight in-run checkpoints with authoritative full mirrors only at safe boundaries.');
}
