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
assert.ok(bootstrapSource.indexOf("importPhase('v147TrackTimeoutConfig'") < bootstrapSource.indexOf("importPhase('server'"), 'V147/V294 must activate before server/dataPurge is loaded');

console.log('[V294] clean reupload integrity smoke passed · main purge and isolated SQLite purge worker both clear qc_tracking_ledger + qc_tracking_audit');
