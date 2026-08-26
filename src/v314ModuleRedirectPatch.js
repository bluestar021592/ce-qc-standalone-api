import { registerHooks } from 'node:module';

export const V314_MODULE_REDIRECT_ID = '2026-08-26-v314-server-module-throughput-redirect-v1';
const INSTALL_KEY = Symbol.for('ce-qc.v314.module-redirect-installed');
const PIPELINE_URL = new URL('./v314PipelineThroughput.js', import.meta.url).href;
const STORE_URL = new URL('./v314BusinessStoreCheckpoint.js', import.meta.url).href;

export function resolveV314Target(specifier = '', parentURL = '') {
  if (!String(parentURL || '').replace(/\\/g, '/').endsWith('/server.js')) return '';
  if (specifier === './src/pipeline.js') return PIPELINE_URL;
  if (specifier === './src/businessStore.js') return STORE_URL;
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
  console.info('[CE-QC][V314_MODULE_REDIRECT]', V314_MODULE_REDIRECT_ID, 'server pipeline + businessStore imports redirected to bounded SHOPEE prefetch and throttled full-mirror checkpoints; source files remain unchanged on disk.');
}
