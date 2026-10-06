import fs from 'node:fs';
import assert from 'node:assert/strict';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const v663=fs.readFileSync('scripts/v663-whpp-completion-projection-timing-diag-smoke.mjs','utf8');
const v677=fs.readFileSync('scripts/v677-whpp-dual-route-convergence-smoke.mjs','utf8');

assert.match(shell,/const truthLocked=Boolean\(truth\?\.whppCompletion\?\.locked\)/,'selected-date truth lock must own WHPP projection');
assert.match(shell,/const whppLock=truthLocked\?truth\.whppCompletion:\(whppPayload\.completionLock\|\|\{\}\)/,'WHPP projection must merge selected-date truth and progress lock');
assert.match(shell,/complete:truthLocked\|\|Boolean\(whppPayload\.completionLock\?\.locked\)/,'WHPP family completion must accept selected-date truth');

assert.doesNotMatch(v663,/completionLock:whppPayload\.completionLock\|\|\{\}/,'V663 gate must not require retired completionLock projection');
assert.doesNotMatch(v677,/complete:Boolean\(whppPayload\.completionLock\?\.locked\)/,'V677 gate must not require retired completion projection');
assert.match(v663,/truthLocked/,'V663 gate must validate selected-date truth-owned projection');
assert.match(v677,/truthLocked/,'V677 gate must validate selected-date truth-owned projection');

console.log('[V685] legacy WHPP projection gates aligned with V684 selected-date truth owner');
