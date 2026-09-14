import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workerPath=path.join(root,'scripts','CE_QC_PurgeExecuteTaskWorker.mjs');

function readWorker(){return fs.readFileSync(workerPath,'utf8');}

test('execute worker sanitizes environment, binds/rechecks sealed DB path, and passes write-free preflight before loading purge coordinator',()=>{
  const source=readWorker();
  const sanitizeAt=source.indexOf('sanitizePostCommitBlockEnv();');
  const preflightAt=source.indexOf("await import('../src/v505PurgeExecuteReadOnlyPreflight.js')");
  const firstSealedPathAt=source.indexOf('assertPurgeExecuteSealedDatabasePath(payload)');
  const delayAt=source.indexOf('if(delay)await new Promise');
  const lastSealedPathAt=source.lastIndexOf('assertPurgeExecuteSealedDatabasePath(payload)');
  const assertAt=source.indexOf('assertPurgeExecuteReadOnlyPreflight(payload)');
  const coordinatorAt=source.indexOf("await import('../src/v505PurgeCoordinator.js')");
  assert.ok(sanitizeAt>=0,'execute worker must sanitize PURGE_POST_COMMIT_BLOCK_MS');
  assert.ok(preflightAt>sanitizeAt,'preflight module must load only after environment sanitization');
  assert.ok(firstSealedPathAt>preflightAt,'sealed database path must be validated before the startup delay');
  assert.ok(delayAt>firstSealedPathAt&&lastSealedPathAt>delayAt,'sealed database path must be revalidated after the startup delay');
  assert.ok(assertAt>lastSealedPathAt&&coordinatorAt>assertAt,'destructive coordinator must load only after the post-delay path recheck and read-only preflight succeed');
  assert.doesNotMatch(source,/^import\s+\{\s*runPurgeExecutionWorker\s*\}\s+from\s+['"]\.\.\/src\/v505PurgeCoordinator\.js['"]/m,'static coordinator import would evaluate dataPurge before sanitization/preflight');
  assert.match(source,/if\(Number\.isFinite\(value\)\)return;/,'finite numeric overrides may continue to the bounded dataPurge clamp');
  assert.match(source,/process\.env\.PURGE_POST_COMMIT_BLOCK_MS=String\(24\*60\*60_000\)/,'invalid values must fail closed to the 24-hour default');
});
