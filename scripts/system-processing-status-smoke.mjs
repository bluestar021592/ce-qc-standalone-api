import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

for(const file of ['src/processingStatusCore.js','src/v322WebAvailabilityPatch.js','src/v317CcslIncompleteRecoveryPatch.js','src/v415RetroactiveCompletionGuard.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const core=fs.readFileSync('src/processingStatusCore.js','utf8');
const v322=fs.readFileSync('src/v322WebAvailabilityPatch.js','utf8');
const v317=fs.readFileSync('src/v317CcslIncompleteRecoveryPatch.js','utf8');
const v415=fs.readFileSync('src/v415RetroactiveCompletionGuard.js','utf8');

assert.match(core,/PROCESSING_STATUS_CORE_ID='system-processing-status-core-v1'/);
assert.match(core,/readV418CurrentMembershipCounts/,'core must own exact current VALID membership');
assert.match(core,/readV418CcslProcessingProof/,'core must own CCSL current-member processing proof');
assert.match(core,/readV418BusinessSuccessCoverage/,'core must own SHOPEE\/WHPP SUCCESS coverage');
assert.match(core,/JOIN pod_locks p ON p\.shipmentCode=u\.shipmentCode/,'all-POD terminal closure must be an exact current-membership database join');
assert.match(core,/podLocks\.ok&&n\(podLocks\.count\)>=n\(counts\.CCSL\)/,'all current CCSL members must be irreversibly POD-locked before no-snapshot terminal closure');
assert.match(core,/PROCESS_RESTART_INTERRUPTED/,'one core must expose restart interruption');
assert.match(core,/podLockSkipped:key==='CCSL'\?n\(stage\.podLockCount\):0/,'visible POD-lock count must use real current-member POD proof, never sourceTotal-scanTotal arithmetic');

assert.match(v322,/readSevenBusinessStatus/);assert.match(v322,/readRunProgress/);
assert.doesNotMatch(v322,/SELECT .*unified_import_rows|readV418CurrentMembershipCounts|readV418CcslProcessingProof|readV418BusinessSuccessCoverage/s,'V322 compatibility route must not recompute persisted status truth');
assert.match(v317,/readSevenBusinessStatus/,'V317 recovery preparation must consume core truth');
assert.doesNotMatch(v317,/readV418CurrentMembershipCounts|readV418CcslProcessingProof|readV418BusinessSuccessCoverage/,'V317 must not become a second current status owner');
assert.match(v415,/readSevenBusinessStatus/,'V415 stale-pointer guard must consume core truth');
assert.doesNotMatch(v415,/express\.application\.get\s*=|STATUS_ROUTE/,'V415 GET response wrapping must stay retired');
assert.doesNotMatch(v415,/readV418CurrentMembershipCounts|readV418CcslProcessingProof|readV418BusinessSuccessCoverage/,'V415 must not run a third independent membership/completion proof');
assert.match(v415,/GUARDED_POST_ROUTES/,'V415 may remain only as POST stale-finished protection during compatibility migration');

console.log('[SYSTEM PROCESSING STATUS] passed · one persisted truth owner · V322 URL compatibility only · V317 run preparation only · V415 POST stale-pointer protection only · real current-member POD count');