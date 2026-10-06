import fs from 'node:fs';
import assert from 'node:assert/strict';

const legacy=fs.readFileSync('src/v42WhppPatch.js','utf8');
const modern=fs.readFileSync('src/v134WhppRunSupervisorPatch.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');

assert.match(legacy,/this\.get\('\/api\/whpp\/progress'/,'legacy WHPP progress route still exists and must be safe');
assert.match(legacy,/req\.query\?\.reportDate/,'legacy WHPP progress must honor selected reportDate');
assert.match(legacy,/persistentWhppCompletionTruth\(getDb\(\),requestedDate\)/,'legacy WHPP progress must use the same persisted selected-date completion truth');
assert.match(legacy,/completionLock:\{\.\.\.truth,locked,finalized:locked/,'legacy route must publish completionLock to the shell');
assert.match(legacy,/outcome:'COMPLETED'/,'legacy route must publish completed runtime outcome');
assert.match(modern,/persistentWhppCompletionTruth\(db,date\)/,'modern WHPP route must use the persisted completion truth too');
assert.match(shell,/complete:truthLocked\|\|Boolean\(whppPayload\.completionLock\?\.locked\)/,'shell must render selected-date truth or either progress-route completion lock');
console.log('[V677] both legacy and modern WHPP progress owners converge on selected-date persistent completion truth');
