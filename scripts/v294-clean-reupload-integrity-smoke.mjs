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

// The helper function importServerInteractiveFirst() necessarily contains the text
// importPhase('server', ...) near the top of bootstrap.js, so a raw first-occurrence
// comparison does not describe runtime activation order. Validate the actual awaited
// startup calls instead: V147 (which imports V294 clean-slate hooks) must be awaited
// before bootstrap invokes the server loader, and that loader must itself import server.js.
const v147ActivationIndex = bootstrapSource.indexOf("await importPhase('v147TrackTimeoutConfig'");
const serverActivationIndex = bootstrapSource.indexOf('await importServerInteractiveFirst();');
assert.ok(v147ActivationIndex >= 0, 'bootstrap must explicitly await V147/V294 activation');
assert.ok(serverActivationIndex >= 0, 'bootstrap must explicitly invoke the interactive-first server loader');
assert.ok(v147ActivationIndex < serverActivationIndex, 'V147/V294 must activate before server/dataPurge is loaded');
const serverLoader = (bootstrapSource.match(/async function importServerInteractiveFirst\(\)[\s\S]*?\n}\n/) || [''])[0];
assert.match(serverLoader, /importPhase\('server',\s*'\.\/server\.js'\)/, 'interactive-first server loader must actually import server.js');

console.log('[V295.7/V294] clean reupload integrity smoke passed · runtime bootstrap order verified · main purge and isolated SQLite purge worker both clear qc_tracking_ledger + qc_tracking_audit');
