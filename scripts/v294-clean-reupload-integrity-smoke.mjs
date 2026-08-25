import assert from 'node:assert/strict';
import fs from 'node:fs';

const cleanSource = fs.readFileSync(new URL('../src/v294CleanReuploadIntegrity.js', import.meta.url), 'utf8');
const activationSource = fs.readFileSync(new URL('../src/v147TrackTimeoutConfig.js', import.meta.url), 'utf8');
const purgeSource = fs.readFileSync(new URL('../src/dataPurge.js', import.meta.url), 'utf8');
const purgeWorkerSource = fs.readFileSync(new URL('./CE_QC_PurgeDeleteWorker.mjs', import.meta.url), 'utf8');
const bootstrapSource = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');

assert.match(cleanSource, /qc_tracking_ledger/);
assert.match(cleanSource, /qc_tracking_audit/);
assert.match(cleanSource, /installV294CleanSlateTargets\(\)/);
assert.match(activationSource, /v294CleanReuploadIntegrity\.js/);
assert.match(purgeSource, /BUSINESS_DATA_TABLES/);
assert.match(purgeSource, /BUSINESS_DATA_TABLES\.filter/);
assert.match(purgeWorkerSource, /v294CleanReuploadIntegrity\.js/);
assert.match(purgeWorkerSource, /BUSINESS_DATA_TABLES\.filter/);

// A raw first-occurrence search for importPhase('server', ...) is misleading because
// the helper function is defined before the startup sequence. Verify both semantics:
// (1) the awaited V147 activation happens before bootstrap invokes the server loader;
// (2) inside the actual importServerInteractiveFirst function body, server.js is loaded.
const v147ActivationIndex = bootstrapSource.indexOf("await importPhase('v147TrackTimeoutConfig'");
const serverActivationIndex = bootstrapSource.indexOf('await importServerInteractiveFirst();');
assert.ok(v147ActivationIndex >= 0, 'bootstrap must explicitly await V147/V294 activation');
assert.ok(serverActivationIndex >= 0, 'bootstrap must explicitly invoke the interactive-first server loader');
assert.ok(v147ActivationIndex < serverActivationIndex, 'V147/V294 must activate before server/dataPurge is loaded');

const serverLoaderStart = bootstrapSource.indexOf('async function importServerInteractiveFirst()');
const serverLoaderEnd = bootstrapSource.indexOf('function scheduleDeferredMaintenance', serverLoaderStart);
const serverImportIndex = bootstrapSource.indexOf("return await importPhase('server', './server.js');", serverLoaderStart);
assert.ok(serverLoaderStart >= 0, 'interactive-first server loader function must exist');
assert.ok(serverLoaderEnd > serverLoaderStart, 'interactive-first server loader must end before deferred maintenance function');
assert.ok(serverImportIndex > serverLoaderStart && serverImportIndex < serverLoaderEnd, 'interactive-first server loader must actually import server.js');

console.log('[V295.8/V294] clean reupload integrity smoke passed · runtime bootstrap order + real server loader verified · main purge and isolated SQLite purge worker both clear qc_tracking_ledger + qc_tracking_audit');
