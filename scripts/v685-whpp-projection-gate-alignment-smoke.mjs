import fs from 'node:fs';
import assert from 'node:assert/strict';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const v663=fs.readFileSync('scripts/v663-whpp-completion-projection-timing-diag-smoke.mjs','utf8');
const v677=fs.readFileSync('scripts/v677-whpp-dual-route-convergence-smoke.mjs','utf8');

assert.doesNotMatch(shell,/\/api\/selected-date-truth\?reportDate=.*fetchLiveProgress/s,'WHPP live projection must not duplicate selected-date truth polling');
assert.match(shell,/const whppLock=whppPayload\.completionLock\|\|\{\}/,'WHPP projection must consume the progress-owner completion lock');
assert.match(shell,/complete:Boolean\(whppLock\.locked\)\|\|familyComplete\(whppPayload\.runtime\|\|\{\}\)/,'WHPP family completion must accept the progress-owner durable lock');

assert.match(v663,/whppLock=whppPayload\\\.completionLock|whppLock=whppPayload\.completionLock/,'V663 gate must validate progress-owner completion projection');
assert.match(v677,/whppLock=whppPayload\\\.completionLock|whppLock=whppPayload\.completionLock/,'V677 gate must validate progress-owner completion projection');
assert.doesNotMatch(v663,/truthLocked/,'V663 gate must not reintroduce duplicate selected-date truth polling');
assert.doesNotMatch(v677,/truthLocked/,'V677 gate must not reintroduce duplicate selected-date truth polling');

console.log('[V685] WHPP projection gates aligned with the progress-owner durable completion lock; duplicate selected-date truth polling remains retired');
