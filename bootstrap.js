import express from 'express';

const WRAPPED = Symbol.for('ce-qc.async-route-wrapped');

// Normal operation is interactive-first. Dashboard cache maintenance must never
// compete with users every ten minutes on the same local SQLite file. Two hours
// matches the QC refresh requirement; an empty cache warms only the recent week.
if (!process.env.DASHBOARD_CACHE_REFRESH_MS) process.env.DASHBOARD_CACHE_REFRESH_MS = String(2 * 60 * 60 * 1000);
if (!process.env.DASHBOARD_CACHE_WARM_DAYS) process.env.DASHBOARD_CACHE_WARM_DAYS = '7';
if (!process.env.DASHBOARD_CACHE_STARTUP_DELAY_MS) process.env.DASHBOARD_CACHE_STARTUP_DELAY_MS = '120000';

function wrapHandler(handler) {
  if (typeof handler !== 'function') return handler;
  if (handler[WRAPPED]) return handler;
  const wrapped = function ceQcSafeAsyncHandler(req, res, next) {
    try {
      const result = handler.call(this, req, res, next);
      if (result && typeof result.then === 'function') result.catch(error => handleRouteError(error, req, res, next));
      return result;
    } catch (error) { return handleRouteError(error, req, res, next); }
  };
  Object.defineProperty(wrapped, WRAPPED, { value: true });
  return wrapped;
}
function wrapArgument(value) { if (Array.isArray(value)) return value.map(wrapArgument); return wrapHandler(value); }
function handleRouteError(error, req, res, next) {
  const message = error?.message || String(error || 'Unknown server error');
  console.error(`[CE-QC][API_ERROR] ${req?.method || ''} ${req?.originalUrl || req?.url || ''}:`, error);
  if (res?.headersSent) { if (typeof next === 'function') return next(error); return; }
  if (String(req?.originalUrl || req?.url || '').startsWith('/api/')) { res.status(500).json({ ok: false, error: message, code: 'SERVER_ROUTE_ERROR' }); return; }
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
process.on('unhandledRejection', reason => console.error('[CE-QC][UNHANDLED_REJECTION]', reason));
process.on('uncaughtExceptionMonitor', (error, origin) => console.error('[CE-QC][UNCAUGHT_EXCEPTION_FATAL]', origin || '', error?.stack || error));
process.on('warning', warning => console.warn('[CE-QC][NODE_WARNING]', warning?.stack || warning));

async function importPhase(label, modulePath) {
  const startedAt = Date.now();
  console.log(`[CE-QC][BOOT] START ${label}`);
  const loaded = await import(modulePath);
  console.log(`[CE-QC][BOOT] DONE ${label} ${Date.now() - startedAt}ms`);
  return loaded;
}

async function importServerInteractiveFirst() {
  const nativeSetTimeout = globalThis.setTimeout;
  const startupDelayMs = Math.max(30_000, Number(process.env.DASHBOARD_CACHE_STARTUP_DELAY_MS || 120_000));
  globalThis.setTimeout = function ceQcInteractiveFirstTimeout(callback, delay, ...args) {
    let effectiveDelay = delay;
    if (Number(delay) === 1500 && typeof callback === 'function') {
      let source = '';
      try { source = Function.prototype.toString.call(callback); } catch {}
      if (/launchDashboardCacheWorker/.test(source) && /STARTUP_WARM/.test(source)) {
        effectiveDelay = startupDelayMs;
        console.log(`[CE-QC][BOOT] dashboard STARTUP_WARM deferred from 1500ms to ${startupDelayMs}ms so first paint stays responsive.`);
      }
    }
    return nativeSetTimeout(callback, effectiveDelay, ...args);
  };
  try {
    return await importPhase('server', './server.js');
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
  }
}

function scheduleDeferredMaintenance({ v92, v76Repair }) {
  if (String(process.env.CE_QC_BACKGROUND_MAINTENANCE_ENABLED || '').trim() !== '1') {
    console.log('[CE-QC][BOOT] background maintenance disabled on normal startup; first paint is not blocked.');
    return;
  }
  const delayMs = Math.max(5_000, Number(process.env.CE_QC_BACKGROUND_MAINTENANCE_DELAY_MS || 300_000));
  const timer = setTimeout(() => {
    try {
      const startedAt = Date.now();
      const result = v92.repairWhppTerminalAuthorityOnce();
      console.log(`[CE-QC][BACKGROUND] V92 WHPP terminal authority ${Date.now()-startedAt}ms ${JSON.stringify({skipped:Boolean(result.skipped),scanned:result.scanned,repaired:result.repaired,affectedDates:result.affectedDates})}`);
    } catch (error) {
      console.error('[CE-QC][BACKGROUND] V92 maintenance failed:', error?.stack || error);
    }
    try {
      const startedAt = Date.now();
      const result = v76Repair.repairLatestCeafSplit();
      console.log(`[CE-QC][BACKGROUND] V76 CEAF repair ${Date.now()-startedAt}ms ${JSON.stringify(result)}`);
    } catch (error) {
      console.error('[CE-QC][BACKGROUND] V76 maintenance failed:', error?.stack || error);
    }
  }, delayMs);
  timer.unref?.();
  console.log(`[CE-QC][BOOT] background maintenance explicitly enabled and deferred ${delayMs}ms; first paint is not blocked.`);
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
  await importPhase('v75CeafUploadNormalizerPatch', './src/v75CeafUploadNormalizerPatch.js');
  await importPhase('v102UnifiedImportSafetyGatePatch', './src/v102UnifiedImportSafetyGatePatch.js');
  await importPhase('v146UnifiedImportDateBridgePatch', './src/v146UnifiedImportDateBridgePatch.js');
  await importPhase('v42WhppPatch', './src/v42WhppPatch.js');
  await importPhase('v44WhppUiPatch', './src/v44WhppUiPatch.js');
  await importPhase('v89StaticAssetCachePatch', './src/v89StaticAssetCachePatch.js');
  await importPhase('v43BootstrapPerfPatch', './src/v43BootstrapPerfPatch.js');
  await importPhase('v46ColdStartIndexPatch', './src/v46ColdStartIndexPatch.js');
  await importPhase('v48RoutingPatch', './src/v48RoutingPatch.js');
  await importPhase('v49DashboardCorrectnessPatch', './src/v49DashboardCorrectnessPatch.js');
  await importPhase('v50DashboardSourceTruthPatch', './src/v50DashboardSourceTruthPatch.js');
  await importPhase('v51WhppLegacyEvidencePatch', './src/v51WhppLegacyEvidencePatch.js');
  await importPhase('v55DashboardReconciliationPatch', './src/v55DashboardReconciliationPatch.js');
  await importPhase('v70ConfirmQueryResiliencePatch', './src/v70ConfirmQueryResiliencePatch.js');
  await importPhase('v141WhppDailyRetryIsolationPatch', './src/v141WhppDailyRetryIsolationPatch.js');
  await importPhase('v142SevenBusinessExportPatch', './src/v142SevenBusinessExportPatch.js');
  await importPhase('v71WhppSummaryPatch', './src/v71WhppSummaryPatch.js');
  await importPhase('v84AsyncExportPatch', './src/v84AsyncExportPatch.js');
  await importPhase('v142AsyncExportPreflightPatch', './src/v142AsyncExportPreflightPatch.js');
  await importPhase('v85ShopeeWhppMetricPatch', './src/v85ShopeeWhppMetricPatch.js');
  await importPhase('v86StrictTrackStatusGate', './src/v86StrictTrackStatusGate.js');
  await importPhase('v89InstantDashboardPatch', './src/v89InstantDashboardPatch.js');
  await importPhase('v90FastDashboardReadPatch', './src/v90FastDashboardReadPatch.js');
  await importPhase('v94ShopeeWhppSourceTruthPatch', './src/v94ShopeeWhppSourceTruthPatch.js');
  await importPhase('v94UnifiedImportDisplayTruthPatch', './src/v94UnifiedImportDisplayTruthPatch.js');

  const v92 = await importPhase('v92WhppTerminalAuthority', './src/v92WhppTerminalAuthorityOnce.js');
  await importPhase('v93ShopeeResumeResiliencePatch', './src/v93ShopeeResumeResiliencePatch.js');
  await importPhase('v73CeafSourceMarkerPatch', './src/v73CeafSourceMarkerPatch.js');
  await importPhase('v74CeafDuplicateReimportPatch', './src/v74CeafDuplicateReimportPatch.js');
  const v76Repair = await importPhase('v76CurrentCeafSplitRepair', './src/v76CurrentCeafSplitRepair.js');

  await importServerInteractiveFirst();
  scheduleDeferredMaintenance({ v92, v76Repair });
} catch (error) {
  console.error('[CE-QC][STARTUP_FATAL]', error?.stack || error);
  process.exitCode = 1;
}
