import express from 'express';

const WRAPPED = Symbol.for('ce-qc.async-route-wrapped');

function wrapHandler(handler) {
  if (typeof handler !== 'function') return handler;
  if (handler[WRAPPED]) return handler;

  const wrapped = function ceQcSafeAsyncHandler(req, res, next) {
    try {
      const result = handler.call(this, req, res, next);
      if (result && typeof result.then === 'function') {
        result.catch(error => handleRouteError(error, req, res, next));
      }
      return result;
    } catch (error) {
      return handleRouteError(error, req, res, next);
    }
  };

  Object.defineProperty(wrapped, WRAPPED, { value: true });
  return wrapped;
}

function wrapArgument(value) {
  if (Array.isArray(value)) return value.map(wrapArgument);
  return wrapHandler(value);
}

function handleRouteError(error, req, res, next) {
  const message = error?.message || String(error || 'Unknown server error');
  console.error(`[CE-QC][API_ERROR] ${req?.method || ''} ${req?.originalUrl || req?.url || ''}:`, error);

  if (res?.headersSent) {
    if (typeof next === 'function') return next(error);
    return;
  }

  if (String(req?.originalUrl || req?.url || '').startsWith('/api/')) {
    res.status(500).json({ ok: false, error: message, code: 'SERVER_ROUTE_ERROR' });
    return;
  }

  if (typeof next === 'function') return next(error);
  res.status(500).send('CE QC server error');
}

for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
  const original = express.application[method];
  if (typeof original !== 'function') continue;

  express.application[method] = function ceQcSafeRouteRegistration(...args) {
    if (method === 'get' && args.length === 1) return original.apply(this, args);
    if (args.length < 2) return original.apply(this, args);
    return original.apply(this, [args[0], ...args.slice(1).map(wrapArgument)]);
  };
}

process.on('unhandledRejection', reason => {
  console.error('[CE-QC][UNHANDLED_REJECTION]', reason);
});

process.on('uncaughtExceptionMonitor', (error, origin) => {
  console.error('[CE-QC][UNCAUGHT_EXCEPTION_FATAL]', origin || '', error?.stack || error);
});

process.on('warning', warning => {
  console.warn('[CE-QC][NODE_WARNING]', warning?.stack || warning);
});

async function importPhase(label, modulePath) {
  const startedAt = Date.now();
  console.log(`[CE-QC][BOOT] START ${label}`);
  await import(modulePath);
  console.log(`[CE-QC][BOOT] DONE ${label} ${Date.now() - startedAt}ms`);
}

try {
  console.log(`[CE-QC][BOOT] bootstrap pid=${process.pid} node=${process.version}`);
  await importPhase('v27ServerPatch', './src/v27ServerPatch.js');
  await importPhase('v27TrendPatch', './src/v27TrendPatch.js');
  await importPhase('v27CarryBusinessPatch', './src/v27CarryBusinessPatch.js');
  await importPhase('v28ResumeGuardPatch', './src/v28ResumeGuardPatch.js');
  await importPhase('v28RuntimePatch', './src/v28RuntimePatch.js');
  await importPhase('v29DataConsistencyPatch', './src/v29DataConsistencyPatch.js');
  await importPhase('v29BusinessRulesPatch', './src/v29BusinessRulesPatch.js');
  await importPhase('v29EndpointAliasPatch', './src/v29EndpointAliasPatch.js');
  await importPhase('v30CarryRulesPatch', './src/v30CarryRulesPatch.js');
  await importPhase('v33RunProgressPatch', './src/v33RunProgressPatch.js');
  await importPhase('v39UnifiedSnapshotRecoveryPatch', './src/v39UnifiedSnapshotRecoveryPatch.js');
  await importPhase('v41AuthPausePatch', './src/v41AuthPausePatch.js');
  await importPhase('v53WhppRefreshGatePatch', './src/v53WhppRefreshGatePatch.js');
  await importPhase('v42WhppPatch', './src/v42WhppPatch.js');
  await importPhase('v44WhppUiPatch', './src/v44WhppUiPatch.js');
  await importPhase('v43BootstrapPerfPatch', './src/v43BootstrapPerfPatch.js');
  await importPhase('v46ColdStartIndexPatch', './src/v46ColdStartIndexPatch.js');
  await importPhase('v48RoutingPatch', './src/v48RoutingPatch.js');
  await importPhase('v49DashboardCorrectnessPatch', './src/v49DashboardCorrectnessPatch.js');
  await importPhase('v50DashboardSourceTruthPatch', './src/v50DashboardSourceTruthPatch.js');
  await importPhase('v51WhppLegacyEvidencePatch', './src/v51WhppLegacyEvidencePatch.js');
  await importPhase('v55DashboardReconciliationPatch', './src/v55DashboardReconciliationPatch.js');
  await importPhase('v70ConfirmQueryResiliencePatch', './src/v70ConfirmQueryResiliencePatch.js');
  await importPhase('server', './server.js');
} catch (error) {
  console.error('[CE-QC][STARTUP_FATAL]', error?.stack || error);
  process.exitCode = 1;
}
